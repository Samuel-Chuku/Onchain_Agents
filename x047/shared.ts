import "dotenv/config";
import { createPublicClient, http } from "viem";
import { account, buildClients, buildToolSets, chainRegistry } from "../config";

export { account, chainRegistry };

export const clients = buildClients();
export const toolSets = await buildToolSets(clients);

export const publicClients = Object.fromEntries(
  Object.entries(chainRegistry).map(([name, cfg]) => [
    name,
    createPublicClient({ chain: cfg.chain, transport: http(process.env[cfg.rpcEnvVar]) }),
  ])
);

export function toBaseUnits(amount: number, decimals: number): string {
  return String(Math.floor(amount * 10 ** decimals));
}

export function resolveToken(input: string, chain: string): string {
  if (input.startsWith("0x")) return input;
  const chainIdStr = String(chainRegistry[chain].chain.id);
  const token = chainRegistry[chain].tokens[input.toUpperCase()];
  if (token?.chains[chainIdStr]) return token.chains[chainIdStr].contractAddress;
  throw new Error(`Unknown token "${input}" on ${chain}. Provide a contract address.`);
}

const decimalsAbi = [{
  name: "decimals",
  type: "function" as const,
  inputs: [] as const,
  outputs: [{ name: "", type: "uint8" as const }],
  stateMutability: "view" as const,
}];

export async function fetchDecimals(ca: string, chain: string): Promise<number> {
  const chainIdStr = String(chainRegistry[chain].chain.id);
  for (const token of Object.values(chainRegistry[chain].tokens)) {
    if (token.chains[chainIdStr]?.contractAddress.toLowerCase() === ca.toLowerCase()) {
      return token.decimals;
    }
  }
  return Number(
    await publicClients[chain].readContract({
      address: ca as `0x${string}`,
      abi: decimalsAbi,
      functionName: "decimals",
    })
  );
}
