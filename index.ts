import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { account, buildClients, buildToolSets, chainRegistry } from "./config";
import * as readline from "readline";

const clients = buildClients();
const toolSets = await buildToolSets(clients);

const chainConfig = Object.fromEntries(
  Object.entries(chainRegistry).map(([name, cfg]) => [
    name,
    { label: cfg.label, swaps: cfg.swapPlugin !== null, explorer: cfg.explorer },
  ])
);

// --- Agent ---
const model = openai("gpt-4o");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let currentChain = "base";
let conversationHistory: { role: string; content: string }[] = [];

console.log("\nSwap agent ready.");
console.log(`Active chain : ${chainConfig[currentChain].label}`);
console.log(`Switch chain : type  switch to <name>`);
console.log(`Valid chains : ${Object.keys(chainRegistry).join(" | ")}`);
console.log(`Swaps on     : ${Object.entries(chainConfig).filter(([,c]) => c.swaps).map(([n]) => n).join(", ")}\n`);

function buildSystemPrompt(chain: string) {
  const cfg = chainConfig[chain];
  return `You are a helpful onchain assistant. Active chain: ${cfg.label}. ${cfg.swaps ? "Swaps are available." : "No swaps on this chain — testnet only. Balances and transfers work."}
Wallet address: ${account.address}

Rules for Uniswap tools:
- Always pass contract addresses (not symbols) for tokenIn and tokenOut.
- Always use the wallet address above for walletAddress fields — never use a placeholder.
- When passing amount to any tool, it must be a whole integer in base units — floor any decimal result before passing.
- Token balances are returned as JSON with raw (base units), formatted (human-readable), and decimals fields. Always display the formatted value to the user.

Swap confirmation:
- Before calling uniswap_swap_tokens, you MUST call uniswap_get_quote first, then present the quote to the user in this exact format:
  "Quote: [amount_in] [TOKEN_IN] (~$USD_IN) → [amount_out] [TOKEN_OUT] (~$USD_OUT). Proceed with this swap? (yes/no)"
- For USD estimates: USDC/USDT/DAI are $1 per token. For other tokens, derive the price from the exchange rate shown in the quote.
- Do NOT call uniswap_swap_tokens until the user explicitly confirms with "yes".
- If the user says "no" or anything other than a clear confirmation, cancel the swap.

Transaction links:
- Always display transaction hashes as plain URLs — no markdown, no raw hex.
- Write a short, specific message describing what happened, then the URL on the next line.
- Example for a swap: "Swapped 5 USDC for 0.0013 ETH successfully.\nView on explorer: ${cfg.explorer}/0xabc123"
- Example for a transfer: "Sent 10 USDC to 0x1234...abcd.\nView on explorer: ${cfg.explorer}/0xabc123"`;
}

function ask() {
  rl.question(`[${currentChain}] You: `, async (input) => {
    if (input.toLowerCase() === "exit") { rl.close(); return; }

    // Chain switching — clears history since chain context changes
    if (input.startsWith("switch to ")) {
      const target = input.replace("switch to ", "").trim();
      if (chainConfig[target]) {
        currentChain = target;
        conversationHistory = [];
        const cfg = chainConfig[target];
        console.log(`\nSwitched to ${cfg.label}. Swaps: ${cfg.swaps ? "enabled" : "disabled (testnet)"}\n`);
      } else {
        console.log(`\nUnknown chain. Valid options: ${Object.keys(chainConfig).join(", ")}\n`);
      }
      ask(); return;
    }

    conversationHistory.push({ role: "user", content: input });

    const { text, response } = await generateText({
      model,
      tools: toolSets[currentChain],
      maxSteps: 10,
      messages: [
        { role: "system", content: buildSystemPrompt(currentChain) },
        ...conversationHistory,
      ] as any,
    });

    // Preserve full response messages (including tool calls/results) for next turn
    conversationHistory = conversationHistory.slice(0, -1).concat(response.messages as any);

    console.log(`\nAgent: ${text}\n`);
    ask();
  });
}

ask();
