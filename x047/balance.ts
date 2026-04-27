import { account, toolSets } from "./shared";
import { getSolanaBalance } from "./solana";

export type BalanceResult =
  | { ok: true; raw: string; formatted: string; decimals: number; usdValue: string | null }
  | { ok: false; error: string };

const STABLECOINS = new Set(["USDC", "USDT", "USDT0", "DAI"]);

// Pyth price IDs — strip 0x prefix for Hermes v2
const PYTH_IDS: Record<string, string> = {
  ETH:  "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  WETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  BNB:  "2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
  WBNB: "2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
};

async function getUsdPrice(symbol: string): Promise<number | null> {
  const upper = symbol.toUpperCase();
  if (STABLECOINS.has(upper)) return 1;
  const id = PYTH_IDS[upper];
  if (!id) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${id}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    const data = await res.json() as { parsed: Array<{ price: { price: string; expo: number } }> };
    const { price, expo } = data.parsed[0].price;
    return Number(price) * 10 ** expo;
  } catch {
    return null;
  }
}

export async function getBalance(chain: string, token: string): Promise<BalanceResult> {
  if (chain === "solana") return getSolanaBalance(token);
  try {
    const tokenAddress = token.startsWith("0x") ? token : token.toUpperCase();
    const raw = await toolSets[chain].get_token_balance.execute({
      wallet: account.address,
      tokenAddress,
    });
    const parsed = JSON.parse(raw);
    const symbol = token.startsWith("0x") ? null : token.toUpperCase();
    const price = symbol ? await getUsdPrice(symbol) : null;
    const usdValue = price !== null ? (parseFloat(parsed.formatted) * price).toFixed(2) : null;
    return { ok: true, ...parsed, usdValue };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
