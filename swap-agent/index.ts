import "dotenv/config";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { getOnChainTools } from "@goat-sdk/adapter-vercel-ai";
import { viem } from "@goat-sdk/wallet-viem";
import { erc20 } from "@goat-sdk/plugin-erc20";
import { uniswap } from "@goat-sdk/plugin-uniswap";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, sepolia, arbitrum } from "viem/chains";
import * as readline from "readline";

const tokens = {
  base: {
    USDC: { symbol: "USDC", decimals: 6,  chains: { "8453":    { contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } } },
    WETH: { symbol: "WETH", decimals: 18, chains: { "8453":    { contractAddress: "0x4200000000000000000000000000000000000006" } } },
    ETH:  { symbol: "ETH",  decimals: 18, chains: { "8453":    { contractAddress: "0x0000000000000000000000000000000000000000" } } },
  },
  baseSepolia: {
    USDC: { symbol: "USDC", decimals: 6,  chains: { "84532":   { contractAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" } } },
    WETH: { symbol: "WETH", decimals: 18, chains: { "84532":   { contractAddress: "0x4200000000000000000000000000000000000006" } } },
    ETH:  { symbol: "ETH",  decimals: 18, chains: { "84532":   { contractAddress: "0x0000000000000000000000000000000000000000" } } },
  },
  sepolia: {
    USDC: { symbol: "USDC", decimals: 6,  chains: { "11155111":{ contractAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" } } },
    WETH: { symbol: "WETH", decimals: 18, chains: { "11155111":{ contractAddress: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" } } },
    ETH:  { symbol: "ETH",  decimals: 18, chains: { "11155111":{ contractAddress: "0x0000000000000000000000000000000000000000" } } },
  },
  arbitrum: {
    USDC: { symbol: "USDC", decimals: 6,  chains: { "42161":   { contractAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" } } },
    WETH: { symbol: "WETH", decimals: 18, chains: { "42161":   { contractAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" } } },
    ETH:  { symbol: "ETH",  decimals: 18, chains: { "42161":   { contractAddress: "0x0000000000000000000000000000000000000000" } } },
  },
};

const account = privateKeyToAccount(process.env.WALLET_PRIVATE_KEY as `0x${string}`);

const clients = {
  base:        createWalletClient({ account, chain: base,        transport: http(process.env.BASE_RPC_URL) }),
  baseSepolia: createWalletClient({ account, chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) }),
  sepolia:     createWalletClient({ account, chain: sepolia,     transport: http(process.env.ETH_SEPOLIA_RPC_URL) }),
  arbitrum:    createWalletClient({ account, chain: arbitrum,    transport: http(process.env.ARBITRUM_RPC_URL) }),
};

const allTokens = Object.values(tokens).flatMap(chainTokens => Object.values(chainTokens));

const uniswapConfig = {
  baseUrl: "https://trade-api.gateway.uniswap.org/v1",
  apiKey: process.env.UNISWAP_API_KEY as string,
  tokens: allTokens,
};

const toolSets = {
  base:        await getOnChainTools({ wallet: viem(clients.base),        plugins: [erc20({ tokens: Object.values(tokens.base) }),        uniswap(uniswapConfig)] }),
  baseSepolia: await getOnChainTools({ wallet: viem(clients.baseSepolia), plugins: [erc20({ tokens: Object.values(tokens.baseSepolia) })] }),
  sepolia:     await getOnChainTools({ wallet: viem(clients.sepolia),     plugins: [erc20({ tokens: Object.values(tokens.sepolia) })] }),
  arbitrum:    await getOnChainTools({ wallet: viem(clients.arbitrum),    plugins: [erc20({ tokens: Object.values(tokens.arbitrum) }),     uniswap(uniswapConfig)] }),
};

const chainConfig: Record<string, { label: string; swaps: boolean }> = {
  base:        { label: "Base mainnet",     swaps: true },
  baseSepolia: { label: "Base Sepolia",     swaps: false },
  sepolia:     { label: "Ethereum Sepolia", swaps: false },
  arbitrum:    { label: "Arbitrum mainnet", swaps: true },
};

const model = openai("gpt-4o");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let currentChain = "base";

console.log("\nSwap agent ready.");
console.log(`Active chain : ${chainConfig[currentChain].label}`);
console.log(`Switch chain : type  switch to <name>`);
console.log(`Valid chains : base | baseSepolia | sepolia | arbitrum`);
console.log(`Swaps on     : base, arbitrum (mainnet only)\n`);

function ask() {
  rl.question(`[${currentChain}] You: `, async (input) => {
    if (input.toLowerCase() === "exit") { rl.close(); return; }

    if (input.startsWith("switch to ")) {
      const target = input.replace("switch to ", "").trim();
      if (chainConfig[target]) {
        currentChain = target;
        const cfg = chainConfig[target];
        console.log(`\nSwitched to ${cfg.label}. Swaps: ${cfg.swaps ? "enabled" : "disabled (testnet)"}\n`);
      } else {
        console.log(`\nUnknown chain. Valid options: ${Object.keys(chainConfig).join(", ")}\n`);
      }
      ask(); return;
    }

    const { text } = await generateText({
      model,
      tools: toolSets[currentChain],
      maxSteps: 10,
      messages: [
        {
          role: "system",
          content: `You are a helpful onchain assistant. Active chain: ${chainConfig[currentChain].label}. ${chainConfig[currentChain].swaps ? "Swaps are available." : "No swaps on this chain — testnet only. Balances and transfers work."}
Wallet address: ${account.address}
Rules for Uniswap tools:
- Always pass contract addresses (not symbols) for tokenIn and tokenOut.
- Always use the wallet address above for walletAddress fields — never use a placeholder.
- When passing amount to any tool, it must be a whole integer in base units — floor any decimal result before passing.
- Token balances are returned as JSON with raw (base units), formatted (human-readable), and decimals fields. Always display the formatted value to the user.`,
        },
        { role: "user", content: input },
      ],
    });

    console.log(`\nAgent: ${text}\n`);
    ask();
  });
}

ask();
