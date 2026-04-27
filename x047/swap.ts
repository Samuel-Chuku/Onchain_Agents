import { fromHex } from "viem";
import { chainRegistry } from "../config";
import { account, clients, toolSets, publicClients, resolveToken, fetchDecimals, toBaseUnits } from "./shared";
import { getSolanaSwapQuote, executeSolanaSwap, type SolanaQuoteResult } from "./solana";

const DIRECT_API_CHAINS = new Set(["monad"]);
const UNISWAP_API = "https://trade-api.gateway.uniswap.org/v1";
const MONAD_SLIPPAGE = 15;

async function uniswapPost(endpoint: string, body: object): Promise<any> {
  const res = await fetch(`${UNISWAP_API}/${endpoint}`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.UNISWAP_API_KEY!,
      "Content-Type": "application/json",
      "x-universal-router-version": "2.0",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${endpoint} error: ${data.detail ?? JSON.stringify(data)}`);
  return data;
}

async function executeDirectSwap(chain: string, swapParams: any): Promise<SwapResult> {
  const cfg = chainRegistry[chain];
  const chainId = cfg.chain.id;
  const ZERO = "0x0000000000000000000000000000000000000000";

  if (swapParams.tokenIn.toLowerCase() !== ZERO) {
    const approvalRes = await uniswapPost("check_approval", {
      token: swapParams.tokenIn,
      amount: swapParams.amount,
      walletAddress: account.address,
      chainId,
    });
    if (approvalRes.approval) {
      const approvalHash = await clients[chain].sendTransaction({
        to: approvalRes.approval.to as `0x${string}`,
        value: fromHex(approvalRes.approval.value as `0x${string}`, "bigint"),
        data: approvalRes.approval.data as `0x${string}`,
      });
      await publicClients[chain].waitForTransactionReceipt({ hash: approvalHash });
    }
  }

  const { quote, permitData } = await uniswapPost("quote", {
    tokenIn: swapParams.tokenIn,
    tokenOut: swapParams.tokenOut,
    amount: swapParams.amount,
    type: "EXACT_INPUT",
    routingPreference: "BEST_PRICE",
    protocols: ["V3"],
    tokenInChainId: chainId,
    tokenOutChainId: chainId,
    swapper: account.address,
    slippageTolerance: MONAD_SLIPPAGE,
  });

  let signature: `0x${string}` | undefined;
  if (permitData) {
    signature = await clients[chain].signTypedData({
      domain: permitData.domain,
      types: permitData.types,
      primaryType: "PermitSingle",
      message: permitData.values,
    });
  }

  const { swap } = await uniswapPost("swap", {
    quote,
    slippageTolerance: MONAD_SLIPPAGE,
    ...(signature && { signature }),
    ...(permitData && { permitData }),
  });

  const txHash = await clients[chain].sendTransaction({
    to: swap.to as `0x${string}`,
    value: fromHex(swap.value as `0x${string}`, "bigint"),
    data: swap.data as `0x${string}`,
    gas: 1_000_000n,
  });

  const receipt = await publicClients[chain].waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === "reverted") {
    return { ok: false, error: "tx_reverted", message: `Transaction reverted on-chain. Hash: ${txHash}` };
  }
  return { ok: true, txHash, explorerUrl: `${cfg.explorer}/${txHash}` };
}

// Chains with dynamic slippage. Value = minimum % floor.
// Chains not listed here get no slippageTolerance set (API default, for chains already working).
const DYNAMIC_SLIPPAGE: Record<string, number> = {
  ethereum: 0,    // floor 0: scales purely with price impact
  bsc:      0,
  base:     0,
};

export type QuoteResult =
  | {
      ok: true;
      quoteId: string;
      swapParams: {
        tokenIn: string; tokenOut: string; amount: string;
        type: string; routingPreference: string;
        slippageTolerance?: number;
      };
      preview: {
        inputAmount: string; inputSymbol: string;
        outputAmount: string; outputSymbol: string;
        gasFeeUSD: string;
      };
    }
  | { ok: false; error: string; message: string };

const quoteCache = new Map<string, { data: any; timestamp: number }>();
let quoteSeq = 0;
const QUOTE_TTL_MS = 60_000;

export function resolveQuote(quoteId: string):
  | { ok: true; data: any }
  | { ok: false; error: string; message: string } {
  const entry = quoteCache.get(quoteId);
  if (!entry) return { ok: false, error: "quote_not_found", message: "Quote not found — please request a new quote." };
  if (Date.now() - entry.timestamp > QUOTE_TTL_MS) {
    quoteCache.delete(quoteId);
    return { ok: false, error: "quote_expired", message: "Quote expired — price may have moved. Please request a new quote." };
  }
  quoteCache.delete(quoteId);
  return { ok: true, data: entry.data };
}

export type SwapResult =
  | { ok: true; txHash: string; explorerUrl: string }
  | { ok: false; error: string; message: string };

export async function getSwapQuote(
  chain: string,
  tokenIn: string,
  tokenOut: string,
  amount: number
): Promise<QuoteResult | SolanaQuoteResult> {
  let result: QuoteResult | SolanaQuoteResult;

  if (chain === "solana") {
    result = await getSolanaSwapQuote(tokenIn, tokenOut, amount);
  } else {
    try {
      const resolvedIn = resolveToken(tokenIn, chain);
      const resolvedOut = resolveToken(tokenOut, chain);
      const decimalsIn = await fetchDecimals(resolvedIn, chain);
      const decimalsOut = await fetchDecimals(resolvedOut, chain);
      const amountBase = toBaseUnits(amount, decimalsIn);

      const swapParams: {
        tokenIn: string; tokenOut: string; amount: string;
        type: "EXACT_INPUT"; routingPreference: "BEST_PRICE";
        slippageTolerance?: number;
      } = {
        tokenIn: resolvedIn,
        tokenOut: resolvedOut,
        amount: amountBase,
        type: "EXACT_INPUT",
        routingPreference: "BEST_PRICE",
      };

      const quoteResponse = await toolSets[chain].uniswap_get_quote.execute(swapParams);

      const slippageFloor = DYNAMIC_SLIPPAGE[chain];
      if (slippageFloor !== undefined) {
        const priceImpact = parseFloat(quoteResponse.quote?.priceImpact ?? "0");
        const computed = Math.min(5, Math.max(slippageFloor, priceImpact * 1.15));
        if (computed > 0) swapParams.slippageTolerance = parseFloat(computed.toFixed(2));
      }

      const inAmt = (Number(quoteResponse.quote.input.amount) / 10 ** decimalsIn).toString();
      const outAmt = (Number(quoteResponse.quote.output.amount) / 10 ** decimalsOut).toString();

      result = {
        ok: true,
        quoteId: "",
        swapParams,
        preview: {
          inputAmount: inAmt,
          inputSymbol: tokenIn.toUpperCase(),
          outputAmount: outAmt,
          outputSymbol: tokenOut.toUpperCase(),
          gasFeeUSD: quoteResponse.quote.gasFeeUSD,
        },
      };
    } catch (e: any) {
      result = { ok: false, error: "quote_failed", message: e.message ?? "Quote request failed." };
    }
  }

  if (result.ok) {
    const quoteId = `q_${++quoteSeq}`;
    quoteCache.set(quoteId, { data: result, timestamp: Date.now() });
    return { ...result, quoteId };
  }
  return result;
}

export async function executeSwap(chain: string, quoteData: any): Promise<SwapResult> {
  if (chain === "solana") return executeSolanaSwap(quoteData);
  // Accept either the full quoteData object or just the swapParams directly
  const swapParams = quoteData?.swapParams ?? (quoteData?.tokenIn ? quoteData : null);
  if (!swapParams?.tokenIn) {
    const msg = `executeSwap called without valid swapParams. Received: ${JSON.stringify(quoteData)}`;
    console.error("[executeSwap] invalid_quote:", msg);
    return { ok: false, error: "invalid_quote", message: msg };
  }
  try {
    if (DIRECT_API_CHAINS.has(chain)) return await executeDirectSwap(chain, swapParams);

    const cfg = chainRegistry[chain];
    const result = await toolSets[chain].uniswap_swap_tokens.execute(swapParams);
    const receipt = await publicClients[chain].waitForTransactionReceipt({ hash: result.txHash });
    if (receipt.status === "reverted") {
      console.error("[executeSwap] tx reverted:", result.txHash);
      return { ok: false, error: "tx_reverted", message: `Transaction reverted on-chain. Hash: ${result.txHash}` };
    }
    return {
      ok: true,
      txHash: result.txHash,
      explorerUrl: `${cfg.explorer}/${result.txHash}`,
    };
  } catch (e: any) {
    console.error("[executeSwap] swap_failed:", e.message);
    return { ok: false, error: "swap_failed", message: e.message };
  }
}
