import "dotenv/config";
import { getOnChainTools } from "@goat-sdk/adapter-vercel-ai";
import { viem } from "@goat-sdk/wallet-viem";
import { erc20 } from "@goat-sdk/plugin-erc20";
import { uniswap } from "@goat-sdk/plugin-uniswap";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, sepolia, arbitrum, optimism, mainnet, monad } from "viem/chains";

// --- Types ---

export type TokenConfig = {
  symbol: string;
  decimals: number;
  chains: Record<string, { contractAddress: string }>;
};

export type ChainEntry = {
  chain: any;
  rpcEnvVar: string;
  label: string;
  explorer: string;
  swapPlugin: "uniswap" | null;
  tokens: Record<string, TokenConfig>;
};

// --- Chain registry ---
// To add a new chain: one entry here. Nothing else changes.

export const chainRegistry: Record<string, ChainEntry> = {
  base: {
    chain: base,
    rpcEnvVar: "BASE_RPC_URL",
    label: "Base mainnet",
    explorer: "https://basescan.org/tx",
    swapPlugin: "uniswap",
    tokens: {
      USDC: { symbol: "USDC", decimals: 6,  chains: { "8453": { contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } } },
      WETH: { symbol: "WETH", decimals: 18, chains: { "8453": { contractAddress: "0x4200000000000000000000000000000000000006" } } },
      ETH:  { symbol: "ETH",  decimals: 18, chains: { "8453": { contractAddress: "0x0000000000000000000000000000000000000000" } } },
    },
  },
  baseSepolia: {
    chain: baseSepolia,
    rpcEnvVar: "BASE_SEPOLIA_RPC_URL",
    label: "Base Sepolia",
    explorer: "https://sepolia.basescan.org/tx",
    swapPlugin: null,
    tokens: {
      USDC: { symbol: "USDC", decimals: 6,  chains: { "84532": { contractAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" } } },
      WETH: { symbol: "WETH", decimals: 18, chains: { "84532": { contractAddress: "0x4200000000000000000000000000000000000006" } } },
      ETH:  { symbol: "ETH",  decimals: 18, chains: { "84532": { contractAddress: "0x0000000000000000000000000000000000000000" } } },
    },
  },
  sepolia: {
    chain: sepolia,
    rpcEnvVar: "ETH_SEPOLIA_RPC_URL",
    label: "Ethereum Sepolia",
    explorer: "https://sepolia.etherscan.io/tx",
    swapPlugin: null,
    tokens: {
      USDC: { symbol: "USDC", decimals: 6,  chains: { "11155111": { contractAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" } } },
      WETH: { symbol: "WETH", decimals: 18, chains: { "11155111": { contractAddress: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" } } },
      ETH:  { symbol: "ETH",  decimals: 18, chains: { "11155111": { contractAddress: "0x0000000000000000000000000000000000000000" } } },
    },
  },
  arbitrum: {
    chain: arbitrum,
    rpcEnvVar: "ARBITRUM_RPC_URL",
    label: "Arbitrum mainnet",
    explorer: "https://arbiscan.io/tx",
    swapPlugin: "uniswap",
    tokens: {
      USDC:  { symbol: "USDC",  decimals: 6,  chains: { "42161": { contractAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" } } },
      WETH:  { symbol: "WETH",  decimals: 18, chains: { "42161": { contractAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" } } },
      ETH:   { symbol: "ETH",   decimals: 18, chains: { "42161": { contractAddress: "0x0000000000000000000000000000000000000000" } } },
      USDT0: { symbol: "USDT0", decimals: 6,  chains: { "42161": { contractAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" } } },
    },
  },
  optimism: {
    chain: optimism,
    rpcEnvVar: "OPTIMISM_RPC_URL",
    label: "Optimism mainnet",
    explorer: "https://optimistic.etherscan.io/tx",
    swapPlugin: "uniswap",
    tokens: {
      USDC:  { symbol: "USDC",  decimals: 6,  chains: { "10": { contractAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" } } },
      WETH:  { symbol: "WETH",  decimals: 18, chains: { "10": { contractAddress: "0x4200000000000000000000000000000000000006" } } },
      ETH:   { symbol: "ETH",   decimals: 18, chains: { "10": { contractAddress: "0x0000000000000000000000000000000000000000" } } },
      USDT0: { symbol: "USDT0", decimals: 6,  chains: { "10": { contractAddress: "0x01bFF41798a0BcF287b996046Ca68b395DbC1071" } } },
    },
  },
  ethereum: {
    chain: mainnet,
    rpcEnvVar: "ETH_MAINNET_RPC_URL",
    label: "Ethereum mainnet",
    explorer: "https://etherscan.io/tx",
    swapPlugin: "uniswap",
    tokens: {
      USDC: { symbol: "USDC", decimals: 6,  chains: { "1": { contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" } } },
      WETH: { symbol: "WETH", decimals: 18, chains: { "1": { contractAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" } } },
      ETH:  { symbol: "ETH",  decimals: 18, chains: { "1": { contractAddress: "0x0000000000000000000000000000000000000000" } } },
      USDT: { symbol: "USDT", decimals: 6,  chains: { "1": { contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7" } } },
    },
  },
  monad: {
    chain: monad,
    rpcEnvVar: "MONAD_RPC_URL",
    label: "Monad mainnet",
    explorer: "https://monadscan.com/tx",
    swapPlugin: "uniswap",
    tokens: {
      MON:   { symbol: "MON",   decimals: 18, chains: { "143": { contractAddress: "0x0000000000000000000000000000000000000000" } } },
      WMON:  { symbol: "WMON",  decimals: 18, chains: { "143": { contractAddress: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" } } },
      USDC:  { symbol: "USDC",  decimals: 6,  chains: { "143": { contractAddress: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" } } },
      USDT0: { symbol: "USDT0", decimals: 6,  chains: { "143": { contractAddress: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D" } } },
    },
  },
};

// --- Wallet (raw viem — swap to Crossmint here when ready) ---

export const account = privateKeyToAccount(process.env.WALLET_PRIVATE_KEY as `0x${string}`);

export function buildClients() {
  return Object.fromEntries(
    Object.entries(chainRegistry).map(([name, cfg]) => [
      name,
      createWalletClient({
        account,
        chain: cfg.chain,
        transport: http(process.env[cfg.rpcEnvVar]),
      }),
    ])
  ) as Record<string, ReturnType<typeof createWalletClient>>;
}

// --- Token list builder ---
// Merges same-symbol tokens across chains into one entry with all chain addresses.
// Without this, _resolveToken picks the first USDC match regardless of active chain.

function buildAllTokens(): TokenConfig[] {
  const merged: Record<string, TokenConfig> = {};
  for (const cfg of Object.values(chainRegistry)) {
    for (const token of Object.values(cfg.tokens)) {
      if (merged[token.symbol]) {
        Object.assign(merged[token.symbol].chains, token.chains);
      } else {
        merged[token.symbol] = { ...token, chains: { ...token.chains } };
      }
    }
  }
  return Object.values(merged);
}

const uniswapConfig = {
  baseUrl: "https://trade-api.gateway.uniswap.org/v1",
  apiKey: process.env.UNISWAP_API_KEY as string,
  tokens: buildAllTokens(),
};

// --- Tool sets (auto-built from registry) ---

export async function buildToolSets(clients: ReturnType<typeof buildClients>) {
  const entries = await Promise.all(
    Object.entries(chainRegistry).map(async ([name, cfg]) => {
      const plugins: any[] = [erc20({ tokens: Object.values(cfg.tokens) })];
      if (cfg.swapPlugin === "uniswap") plugins.push(uniswap(uniswapConfig));
      return [name, await getOnChainTools({ wallet: viem(clients[name]), plugins })];
    })
  );
  return Object.fromEntries(entries) as Record<string, any>;
}
