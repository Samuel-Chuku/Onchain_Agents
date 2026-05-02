import "dotenv/config";
import { generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { chainRegistry } from "./config";
import { account } from "./x047/shared";
import { solanaAddress } from "./x047/solana";
import { getBalance, getUsdPrice } from "./x047/balance";
import { getSwapQuote, executeSwap, resolveQuote } from "./x047/swap";
import { previewSend, resolveAndSend } from "./x047/transfer";
import { z } from "zod";
import * as readline from "readline";

const EVM_CHAINS = Object.keys(chainRegistry).join(", ");
const CHAIN_LIST  = `${EVM_CHAINS}, solana`;
const EVM_SWAP_CHAINS = Object.entries(chainRegistry)
  .filter(([, cfg]) => cfg.swapPlugin !== null)
  .map(([name]) => name)
  .join(", ");
const SWAP_CHAINS = `${EVM_SWAP_CHAINS}, solana`;

const tools = {
  get_balance: tool({
    description: "Get the wallet balance of any token",
    parameters: z.object({
      chain: z.string().describe(`Chain name. One of: ${CHAIN_LIST}`),
      token: z.string().describe("Token symbol or contract/mint address. Solana tokens: SOL, USDC, USDT, JTO, PENGU, TRUMP, WSOL. EVM tokens: ETH, WETH, USDC, USDT, USDT0, WMON, MON, BNB, WBNB"),
    }),
    execute: async ({ chain, token }) => getBalance(chain, token),
  }),

  get_swap_quote: tool({
    description: "Get a quote for swapping tokens. Returns quoteData — pass it exactly to execute_swap after user confirms.",
    parameters: z.object({
      chain: z.string().describe(`Chain with swap support. One of: ${SWAP_CHAINS}`),
      tokenIn: z.string().describe("Token to sell — symbol or 0x address"),
      tokenOut: z.string().describe("Token to buy — symbol or 0x address"),
      amount: z.number().describe("Human-readable amount to sell (e.g. 5 for 5 USDC)"),
    }),
    execute: async ({ chain, tokenIn, tokenOut, amount }) =>
      getSwapQuote(chain, tokenIn, tokenOut, amount),
  }),

  execute_swap: tool({
    description: "Execute a swap after user confirms. Requires quoteData from get_swap_quote.",
    parameters: z.object({
      chain: z.string().describe("Same chain used in get_swap_quote"),
      quoteData: z.any().describe("The complete quoteData object returned by get_swap_quote — pass it exactly as received"),
    }),
    execute: async ({ chain, quoteData }) => {
      const quoteId = quoteData?.quoteId;
      if (quoteId) {
        const resolved = resolveQuote(quoteId);
        if (!resolved.ok) return resolved;
        return executeSwap(chain, resolved.data);
      }
      return executeSwap(chain, quoteData);
    },
  }),

  get_price: tool({
    description: "Get the current USD price of a token. Use this before preview_send when the user specifies an amount in USD.",
    parameters: z.object({
      token: z.string().describe("Token symbol, e.g. ETH, BNB, SOL, USDC"),
    }),
    execute: async ({ token }) => {
      const price = await getUsdPrice(token);
      if (price === null) return { ok: false, error: "no_price", message: `No price available for ${token}.` };
      return { ok: true, token: token.toUpperCase(), usdPrice: price };
    },
  }),

  preview_send: tool({
    description: "Preview a token send. Returns sendId — pass it exactly to execute_send after user confirms.",
    parameters: z.object({
      chain: z.string().describe(`Chain name. One of: ${CHAIN_LIST}`),
      token: z.string().describe("Token symbol or 0x contract address"),
      to: z.string().describe("Recipient wallet address"),
      amount: z.number().describe("Human-readable token amount (e.g. 0.01 for 0.01 ETH)"),
    }),
    execute: async ({ chain, token, to, amount }) => previewSend(chain, token, to, amount),
  }),

  execute_send: tool({
    description: "Execute a send after user confirms. Requires sendId from preview_send.",
    parameters: z.object({
      sendId: z.string().describe("The sendId returned by preview_send"),
    }),
    execute: async ({ sendId }) => resolveAndSend(sendId),
  }),
};

const systemPrompt = `You are x047, an onchain assistant supporting multiple blockchains.
EVM wallet:    ${account.address}
Solana wallet: ${solanaAddress}

Chains: ${CHAIN_LIST}
Swap-enabled chains: ${SWAP_CHAINS}

Tools: get_balance · get_price · get_swap_quote · execute_swap · preview_send · execute_send
All amounts are human-readable (5 = 5 USDC, 0.01 = 0.01 ETH, 1 = 1 SOL).

Chain selection: infer from the user's message. Default to "base" if unspecified. Use "solana" for any Solana/SOL/JTO/PENGU/TRUMP/WSOL requests.

Solana tokens: SOL (native), WSOL, USDC, USDT, JTO, PENGU, TRUMP.
EVM tokens per chain: ETH/WETH/USDC (all EVM chains), USDT0 (arbitrum/optimism/monad), USDT (ethereum), MON/WMON (monad), BNB/WBNB/USDT/USDC (bsc).

Swap flow:
1. Call get_swap_quote → receive quoteData object
2. Show the user: "Quote: [inputAmount] [inputSymbol] → [outputAmount] [outputSymbol] (gas ~$[gasFeeUSD]). Proceed? (yes/no)"
   For Solana quotes, gasFeeUSD is not in the result — omit the gas portion.
3. On yes: call execute_swap, passing chain and the full quoteData object from step 1
4. On no: cancel

Send flow:
1. If the user specifies a USD amount (e.g. "send $5 of ETH"), call get_price first, then divide to get the token amount.
2. Call preview_send → receive sendId
3. Show the user: "Send: [amount] [token] → [to] on [chain]. Proceed? (yes/no)"
4. On yes: call execute_send with sendId
5. On no: cancel

Balance output: always include the USD value in parentheses when usdValue is present in the tool result. Format: "[formatted] [SYMBOL] (~$[usdValue])".

Multi-step flow (balance + swap in one message): When the user asks to check a balance and swap a portion or percentage of it in the same message, you MUST:
1. Call get_balance and display the result to the user ("Balance: [formatted] [SYMBOL] (~$[usdValue])")
2. Calculate the amount from the balance
3. Then call get_swap_quote with that amount
Never silently chain these calls without displaying the balance first.

On failure (ok=false): output the message field EXACTLY as returned, word for word. Do not paraphrase or summarize it.

Transaction output:
- One short sentence describing what happened.
- Plain URL on the next line (the explorerUrl from the tool result). No markdown links.`;

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY as string,
});

const or = openrouter as any;
const primaryModel = or("deepseek/deepseek-v3.2", {
  extraBody: {
    provider: {
      order: ["deepinfra/fp4", "baidu/fp8"],
      allow_fallbacks: false,
    },
  },
});
const fallbackModel = or("openai/gpt-oss-120b", {
  extraBody: {
    provider: {
      order: ["deepinfra/bf16", "google-vertex", "nebius/fp4"],
      allow_fallbacks: false,
    },
  },
});

async function generateWithFallback(params: Omit<Parameters<typeof generateText>[0], "model">) {
  try {
    return await generateText({ ...params, model: primaryModel });
  } catch (e: any) {
    const msg = (e?.message ?? "").toLowerCase();
    const isRetryable = msg.includes("rate limit") || msg.includes("429")
      || msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded");
    if (!isRetryable) throw e;
    console.warn("[x047] Primary model unavailable, switching to fallback...");
    return generateText({ ...params, model: fallbackModel });
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let conversationHistory: { role: string; content: string }[] = [];

console.log("\nx047 ready.");
console.log(`EVM    : ${account.address}`);
console.log(`Solana : ${solanaAddress}`);
console.log(`Chains : ${CHAIN_LIST}`);
console.log(`Swaps  : ${SWAP_CHAINS}\n`);

function ask() {
  rl.question("You: ", async (input) => {
    if (input.toLowerCase() === "exit") { rl.close(); return; }

    conversationHistory.push({ role: "user", content: input });

    const { text, response } = await generateWithFallback({
      tools,
      maxSteps: 10,
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
      ] as any,
    });

    conversationHistory = conversationHistory.slice(0, -1).concat(response.messages as any);
    console.log(`\nx047: ${text}\n`);
    ask();
  });
}

ask();
