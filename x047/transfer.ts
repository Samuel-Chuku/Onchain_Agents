import { parseEther } from "viem";
import { chainRegistry } from "../config";
import { clients, toolSets, resolveToken, fetchDecimals, toBaseUnits } from "./shared";
import { sendSolanaToken } from "./solana";

export type TransferResult =
  | { ok: true; txHash: string; explorerUrl: string }
  | { ok: false; error: string; message: string };

const sendCache = new Map<string, { data: { chain: string; token: string; to: string; amount: number }; timestamp: number }>();
let sendSeq = 0;
const SEND_TTL_MS = 60_000;

export function previewSend(chain: string, token: string, to: string, amount: number) {
  const sendId = `s_${++sendSeq}`;
  sendCache.set(sendId, { data: { chain, token, to, amount }, timestamp: Date.now() });
  return { sendId, chain, token, to, amount };
}

export async function resolveAndSend(sendId: string): Promise<TransferResult> {
  const entry = sendCache.get(sendId);
  if (!entry) return { ok: false, error: "send_not_found", message: "Send not found — please resubmit." };
  if (Date.now() - entry.timestamp > SEND_TTL_MS) {
    sendCache.delete(sendId);
    return { ok: false, error: "send_expired", message: "Send expired — please resubmit." };
  }
  sendCache.delete(sendId);
  const { chain, token, to, amount } = entry.data;
  return sendToken(chain, token, to, amount);
}

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
