/**
 * HCOW dApp — portfolio.
 *
 * Wallet balances, both lane positions, lifetime totals and the full
 * transaction history. Every row links to BscScan: the point of this screen is
 * that nothing here has to be taken on trust.
 *
 * No profit-and-loss figure is computed and no HCOW amount is converted to a
 * currency value. Deducted HCOW and received USDT are reported as they are.
 */

import { useState } from "react";
import { adapter } from "../data";
import type { BondedPosition, StakedPosition, Transaction, TxFilter, TxStatus, TxType, WalletState } from "../data";
import { T } from "../config/tokens";
import { PROTOCOL, txUrl } from "../config/constants";
import { fmtAmount, fmtDate, fmtHcow, fmtRatioPct, fmtUsdt, shortHash } from "../lib/format";
import { useAsync } from "../hooks/useAsync";
import { useErrorToast } from "../components/Toast";
import type { PushToast } from "../components/Toast";
import {
  AddressChip,
  AutoGrid,
  Badge,
  Button,
  Card,
  EmptyState,
  KV,
  LoadingBlock,
  Metric,
  MONO,
  SectionLabel,
} from "../components/ui";
import type { Route, Tone } from "../components/ui";

export interface PortfolioScreenProps {
  wallet: WalletState;
  walletKey: string;
  canRead: boolean;
  pushToast: PushToast;
  onNavigate: (route: Route) => void;
  onConnect: () => void;
}

interface PositionData {
  bonded: BondedPosition;
  staked: StakedPosition;
}

interface FilterTab {
  id: TxFilter;
  label: string;
}

const FILTERS: readonly FilterTab[] = [
  { id: "all", label: "All" },
  { id: "profit_share", label: "Profit Share" },
  { id: "network_staking", label: "Network Staking" },
  { id: "claim", label: "Claims" },
];

const TX_LABEL: Record<TxType, string> = {
  bond: "Bond",
  topup: "Top up",
  request_unbond: "Unbond requested",
  cancel_unbond: "Unbond cancelled",
  withdraw_unbonded: "Unbonded withdrawn",
  claim_usdt: `Claim ${PROTOCOL.REWARD_CURRENCY}`,
  stake: "Delegate",
  redelegate: "Redelegate",
  request_unstake: "Unstake requested",
  cancel_unstake: "Unstake cancelled",
  withdraw_unstaked: "Unstaked withdrawn",
  claim_hcow: "Claim HCOW",
  epoch_settlement: "Epoch settlement",
};

const PROFIT_TYPES: readonly TxType[] = [
  "bond",
  "topup",
  "request_unbond",
  "cancel_unbond",
  "withdraw_unbonded",
  "claim_usdt",
  "epoch_settlement",
];

const STATUS_TONE: Record<TxStatus, Tone> = {
  pending: "warn",
  confirmed: "ok",
  failed: "danger",
  auto: "info",
};

const STATUS_LABEL: Record<TxStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  failed: "Failed",
  auto: "Auto",
};

function laneOf(type: TxType): string {
  return PROFIT_TYPES.includes(type) ? "Profit Share" : "Network Staking";
}

export function PortfolioScreen({
  wallet,
  walletKey,
  canRead,
  pushToast,
  onNavigate,
  onConnect,
}: PortfolioScreenProps) {
  const [filter, setFilter] = useState<TxFilter>("all");

  const positions = useAsync<PositionData>(async () => {
    const [bonded, staked] = await Promise.all([adapter.getBondedPosition(), adapter.getStakedPosition()]);
    return { bonded, staked };
  }, [walletKey], canRead);

  const history = useAsync<Transaction[]>(() => adapter.getTxHistory(filter), [walletKey, filter], canRead);

  useErrorToast(positions.error, pushToast);
  useErrorToast(history.error, pushToast);

  if (!wallet.connected || !wallet.address) {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <SectionLabel right="Not connected">Portfolio</SectionLabel>
        <EmptyState
          title="Connect a wallet to view your portfolio"
          body="Your balances, positions across both lanes, lifetime totals and full on-chain history appear here once a wallet is connected."
          action={
            <Button variant="primary" onClick={onConnect}>
              Connect wallet
            </Button>
          }
        />
      </div>
    );
  }

  if (!canRead) {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <SectionLabel right="Wrong network">Portfolio</SectionLabel>
        <EmptyState
          title="Wrong network"
          body={`Your positions and history live on ${PROTOCOL.CHAIN_NAME}. Switch networks in your wallet to load them.`}
          tone="warn"
        />
      </div>
    );
  }

  const pos = positions.data;
  const rows = history.data;

  return (
    <div style={{ display: "grid", gap: 32 }}>
      {/* ---------------- wallet ---------------- */}
      <section>
        <SectionLabel right={`${PROTOCOL.CHAIN_NAME}`}>Connected wallet</SectionLabel>
        <Card>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
            <AddressChip address={wallet.address} label="Connected wallet" />
            <Badge tone="ok">Connected</Badge>
          </div>
          <AutoGrid min={220}>
            <Metric
              label="HCOW balance"
              value={fmtAmount(wallet.balances.hcow)}
              unit="HCOW"
              hint="In your wallet. Bonded and staked balances are listed separately."
            />
            <Metric
              label={`${PROTOCOL.GAS_TOKEN} balance`}
              value={fmtAmount(wallet.balances.bnb, 4)}
              unit={PROTOCOL.GAS_TOKEN}
              tone={wallet.balances.bnb < PROTOCOL.LOW_BNB_THRESHOLD ? "warn" : undefined}
              hint={
                wallet.balances.bnb < PROTOCOL.LOW_BNB_THRESHOLD
                  ? `Below the ${PROTOCOL.LOW_BNB_THRESHOLD} ${PROTOCOL.GAS_TOKEN} guideline for gas.`
                  : "Used for gas only."
              }
            />
            <Metric
              label={`${PROTOCOL.REWARD_CURRENCY} balance`}
              value={fmtAmount(wallet.balances.usdt)}
              unit={PROTOCOL.REWARD_CURRENCY}
              hint="From past claims."
            />
          </AutoGrid>
        </Card>
      </section>

      {/* ---------------- positions ---------------- */}
      <section>
        <SectionLabel right="Both lanes">Active positions</SectionLabel>
        {positions.loading || !pos ? (
          <LoadingBlock label="Loading your positions" rows={5} />
        ) : (
          <AutoGrid min={320}>
            <Card kicker="Profit Share · bonded deposit" title="Bonded">
              <KV label="Bonded" value={fmtHcow(pos.bonded.bondedAmount)} emphasis />
              <KV label="Share of pool" value={fmtRatioPct(pos.bonded.shareOfPool)} />
              <KV
                label="Pending unbond"
                value={pos.bonded.pendingUnbondAmount === null ? "None" : fmtHcow(pos.bonded.pendingUnbondAmount)}
                sub={pos.bonded.pendingUnbondReadyAt === null ? undefined : `Ready ${fmtDate(pos.bonded.pendingUnbondReadyAt)}`}
              />
              <KV label="Claimable" value={fmtUsdt(pos.bonded.pendingClaimUsdt)} tone="ok" />
              <div style={{ marginTop: 16 }}>
                <Button variant="secondary" block onClick={() => onNavigate("profit")}>
                  Go to Profit Share
                </Button>
              </div>
            </Card>

            <Card kicker="Network staking" title="Staked">
              <KV label="Staked" value={fmtHcow(pos.staked.stakedAmount)} emphasis />
              <KV label="Representative" value={pos.staked.delegatedTo ?? "Not delegated"} />
              <KV
                label="Pending unstake"
                value={pos.staked.pendingUnstakeAmount === null ? "None" : fmtHcow(pos.staked.pendingUnstakeAmount)}
                sub={pos.staked.pendingUnstakeReadyAt === null ? undefined : `Ready ${fmtDate(pos.staked.pendingUnstakeReadyAt)}`}
              />
              <KV label="Claimable" value={fmtHcow(pos.staked.pendingRewardHcow)} tone="ok" />
              <div style={{ marginTop: 16 }}>
                <Button variant="secondary" block onClick={() => onNavigate("staking")}>
                  Go to Network Staking
                </Button>
              </div>
            </Card>
          </AutoGrid>
        )}
      </section>

      {/* ---------------- lifetime ---------------- */}
      <section>
        <SectionLabel right="Reported separately, never netted">Lifetime totals</SectionLabel>
        {positions.loading || !pos ? (
          <LoadingBlock label="Loading lifetime totals" rows={2} />
        ) : (
          <AutoGrid min={230}>
            <Metric
              label={`${PROTOCOL.REWARD_CURRENCY} received`}
              value={fmtAmount(pos.bonded.lifetimeClaimedUsdt)}
              unit={PROTOCOL.REWARD_CURRENCY}
              tone="ok"
              hint="Claimed from Profit Share settlements."
            />
            <Metric
              label="HCOW deducted"
              value={fmtAmount(pos.bonded.lifetimeDeductedHcow)}
              unit="HCOW"
              tone="warn"
              hint="Permanently removed from your bonded balance."
            />
            <Metric
              label="HCOW rewards earned"
              value={fmtAmount(pos.staked.lifetimeRewardHcow)}
              unit="HCOW"
              hint="Claimed from Network Staking."
            />
          </AutoGrid>
        )}
      </section>

      {/* ---------------- history ---------------- */}
      <section>
        <SectionLabel right="Every action is verifiable on BscScan">Transaction history</SectionLabel>

        <div role="tablist" aria-label="Transaction filter" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {FILTERS.map((f) => {
            const selected = f.id === filter;
            return (
              <button
                key={f.id}
                id={`txtab-${f.id}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls="tx-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setFilter(f.id)}
                style={{
                  height: 32,
                  padding: "0 12px",
                  borderRadius: T.r,
                  border: `1px solid ${selected ? T.bStrong : T.bSubtle}`,
                  background: selected ? T.s2 : "transparent",
                  color: selected ? T.tPri : T.tSec,
                  fontSize: 12,
                  fontWeight: selected ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div id="tx-panel" role="tabpanel" aria-labelledby={`txtab-${filter}`} tabIndex={0}>
          <Card padding={16}>
            {history.loading || rows === null ? (
              <LoadingBlock label="Loading transaction history" rows={6} />
            ) : rows.length === 0 ? (
              <EmptyState
                title="No transactions yet"
                body="Bonding, staking, claims and automatic epoch settlements all appear here, each with a link to BscScan."
              />
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {rows.map((tx) => (
                  <TxRow key={tx.hash} tx={tx} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}

/* ============================================================
   TRANSACTION ROW
   ============================================================ */

interface TxRowProps {
  tx: Transaction;
}

function TxRow({ tx }: TxRowProps) {
  const tone = STATUS_TONE[tx.status];
  const isSettlement = tx.type === "epoch_settlement";

  return (
    <article
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
        gap: 12,
        alignItems: "center",
        padding: "14px 14px",
        borderRadius: T.rMd,
        background: T.inset,
        border: `1px solid ${tx.status === "failed" ? T.dangerBd : T.bSubtle}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.tPri }}>
          {TX_LABEL[tx.type]}
          {isSettlement && tx.meta.effectiveEpoch !== undefined ? ` · #${tx.meta.effectiveEpoch}` : ""}
        </div>
        <div style={{ fontSize: 11, color: T.tSec, marginTop: 3 }}>
          {laneOf(tx.type)}
          {tx.meta.toRepresentative ? ` · ${tx.meta.fromRepresentative ? `${tx.meta.fromRepresentative} → ` : ""}${tx.meta.toRepresentative}` : ""}
        </div>
      </div>

      <div style={{ ...MONO, fontSize: 12, color: T.tSec, minWidth: 0 }}>{fmtDate(tx.timestamp)}</div>

      <div style={{ minWidth: 0 }}>
        {tx.amount !== null ? (
          <div style={{ ...MONO, fontSize: 14, color: isSettlement ? T.warnFg : T.tPri }}>
            {isSettlement ? "− " : ""}
            {fmtHcow(tx.amount)}
          </div>
        ) : null}
        {tx.rewardAmount !== null ? (
          <div style={{ ...MONO, fontSize: 13, color: T.okFg, marginTop: 2 }}>+ {fmtUsdt(tx.rewardAmount)}</div>
        ) : null}
        {tx.amount === null && tx.rewardAmount === null ? (
          <div style={{ ...MONO, fontSize: 13, color: T.tSec }}>—</div>
        ) : null}
        {isSettlement && tx.meta.snapshotBondedHcow !== undefined ? (
          <div style={{ fontSize: 11, color: T.tSec, marginTop: 3 }}>
            Snapshot pool {fmtHcow(tx.meta.snapshotBondedHcow, 0)}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
        <Badge tone={tone}>{STATUS_LABEL[tx.status]}</Badge>
        {tx.status === "pending" ? (
          <span style={{ fontSize: 11, color: T.tSec }}>Waiting for confirmation</span>
        ) : null}
        {tx.status === "confirmed" && tx.blockNumber !== null ? (
          <span style={{ ...MONO, fontSize: 11, color: T.tSec }}>Block {tx.blockNumber}</span>
        ) : null}
        {tx.status === "failed" ? (
          <span style={{ fontSize: 11, color: T.dangerFg }}>
            {tx.meta.failureReason ?? "Reverted on chain"}
          </span>
        ) : null}
        {tx.status === "auto" ? (
          <span style={{ fontSize: 11, color: T.tSec }}>Protocol event, not user-initiated</span>
        ) : null}
      </div>

      <div style={{ justifySelf: "start" }}>
        <a
          href={txUrl(tx.hash)}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`View ${TX_LABEL[tx.type]} transaction ${tx.hash} on BscScan, opens in a new tab`}
          style={{
            ...MONO,
            fontSize: 11,
            color: T.infoFg,
            textDecoration: "none",
            padding: "6px 10px",
            borderRadius: T.r,
            border: `1px solid ${T.bDefault}`,
            display: "inline-block",
          }}
        >
          {shortHash(tx.hash)} ↗
        </a>
      </div>
    </article>
  );
}
