import { parseEther } from "viem";
import { chainRegistry } from "../config";
import { clients, toolSets, resolveToken, fetchDecimals, toBaseUnits } from "./shared";
import { sendSolanaToken } from "./solana";

export type TransferResult =
  | { ok: true; txHash: string; explorerUrl: string }
  | { ok: false; error: string; message: string };

export async function sendToken(
  chain: string,
  token: string,
  to: string,
  amount: number
): Promise<TransferResult> {
  if (chain === "solana") return sendSolanaToken(token, to, amount);
  try {
    const cfg = chainRegistry[chain];
    const resolvedCA = resolveToken(token, chain);

    if (resolvedCA === "0x0000000000000000000000000000000000000000") {
      const txHash = await clients[chain].sendTransaction({
        to: to as `0x${string}`,
        value: parseEther(amount.toString()),
      });
      return { ok: true, txHash, explorerUrl: `${cfg.explorer}/${txHash}` };
    }

    const decimals = await fetchDecimals(resolvedCA, chain);
    const amountBase = toBaseUnits(amount, decimals);
    const txHash = await toolSets[chain].transfer.execute({
      tokenAddress: resolvedCA,
      to,
      amount: amountBase,
    });
    return { ok: true, txHash, explorerUrl: `${cfg.explorer}/${txHash}` };
  } catch (e: any) {
    return { ok: false, error: "send_failed", message: e.message };
  }
}
