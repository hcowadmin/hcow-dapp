/**
 * HCOW dApp — Event index client
 *
 * Reads the `chain_events` table and its two rollup views over Supabase's
 * REST layer. Plain fetch rather than the Supabase SDK: this is four read
 * queries, and pulling in a client library for them would add more to the
 * bundle than the whole adapter.
 *
 * Everything here is optional. If `VITE_INDEXER_URL` is not set, or the
 * request fails, each function returns null and the adapter reports the
 * corresponding field as empty. A dashboard that quietly falls back to zero is
 * a bug; one that reports "no history available" is not, so the adapter must
 * treat null as "unknown" and never as "none".
 *
 * The key used here is the anon key, which is public by design. The table is
 * world readable because it holds public chain data, and row level security
 * blocks every write from this key. Nothing sensitive passes through here.
 */

import { DEPLOYMENT } from "../config/deployment";

export const indexerConfigured = (): boolean =>
  DEPLOYMENT.indexerUrl.length > 0 && DEPLOYMENT.indexerKey.length > 0;

async function query<T>(path: string): Promise<T[] | null> {
  if (!indexerConfigured()) return null;
  try {
    const res = await fetch(`${DEPLOYMENT.indexerUrl}/rest/v1/${path}`, {
      headers: {
        apikey: DEPLOYMENT.indexerKey,
        authorization: `Bearer ${DEPLOYMENT.indexerKey}`,
        accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T[];
  } catch {
    // The index being unreachable must never break a page that can still read
    // balances straight from the chain.
    return null;
  }
}

export interface ChainEventRow {
  event: string;
  block_number: number;
  block_time: string;
  tx_hash: string;
  log_index: number;
  account: string | null;
  epoch: number | null;
  args: Record<string, string>;
}

export interface SettlementRow {
  epoch: number;
  settled_at: string;
  tx_hash: string;
  gross_received_usdt: string;
  participants_usdt: string;
  hcow_deducted: string;
}

export interface WindowRow {
  gross_24h: string;
  gross_7d: string;
  gross_30d: string;
  participants_30d: string;
  burned_24h: string;
  burned_30d: string;
}

/** Most recent first. `limit` is a hard cap, not a page size: there is no UI for paging yet. */
export const eventsForAccount = (address: string, limit = 100) =>
  query<ChainEventRow>(
    `chain_events?account=eq.${address.toLowerCase()}` +
      `&order=block_number.desc,log_index.desc&limit=${limit}`
  );

export const settlementForEpoch = (epoch: number) =>
  query<SettlementRow>(`epoch_settlements?epoch=eq.${epoch}&limit=1`);

export const revenueWindows = () =>
  query<WindowRow>(`revenue_windows?chain_id=eq.${DEPLOYMENT.chainId}&limit=1`);
