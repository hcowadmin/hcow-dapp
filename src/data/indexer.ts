/**
 * HCOW dApp — Event index client
 *
 * Reads the `chain_events` table over Supabase's REST layer. The rollup views
 * (epoch_settlements, revenue_windows) are no longer read: settlements and the
 * rolling windows come from the contract itself (adapter v0.4.6).
 *
 * Plain fetch rather than the Supabase SDK: this is two read queries, and
 * pulling in a client library for them would add more to the bundle than the
 * whole adapter.
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
    const body: unknown = await res.json();
    // Anything but an array is not a result set (audit 6, M-2). The rows
    // themselves are checked field by field where they are used.
    return Array.isArray(body) ? (body as T[]) : null;
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
  /** Present on every row the table returns; optional so a caller can tell "absent" from "other". */
  contract?: string;
  chain_id?: number;
}

/**
 * The contracts whose events belong in this deployment's history, lower case.
 * The table is shared: chain 97 also holds the retired August deployment, and
 * a mainnet build pointed at the same index would otherwise list testnet rows
 * as its own (2026-09-26, observed on a live wallet).
 */
export const accountEventContracts = (): string[] =>
  [DEPLOYMENT.addresses.profitShare, DEPLOYMENT.addresses.staking, DEPLOYMENT.addresses.ledger]
    .filter((a) => a.length > 0)
    .map((a) => a.toLowerCase());

/**
 * Most recent first. `limit` is a hard cap, not a page size: there is no UI for paging yet.
 * Filtered to this chain and these contracts on the server, so rows from another
 * deployment cannot use up the cap. ilike without wildcards is a case-insensitive equality.
 */
export const eventsForAccount = (address: string, limit = 100) =>
  query<ChainEventRow>(
    `chain_events?account=eq.${address.toLowerCase()}` +
      `&chain_id=eq.${DEPLOYMENT.chainId}` +
      `&or=(${accountEventContracts().map((a) => `contract.ilike.${a}`).join(",")})` +
      `&order=block_number.desc,log_index.desc&limit=${limit}`
  );

export interface SettlementTxRow {
  tx_hash: string;
}

/**
 * The transaction that closed `epoch` on the configured HCOWProfitShare.
 * Filtered by contract: the epoch_settlements view has no contract column,
 * and chain 97 also holds the retired August deployment, whose epoch 0 row
 * would otherwise be linked from the current contract's epoch 0 (audit 6
 * follow-up, 2026-09-24). Includes StalledEpochClosed, which also ends an
 * epoch. ilike without wildcards is a case-insensitive equality.
 */
export const settlementForEpoch = (epoch: number) =>
  query<SettlementTxRow>(
    `chain_events?select=tx_hash&chain_id=eq.${DEPLOYMENT.chainId}` +
      `&event=in.(EpochSettled,StalledEpochClosed)` +
      `&contract=ilike.${DEPLOYMENT.addresses.profitShare}` +
      `&epoch=eq.${epoch}&order=block_number.desc&limit=1`
  );
