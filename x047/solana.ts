import {
  Connection, Keypair, PublicKey, VersionedTransaction,
  SystemProgram, Transaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, getAccount,
  createAssociatedTokenAccountInstruction, createTransferCheckedInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_API = "https://api.jup.ag/swap/v2";
const RAYDIUM_API = "https://api-v3.raydium.io";
const EXPLORER   = "https://solscan.io/tx";

export const SOLANA_TOKENS: Record<string, { mint: string; decimals: number }> = {
  SOL:   { mint: WSOL_MINT,                                           decimals: 9 },
  WSOL:  { mint: WSOL_MINT,                                           decimals: 9 },
  USDC:  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",     decimals: 6 },
  USDT:  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",     decimals: 6 },
  JTO:   { mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",      decimals: 9 },
  PENGU: { mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",     decimals: 6 },
  TRUMP: { mint: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",     decimals: 6 },
};

if (!process.env.SOLANA_PRIVATE_KEY) throw new Error("SOLANA_PRIVATE_KEY not set in .env");
if (!process.env.HELIUS_RPC_URL)     throw new Error("HELIUS_RPC_URL not set in .env");

const heliusHttp = process.env.HELIUS_RPC_URL;
const heliusWs   = heliusHttp.replace(/^https?:\/\//, (m) => m === "https://" ? "wss://" : "ws://");
const connection = new Connection(heliusHttp, { commitment: "confirmed", wsEndpoint: heliusWs });
const keypair    = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY));
export const solanaAddress = keypair.publicKey.toBase58();

function resolveMint(token: string): string {
  if (token.length > 20) return token; // already a mint address
  return SOLANA_TOKENS[token.toUpperCase()]?.mint ?? token;
}

function resolveDecimals(token: string): number {
  return SOLANA_TOKENS[token.toUpperCase()]?.decimals ?? 9;
}

// ─── USD pricing ────────────────────────────────────────────────────────────

const STABLECOINS = new Set(["USDC", "USDT"]);
// Only SOL has a verified Pyth feed here; JTO/PENGU/TRUMP return null
const PYTH_IDS: Record<string, string> = {
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

async function getSolPrice(symbol: string): Promise<number | null> {
  const upper = symbol.toUpperCase();
  if (STABLECOINS.has(upper)) return 1;
  const id = PYTH_IDS[upper];
  if (!id) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${id}`,
      { signal: ctrl.signal }
    );
    clearTimeout(t);
    const data = await res.json() as { parsed: Array<{ price: { price: string; expo: number } }> };
    const { price, expo } = data.parsed[0].price;
    return Number(price) * 10 ** expo;
  } catch { return null; }
}

// ─── Balance ─────────────────────────────────────────────────────────────────

export type SolanaBalanceResult =
  | { ok: true; raw: string; formatted: string; decimals: number; usdValue: string | null }
  | { ok: false; error: string };

export async function getSolanaBalance(token: string): Promise<SolanaBalanceResult> {
  try {
    const upper = token.toUpperCase();

    if (upper === "SOL") {
      const lamports = await connection.getBalance(keypair.publicKey);
      const formatted = (lamports / LAMPORTS_PER_SOL).toString();
      const price = await getSolPrice("SOL");
      const usdValue = price !== null ? (parseFloat(formatted) * price).toFixed(2) : null;
      return { ok: true, raw: String(lamports), formatted, decimals: 9, usdValue };
    }

    const info = SOLANA_TOKENS[upper];
    if (!info) return { ok: false, error: `Unknown token "${token}" on Solana.` };

    const ata = getAssociatedTokenAddressSync(new PublicKey(info.mint), keypair.publicKey);
    try {
      const acct = await getAccount(connection, ata);
      const raw = String(acct.amount);
      const formatted = (Number(raw) / 10 ** info.decimals).toString();
      const price = await getSolPrice(upper);
      const usdValue = price !== null ? (parseFloat(formatted) * price).toFixed(2) : null;
      return { ok: true, raw, formatted, decimals: info.decimals, usdValue };
    } catch {
      // ATA doesn't exist → zero balance
      return { ok: true, raw: "0", formatted: "0", decimals: info.decimals, usdValue: "0.00" };
    }
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── Swap types ──────────────────────────────────────────────────────────────

export type SolanaQuoteResult =
  | {
      ok: true;
      winner: "jupiter" | "raydium";
      params: {
        inputMint: string; outputMint: string;
        amount: string; slippageBps: number;
        wrapSol: boolean; unwrapSol: boolean;
        winner: "jupiter" | "raydium";
      };
      preview: {
        inputAmount: string; inputSymbol: string;
        outputAmount: string; outputSymbol: string;
      };
    }
  | { ok: false; error: string; message: string };

export type SolanaSwapResult =
  | { ok: true; txHash: string; explorerUrl: string }
  | { ok: false; error: string; message: string };

// ─── Raw API helpers ─────────────────────────────────────────────────────────

async function jupiterQuote(
  inputMint: string, outputMint: string, amount: string, slippageBps: number
): Promise<any> {
  const url = new URL(`${JUPITER_API}/order`);
  url.searchParams.set("inputMint",   inputMint);
  url.searchParams.set("outputMint",  outputMint);
  url.searchParams.set("amount",      amount);
  url.searchParams.set("taker",       keypair.publicKey.toBase58());
  url.searchParams.set("slippageBps", String(slippageBps));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Jupiter: ${await res.text()}`);
  return res.json();
}

async function raydiumCompute(
  inputMint: string, outputMint: string, amount: string, slippageBps: number
): Promise<any> {
  const url = new URL(`${RAYDIUM_API}/compute/swap-base-in`);
  url.searchParams.set("inputMint",  inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount",     amount);
  url.searchParams.set("slippageBps", String(slippageBps));
  url.searchParams.set("txVersion",  "V0");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Raydium: ${await res.text()}`);
  const data = await res.json();
  if (!data.success) throw new Error(`Raydium: ${JSON.stringify(data)}`);
  return data.data;
}

// ─── Get quote ───────────────────────────────────────────────────────────────

export async function getSolanaSwapQuote(
  tokenIn: string,
  tokenOut: string,
  amount: number
): Promise<SolanaQuoteResult> {
  try {
    const inputMint  = resolveMint(tokenIn);
    const outputMint = resolveMint(tokenOut);
    const decimalsIn  = resolveDecimals(tokenIn);
    const decimalsOut = resolveDecimals(tokenOut);
    const amountBase  = String(Math.floor(amount * 10 ** decimalsIn));
    const slippageBps = 50; // 0.5%
    const wrapSol   = tokenIn.toUpperCase()  === "SOL";
    const unwrapSol = tokenOut.toUpperCase() === "SOL";

    const [jupResult, rayResult] = await Promise.allSettled([
      jupiterQuote(inputMint, outputMint, amountBase, slippageBps),
      raydiumCompute(inputMint, outputMint, amountBase, slippageBps),
    ]);

    if (jupResult.status === "rejected" && rayResult.status === "rejected") {
      const jupErr = (jupResult as PromiseRejectedResult).reason?.message ?? "unknown";
      const rayErr = (rayResult as PromiseRejectedResult).reason?.message ?? "unknown";
      return { ok: false, error: "quote_failed", message: `Quote failed. Jupiter: ${jupErr} | Raydium: ${rayErr}` };
    }

    const jupOut = jupResult.status === "fulfilled" ? BigInt(jupResult.value.outAmount)    : 0n;
    const rayOut = rayResult.status === "fulfilled" ? BigInt(rayResult.value.outputAmount) : 0n;

    const winner: "jupiter" | "raydium" = jupOut >= rayOut ? "jupiter" : "raydium";
    const outAmountRaw = winner === "jupiter"
      ? (jupResult as PromiseFulfilledResult<any>).value.outAmount
      : (rayResult as PromiseFulfilledResult<any>).value.outputAmount;

    return {
      ok: true,
      winner,
      params: { inputMint, outputMint, amount: amountBase, slippageBps, wrapSol, unwrapSol, winner },
      preview: {
        inputAmount:  String(amount),
        inputSymbol:  tokenIn.toUpperCase(),
        outputAmount: (Number(outAmountRaw) / 10 ** decimalsOut).toString(),
        outputSymbol: tokenOut.toUpperCase(),
      },
    };
  } catch (e: any) {
    return { ok: false, error: "quote_failed", message: e.message };
  }
}

// ─── Execute swap ─────────────────────────────────────────────────────────────

async function signAndSend(tx: VersionedTransaction): Promise<string> {
  tx.sign([keypair]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

export async function executeSolanaSwap(quoteData: any): Promise<SolanaSwapResult> {
  // Accept either the full quoteData object {winner, params} or just params passed directly
  const params = quoteData?.params?.inputMint ? quoteData.params : (quoteData?.inputMint ? quoteData : null);
  if (!params?.inputMint) {
    return { ok: false, error: "invalid_quote", message: "No valid Solana quote to execute." };
  }
  const winner = params.winner ?? quoteData?.winner ?? "jupiter";

  try {
    if (winner === "jupiter") {
      // Re-call /order for a fresh transaction (avoids blockhash expiry on slow confirmation)
      const freshOrder = await jupiterQuote(params.inputMint, params.outputMint, params.amount, params.slippageBps);
      const txBase64 = freshOrder.swapTransaction ?? freshOrder.transaction;
      if (!txBase64) throw new Error(`Jupiter /order response missing transaction field: ${JSON.stringify(freshOrder)}`);
      const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
      const sig = await signAndSend(tx);
      return { ok: true, txHash: sig, explorerUrl: `${EXPLORER}/${sig}` };
    }

    // Raydium path
    const feeData    = await fetch(`${RAYDIUM_API}/main/auto-fee`).then(r => r.json());
    const priorityFee = String(feeData.data?.default?.m ?? 10000);
    const freshCompute = await raydiumCompute(params.inputMint, params.outputMint, params.amount, params.slippageBps);

    const txBuildRes = await fetch(`${RAYDIUM_API}/transaction/swap-base-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        computeUnitPriceMicroLamports: priorityFee,
        swapResponse:                  freshCompute,
        txVersion:                     "V0",
        wallet:                        keypair.publicKey.toBase58(),
        wrapSol:                       params.wrapSol,
        unwrapSol:                     params.unwrapSol,
      }),
    });
    if (!txBuildRes.ok) throw new Error(`Raydium tx build: ${await txBuildRes.text()}`);
    const txBuildData = await txBuildRes.json();
    if (!txBuildData.success) throw new Error(`Raydium: ${JSON.stringify(txBuildData)}`);

    // Raydium can return multiple transactions (e.g. account setup + swap)
    let lastSig = "";
    for (const item of txBuildData.data as Array<{ transaction: string }>) {
      const tx = VersionedTransaction.deserialize(Buffer.from(item.transaction, "base64"));
      lastSig = await signAndSend(tx);
    }
    return { ok: true, txHash: lastSig, explorerUrl: `${EXPLORER}/${lastSig}` };

  } catch (e: any) {
    return { ok: false, error: "swap_failed", message: e.message };
  }
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

export async function sendSolanaToken(
  token: string,
  to: string,
  amount: number
): Promise<SolanaSwapResult> {
  try {
    const upper    = token.toUpperCase();
    const toPubkey = new PublicKey(to);

    if (upper === "SOL") {
      const lamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey, lamports })
      );
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = keypair.publicKey;
      tx.sign(keypair);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      return { ok: true, txHash: sig, explorerUrl: `${EXPLORER}/${sig}` };
    }

    const info = SOLANA_TOKENS[upper];
    if (!info) return { ok: false, error: "send_failed", message: `Unknown token "${token}" on Solana.` };

    const mint         = new PublicKey(info.mint);
    const senderAta    = getAssociatedTokenAddressSync(mint, keypair.publicKey);
    const recipientAta = getAssociatedTokenAddressSync(mint, toPubkey);
    const amountBase   = BigInt(Math.floor(amount * 10 ** info.decimals));

    const tx = new Transaction();
    try {
      await getAccount(connection, recipientAta);
    } catch {
      // Recipient has no ATA for this token — create one (small SOL cost)
      tx.add(createAssociatedTokenAccountInstruction(keypair.publicKey, recipientAta, toPubkey, mint));
    }
    tx.add(createTransferCheckedInstruction(senderAta, mint, recipientAta, keypair.publicKey, amountBase, info.decimals));

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return { ok: true, txHash: sig, explorerUrl: `${EXPLORER}/${sig}` };

  } catch (e: any) {
    return { ok: false, error: "send_failed", message: e.message };
  }
}
