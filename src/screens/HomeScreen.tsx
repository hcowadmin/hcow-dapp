/**
 * HCOW dApp — dashboard.
 *
 * Ecosystem-wide data is visible without a wallet. The published waterfall for
 * the last settled epoch is the centrepiece: it is the only thing that makes a
 * net-profit split checkable from outside.
 */

import { adapter } from "../data";
import type {
  BondedPosition,
  BurnStats,
  Epoch,
  EpochDistribution,
  NetworkStats,
  PoolStats,
  StakedPosition,
  WalletState,
} from "../data";
import { T } from "../config/tokens";
import { PROTOCOL } from "../config/constants";
import { fmtAmount, fmtCountdown, fmtDate, fmtHcow, fmtInt, fmtPct, fmtRatioPct, fmtUsdt } from "../lib/format";
import { useAsync } from "../hooks/useAsync";
import { useCountdown } from "../hooks/useCountdown";
import { EpochWaterfall } from "../components/EpochWaterfall";
import { useErrorToast } from "../components/Toast";
import type { PushToast } from "../components/Toast";
import {
  Apr,
  AutoGrid,
  Badge,
  Button,
  Card,
  EmptyState,
  KV,
  LoadingBlock,
  Metric,
  MONO,
  ProgressBar,
  SectionLabel,
  Skeleton,
} from "../components/ui";
import type { Route } from "../components/ui";

export interface HomeScreenProps {
  wallet: WalletState;
  walletKey: string;
  canRead: boolean;
  pushToast: PushToast;
  onNavigate: (route: Route) => void;
  onConnect: () => void;
}

interface PublicData {
  epoch: Epoch;
  pool: PoolStats;
  burn: BurnStats;
  network: NetworkStats;
  distribution: EpochDistribution | null;
}

interface PositionData {
  bonded: BondedPosition;
  staked: StakedPosition;
}

export function HomeScreen({ wallet, walletKey, canRead, pushToast, onNavigate, onConnect }: HomeScreenProps) {
  const pub = useAsync<PublicData>(async () => {
    const [epoch, pool, burn, network, distribution] = await Promise.all([
      adapter.getEpoch(),
      adapter.getPoolStats(),
      adapter.getBurnStats(),
      adapter.getNetworkStats(),
      adapter.getLastEpochDistribution(),
    ]);
    return { epoch, pool, burn, network, distribution };
  }, []);

  const pos = useAsync<PositionData>(async () => {
    const [bonded, staked] = await Promise.all([adapter.getBondedPosition(), adapter.getStakedPosition()]);
    return { bonded, staked };
  }, [walletKey], canRead);

  useErrorToast(pub.error, pushToast);
  useErrorToast(pos.error, pushToast);

  const { remainingMs } = useCountdown(pub.data ? pub.data.epoch.endsAt : null);
  const countdown = fmtCountdown(remainingMs);

  const pool = pub.data ? pub.data.pool : null;
  const burn = pub.data ? pub.data.burn : null;
  const network = pub.data ? pub.data.network : null;

  return (
    <div style={{ display: "grid", gap: 40 }}>
      {/* ---------------- hero ---------------- */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
          gap: 24,
          alignItems: "center",
        }}
      >
        <div>
          <div
            style={{
              ...MONO,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: T.tSec,
              marginBottom: 14,
            }}
          >
            <span style={{ color: T.mint }}>●</span> Live on {PROTOCOL.CHAIN_NAME}
          </div>
          <h1 style={{ margin: "0 0 14px", fontSize: 44, lineHeight: 1.05, letterSpacing: "-0.025em", fontWeight: 700 }}>
            A published split of{" "}
            <span
              style={{
                background: T.gradient,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              game revenue
            </span>
            .
          </h1>
          <p style={{ margin: 0, maxWidth: 560, fontSize: 16, lineHeight: 1.6, color: T.tSec }}>
            HashCow distributes {PROTOCOL.DISTRIBUTION.PARTICIPANTS_PCT}% of distributable profit to bonded
            participants every {PROTOCOL.EPOCH_DAYS} days, and publishes the whole waterfall that produced it.
            Bonded balances can be reduced. Staked HCOW is locked, and is not subject to deduction.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
            <Button variant="primary" size="lg" onClick={() => onNavigate("profit")}>
              Open Profit Share
            </Button>
            <Button variant="secondary" size="lg" onClick={() => onNavigate("staking")}>
              Open Network Staking
            </Button>
          </div>
        </div>

        {/* epoch countdown */}
        <Card kicker="Current epoch" title={pub.data ? `Epoch #${pub.data.epoch.current}` : "Epoch"} elevated>
          {pub.loading || !pub.data ? (
            <LoadingBlock label="Loading epoch" rows={2} />
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <div style={{ ...MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.tSec }}>
                  {countdown === null ? "Status" : "Snapshot in"}
                </div>
                <div style={{ ...MONO, fontSize: 30, fontWeight: 500, color: T.tPri, marginTop: 6 }}>
                  {countdown ?? "Settling…"}
                </div>
              </div>
              <KV label="Snapshot at" value={fmtDate(pub.data.epoch.endsAt)} />
              <KV
                label="Network"
                value={
                  network ? (
                    <Badge tone={network.networkStatus === "healthy" ? "ok" : network.networkStatus === "degraded" ? "warn" : "danger"}>
                      {network.networkStatus}
                    </Badge>
                  ) : (
                    <Skeleton width={80} />
                  )
                }
                sub={network ? `${network.activeRepresentatives}/${network.totalRepresentatives} representatives active` : undefined}
              />
            </div>
          )}
        </Card>
      </section>

      {/* ---------------- ecosystem metrics ---------------- */}
      <section>
        <SectionLabel right={pool ? `Updated ${fmtDate(pool.lastUpdatedAt)}` : "Loading"}>
          Ecosystem metrics
        </SectionLabel>
        <AutoGrid min={230}>
          <Metric
            label="Gross received · 24h"
            value={pool ? fmtAmount(pool.grossReceivedUsdtToday) : <Skeleton width={120} height={24} />}
            unit={pool ? PROTOCOL.REWARD_CURRENCY : undefined}
            hint="Rolling 24 hours, receipt basis."
          />
          <Metric
            label="Gross received · 7d"
            value={pool ? fmtAmount(pool.grossReceivedUsdt7d) : <Skeleton width={120} height={24} />}
            unit={pool ? PROTOCOL.REWARD_CURRENCY : undefined}
            hint="Money actually received into the vault."
          />
          <Metric
            label="Paid to participants · 30d"
            value={pool ? fmtAmount(pool.distributedToParticipantsUsdt30d) : <Skeleton width={120} height={24} />}
            unit={pool ? PROTOCOL.REWARD_CURRENCY : undefined}
            hint="Settled and claimable, not a forecast."
            tone="ok"
          />
          <Metric
            label="Estimated APR"
            value={pool ? <Apr pct={pool.estimatedAprPct} /> : <Skeleton width={90} height={24} />}
          />
          <Metric
            label="Total bonded"
            value={pool ? fmtAmount(pool.totalBondedHcow, 0) : <Skeleton width={120} height={24} />}
            unit="HCOW"
            hint={pool ? `${fmtInt(pool.participants)} participants` : undefined}
          />
          <Metric
            label="Total burned"
            value={burn ? fmtAmount(burn.totalBurnedHcow, 0) : <Skeleton width={120} height={24} />}
            unit="HCOW"
            tone="burn"
            hint={
              burn
                ? `${fmtPct(burn.percentOfSupply, 2)} of ${fmtInt(PROTOCOL.TOKEN_TOTAL_SUPPLY)} HCOW supply. Supply level, not your balance.`
                : undefined
            }
          />
        </AutoGrid>

        {pool ? (
          <div style={{ marginTop: 16 }}>
            <Card
              kicker="Provability · last 30 days"
              title={`${fmtRatioPct(pool.chainVerifiableRatio30d, 1)} of gross received was chain verifiable`}
            >
              <ProgressBar ratio={pool.chainVerifiableRatio30d} label="Chain verifiable share of gross received over 30 days" />
              <p style={{ margin: "12px 0 0", fontSize: 12, color: T.tSec, lineHeight: 1.6 }}>
                The rest arrived off chain and is attested by published payout statements paired with the on-chain
                deposit that carried it in. Per-line detail is in the epoch waterfall below.
              </p>
            </Card>
          </div>
        ) : null}
      </section>

      {/* ---------------- your position ---------------- */}
      <section>
        <SectionLabel right={wallet.connected && wallet.address ? "Your position" : "Not connected"}>
          Your position
        </SectionLabel>

        {!wallet.connected ? (
          <EmptyState
            title="Connect a wallet to see your position"
            body="Ecosystem data above is public. Connect a wallet to view your bonded and staked balances, claim, and act on either lane."
            action={
              <Button variant="primary" onClick={onConnect}>
                Connect wallet
              </Button>
            }
          />
        ) : !canRead ? (
          <EmptyState
            title="Wrong network"
            body={`Your position lives on ${PROTOCOL.CHAIN_NAME}. Switch networks in your wallet to load it.`}
            tone="warn"
          />
        ) : pos.loading || !pos.data ? (
          <LoadingBlock label="Loading your position" rows={4} />
        ) : (
          <AutoGrid min={320}>
            <Card
              kicker="Profit Share · bonded deposit"
              title="Bonded HCOW"
              right={<Badge tone={pos.data.bonded.status === "active" ? "ok" : "warn"}>{pos.data.bonded.status.replace("_", " ")}</Badge>}
            >
              <KV label="Bonded" value={fmtHcow(pos.data.bonded.bondedAmount)} emphasis />
              <KV label="Share of pool" value={fmtRatioPct(pos.data.bonded.shareOfPool)} />
              <KV label="Claimable" value={fmtUsdt(pos.data.bonded.pendingClaimUsdt)} tone="ok" />
              <KV
                label="Deducted to date"
                value={fmtHcow(pos.data.bonded.lifetimeDeductedHcow)}
                sub="Permanent, metered by RNG and VRF usage."
              />
              <div style={{ marginTop: 16 }}>
                <Button variant="secondary" block onClick={() => onNavigate("profit")}>
                  Go to Profit Share
                </Button>
              </div>
            </Card>

            <Card
              kicker="Network staking"
              title="Staked HCOW"
              right={<Badge tone={pos.data.staked.status === "active" ? "ok" : "info"}>{pos.data.staked.status.replace("_", " ")}</Badge>}
            >
              <KV label="Staked" value={fmtHcow(pos.data.staked.stakedAmount)} emphasis />
              <KV label="Delegated to" value={pos.data.staked.delegatedTo ?? "Not delegated"} />
              <KV label="Claimable" value={fmtHcow(pos.data.staked.pendingRewardHcow)} tone="ok" />
              <KV label="Estimated APR" value={<Apr pct={pos.data.staked.estimatedAprPct} size="sm" />} />
              <div style={{ marginTop: 16 }}>
                <Button variant="secondary" block onClick={() => onNavigate("staking")}>
                  Go to Network Staking
                </Button>
              </div>
            </Card>
          </AutoGrid>
        )}
      </section>

      {/* ---------------- last epoch waterfall ---------------- */}
      <section>
        <SectionLabel right="Published each epoch">Last settled epoch</SectionLabel>
        <Card>
          {pub.loading ? (
            <LoadingBlock label="Loading the last epoch distribution" rows={6} />
          ) : pub.data && pub.data.distribution ? (
            <EpochWaterfall distribution={pub.data.distribution} />
          ) : (
            <EmptyState
              title="No settled epoch yet"
              body="Nothing has been distributed so far. The full waterfall — gross received, direct costs, net revenue, capped operating costs and the split — appears here as soon as the first epoch settles."
            />
          )}
        </Card>
      </section>

      {/* ---------------- burn ---------------- */}
      <section>
        <SectionLabel right="Supply level · not your balance">HCOW burn</SectionLabel>
        <Card>
          {burn ? (
            <AutoGrid min={220}>
              <Metric label="Burned today" value={fmtAmount(burn.burnedToday, 0)} unit="HCOW" tone="burn" />
              <Metric label="Burned this epoch" value={fmtAmount(burn.burnedThisEpoch, 0)} unit="HCOW" tone="burn" />
              <Metric
                label={`Tx fee burn · 30d (${PROTOCOL.BURN.TX_FEE_PCT}%)`}
                value={fmtAmount(burn.last30dTxFeeBurn, 0)}
                unit="HCOW"
              />
              <Metric
                label={`In-game burn · 30d (${PROTOCOL.BURN.NATIVE_GAME_PCT}%)`}
                value={fmtAmount(burn.last30dGamePaymentBurn, 0)}
                unit="HCOW"
              />
            </AutoGrid>
          ) : (
            <LoadingBlock label="Loading burn statistics" rows={2} />
          )}
          <p style={{ margin: "16px 0 0", fontSize: 12, color: T.tSec, lineHeight: 1.6 }}>
            Burning reduces total HCOW supply across the whole ecosystem. It is unrelated to any individual bonded
            or staked balance.
          </p>
        </Card>
      </section>
    </div>
  );
}
