/**
 * HCOW dApp — Profit Share lane (bonded deposit).
 *
 * The deduction risk is stated permanently at the top of the screen and again
 * inside every write dialog. A first bond cannot be signed until the user
 * acknowledges it explicitly.
 *
 * The lane is fully round-trippable: bond / top up, request unbond, cancel a
 * request, and withdraw once the cooldown has elapsed.
 */

import { useState } from "react";
import { adapter } from "../data";
import type { BondedPosition, Epoch, PoolStats, TxResult, WalletState } from "../data";
import { T } from "../config/tokens";
import { LIMITS, PROTOCOL } from "../config/constants";
import { presentError } from "../lib/errors";
import { fmtAmount, fmtCountdown, fmtDate, fmtHcow, fmtInt, fmtRatioPct, fmtUsdt, shortHash } from "../lib/format";
import { useAsync } from "../hooks/useAsync";
import { useCountdown } from "../hooks/useCountdown";
import { PendingWithdrawalBanner, ProfitShareWarningBanner } from "../components/Banners";
import { Modal } from "../components/Modal";
import { RevenueLineRow } from "../components/EpochWaterfall";
import { useErrorToast } from "../components/Toast";
import type { PushToast } from "../components/Toast";
import {
  AmountInput,
  Apr,
  AutoGrid,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  KV,
  LoadingBlock,
  Metric,
  MONO,
  SectionLabel,
  Skeleton,
} from "../components/ui";
import type { Route } from "../components/ui";

export interface ProfitShareScreenProps {
  wallet: WalletState;
  walletKey: string;
  canRead: boolean;
  pushToast: PushToast;
  onNavigate: (route: Route) => void;
  onConnect: () => void;
}

type ProfitModal = "bond" | "topup" | "unbond" | "claim" | null;

interface PublicData {
  epoch: Epoch;
  pool: PoolStats;
}

const STATUS_LABEL: Record<BondedPosition["status"], string> = {
  first_time: "Not bonded yet",
  active: "Active",
  cooldown: "Cooldown",
  exhausted: "Exhausted",
};

export function ProfitShareScreen({
  wallet,
  walletKey,
  canRead,
  pushToast,
  onNavigate,
  onConnect,
}: ProfitShareScreenProps) {
  const [modal, setModal] = useState<ProfitModal>(null);
  const [amount, setAmount] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const pub = useAsync<PublicData>(async () => {
    const [epoch, pool] = await Promise.all([adapter.getEpoch(), adapter.getPoolStats()]);
    return { epoch, pool };
  }, []);

  const position = useAsync<BondedPosition>(() => adapter.getBondedPosition(), [walletKey], canRead);

  useErrorToast(pub.error, pushToast);
  useErrorToast(position.error, pushToast);

  const { remainingMs } = useCountdown(pub.data ? pub.data.epoch.endsAt : null);
  const countdown = fmtCountdown(remainingMs);

  const pool = pub.data ? pub.data.pool : null;
  const pos = position.data;

  function closeModal(): void {
    setModal(null);
    setAmount("");
    setAck(false);
  }

  async function submit(fn: () => Promise<TxResult>, title: string, body: string): Promise<void> {
    setBusy(true);
    try {
      const result = await fn();
      pushToast({ tone: "success", title, body, txHash: result.hash, offerTxLink: true });
      closeModal();
      position.reload();
      pub.reload();
    } catch (e) {
      const p = presentError(e);
      pushToast({
        tone: p.tone,
        title: p.title,
        body: p.body,
        txHash: p.txHash,
        offerTxLink: p.offerTxLink,
        offerNetworkSwitch: p.offerNetworkSwitch,
      });
      if (!p.keepModalOpen) closeModal();
    } finally {
      setBusy(false);
    }
  }

  /* ---- amount validation, client side. The adapter has no code for it. ---- */
  const parsed = Number(amount);
  const isDeposit = modal === "bond" || modal === "topup";
  const maxForModal = isDeposit ? wallet.balances.hcow : pos ? pos.bondedAmount : 0;
  const minBond = LIMITS.MIN_BOND_HCOW;
  const amountEmpty = amount.trim() === "";
  const amountInvalid =
    !amountEmpty &&
    (!Number.isFinite(parsed) ||
      parsed <= 0 ||
      parsed > maxForModal ||
      (isDeposit && minBond !== null && parsed < minBond));
  const amountReady = !amountEmpty && !amountInvalid;

  const firstBond = pos ? pos.status === "first_time" || pos.bondedAmount === 0 : true;
  const needsAck = modal === "bond" && firstBond;

  function amountHint(): string {
    if (amountInvalid && parsed > maxForModal) {
      return `That is more than the available ${fmtHcow(maxForModal)}.`;
    }
    if (amountInvalid && isDeposit && minBond !== null && parsed < minBond) {
      return `The minimum is ${fmtHcow(minBond)}.`;
    }
    if (amountInvalid) return "Enter an amount greater than zero.";
    if (isDeposit) {
      return `Deducted by up to ${PROTOCOL.DEDUCTION_CAP_PCT}% per ${PROTOCOL.EPOCH_DAYS}-day epoch, based on ecosystem usage.`;
    }
    return `Requesting starts a ${PROTOCOL.UNBOND_COOLDOWN_DAYS}-day cooldown. You can cancel it at any time before it ends.`;
  }

  return (
    <div style={{ display: "grid", gap: 32 }}>
      <ProfitShareWarningBanner />

      {/* ---------------- header ---------------- */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
          gap: 20,
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ ...MONO, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: T.tSec }}>
            Bonded deposit
          </div>
          <h1 style={{ margin: "10px 0 12px", fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Profit Share
          </h1>
          <p style={{ margin: 0, maxWidth: 560, fontSize: 15, lineHeight: 1.6, color: T.tSec }}>
            Bond HCOW to receive {PROTOCOL.REWARD_CURRENCY} from{" "}
            {PROTOCOL.DISTRIBUTION.PARTICIPANTS_PCT}% of distributable profit, pro-rata to your bonded balance at
            each {PROTOCOL.EPOCH_DAYS}-day snapshot. Distributable profit is what remains of game revenue after
            direct costs and capped operating costs.
          </p>
        </div>

        <Card kicker="Epoch" title={pub.data ? `Epoch #${pub.data.epoch.current}` : "Epoch"} elevated>
          {pub.data ? (
            <>
              <div style={{ ...MONO, fontSize: 28, fontWeight: 500, color: T.tPri }}>{countdown ?? "Settling…"}</div>
              <p style={{ margin: "8px 0 0", fontSize: 12, color: T.tSec }}>
                Snapshot {fmtDate(pub.data.epoch.endsAt)}
              </p>
            </>
          ) : (
            <LoadingBlock label="Loading epoch" rows={2} />
          )}
        </Card>
      </section>

      {/* ---------------- pool overview ---------------- */}
      <section>
        <SectionLabel right={pool ? `Updated ${fmtDate(pool.lastUpdatedAt)}` : "Loading"}>Pool overview</SectionLabel>
        <AutoGrid min={230}>
          <Metric
            label="Total bonded"
            value={pool ? fmtAmount(pool.totalBondedHcow, 0) : <Skeleton width={120} height={24} />}
            unit="HCOW"
            hint={pool ? `${fmtInt(pool.participants)} participants` : undefined}
          />
          <Metric
            label="Gross received · 30d"
            value={pool ? fmtAmount(pool.grossReceivedUsdt30d) : <Skeleton width={120} height={24} />}
            unit={pool ? PROTOCOL.REWARD_CURRENCY : undefined}
            hint="Receipt basis. Store payouts land one to two months late."
          />
          <Metric
            label="Paid to participants · 30d"
            value={pool ? fmtAmount(pool.distributedToParticipantsUsdt30d) : <Skeleton width={120} height={24} />}
            unit={pool ? PROTOCOL.REWARD_CURRENCY : undefined}
            tone="ok"
          />
          <Metric label="Estimated APR" value={pool ? <Apr pct={pool.estimatedAprPct} /> : <Skeleton width={90} height={24} />} />
        </AutoGrid>

        <div style={{ marginTop: 16 }}>
          <Card
            kicker="Where the money came from · last 30 days"
            title={pool ? `${fmtRatioPct(pool.chainVerifiableRatio30d, 1)} chain verifiable` : "Revenue by origin"}
          >
            {pool ? (
              pool.revenue30dByOrigin.length === 0 ? (
                <EmptyState title="No revenue recorded" body="No money has been received into the vault in the last 30 days." />
              ) : (
                <div>
                  {pool.revenue30dByOrigin.map((line) => (
                    <RevenueLineRow key={`${line.origin}-${line.cls}`} line={line} />
                  ))}
                  <p style={{ margin: "14px 0 0", fontSize: 12, color: T.tSec, lineHeight: 1.6 }}>
                    Lines marked attested were received off chain. They are backed by a published payout statement
                    and the on-chain deposit that carried the money in, which is weaker evidence than a chain
                    settlement.
                  </p>
                </div>
              )
            ) : (
              <LoadingBlock label="Loading revenue by origin" rows={4} />
            )}
          </Card>
        </div>
      </section>

      {/* ---------------- your position ---------------- */}
      <section>
        <SectionLabel right={wallet.address ? shortHash(wallet.address, 6, 4) : "Not connected"}>
          Your position
        </SectionLabel>

        {!wallet.connected ? (
          <EmptyState
            title="Connect a wallet to bond"
            body="Pool data above is public. Connect a wallet to bond HCOW, claim your share and manage withdrawals."
            action={
              <Button variant="primary" onClick={onConnect}>
                Connect wallet
              </Button>
            }
          />
        ) : !canRead ? (
          <EmptyState
            title="Wrong network"
            body={`Your bonded position lives on ${PROTOCOL.CHAIN_NAME}. Switch networks in your wallet to load it.`}
            tone="warn"
          />
        ) : position.loading || !pos ? (
          <LoadingBlock label="Loading your bonded position" rows={5} />
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {pos.pendingUnbondAmount !== null && pos.pendingUnbondReadyAt !== null ? (
              <PendingWithdrawalBanner
                lane="profit_share"
                amount={pos.pendingUnbondAmount}
                readyAt={pos.pendingUnbondReadyAt}
                busy={busy}
                onCancel={() =>
                  void submit(
                    () => adapter.cancelUnbond(),
                    "Unbond request cancelled",
                    "The amount returned to your bonded balance.",
                  )
                }
                onWithdraw={() =>
                  void submit(
                    () => adapter.withdrawUnbonded(),
                    "Withdrawal complete",
                    "The unbonded HCOW is back in your wallet.",
                  )
                }
              />
            ) : null}

            <AutoGrid min={320}>
              <Card
                kicker="Bonded deposit"
                title="Your bonded balance"
                right={<Badge tone={pos.status === "active" ? "ok" : pos.status === "cooldown" ? "info" : "muted"}>{STATUS_LABEL[pos.status]}</Badge>}
              >
                <KV label="Bonded" value={fmtHcow(pos.bondedAmount)} emphasis />
                <KV label="Share of pool" value={fmtRatioPct(pos.shareOfPool)} sub="At the last snapshot." />
                <KV
                  label="Forecast for this epoch"
                  value={fmtUsdt(pos.estimatedEpochUsdt)}
                  sub="Forecast for the in-flight epoch. Not a promise."
                />
                <KV label="Deducted to date" value={fmtHcow(pos.lifetimeDeductedHcow)} tone="warn" />
                <KV label="Received to date" value={fmtUsdt(pos.lifetimeClaimedUsdt)} />

                <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      setModal(pos.bondedAmount > 0 ? "topup" : "bond");
                      setAmount("");
                      setAck(false);
                    }}
                  >
                    {pos.bondedAmount > 0 ? "Top up" : "Bond HCOW"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || pos.bondedAmount <= 0 || pos.pendingUnbondAmount !== null}
                    title={pos.pendingUnbondAmount !== null ? "An unbond request is already running." : undefined}
                    onClick={() => {
                      setModal("unbond");
                      setAmount("");
                    }}
                  >
                    Request unbond
                  </Button>
                  <Button variant="ghost" onClick={() => onNavigate("portfolio")}>
                    View history
                  </Button>
                </div>
              </Card>

              <Card kicker={`Claimable ${PROTOCOL.REWARD_CURRENCY}`} title="Your share of the last settlement">
                <div style={{ ...MONO, fontSize: 32, fontWeight: 500, color: pos.pendingClaimUsdt > 0 ? T.okFg : T.tSec }}>
                  {fmtAmount(pos.pendingClaimUsdt)}
                  <span style={{ fontSize: 14, color: T.tSec, marginLeft: 6 }}>{PROTOCOL.REWARD_CURRENCY}</span>
                </div>
                <p style={{ margin: "10px 0 18px", fontSize: 13, color: T.tSec, lineHeight: 1.6 }}>
                  {pos.pendingClaimUsdt > 0
                    ? "Claim moves it to your wallet as a BEP-20 transfer. It stays claimable until you do."
                    : "Nothing to claim right now. Your share appears here after the next epoch settles."}
                </p>
                <Button
                  variant="primary"
                  block
                  disabled={busy || pos.pendingClaimUsdt <= 0}
                  onClick={() => setModal("claim")}
                >
                  Claim {fmtUsdt(pos.pendingClaimUsdt)}
                </Button>
              </Card>
            </AutoGrid>
          </div>
        )}
      </section>

      {/* ---------------- modals ---------------- */}
      <Modal
        open={modal === "bond" || modal === "topup"}
        title={modal === "topup" ? "Top up your bond" : "Bond HCOW"}
        description="Bonded HCOW takes effect from the next epoch snapshot."
        onClose={closeModal}
        busy={busy}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !amountReady || (needsAck && !ack)}
              onClick={() =>
                void submit(
                  () => (modal === "topup" ? adapter.topUpBond(parsed) : adapter.bond(parsed)),
                  modal === "topup" ? "Top-up confirmed" : "Bond confirmed",
                  `${fmtHcow(parsed)} is bonded from the next epoch.`,
                )
              }
            >
              {busy ? "Confirming…" : `${modal === "topup" ? "Top up" : "Bond"} ${amountReady ? fmtHcow(parsed) : "HCOW"}`}
            </Button>
          </>
        }
      >
        <AmountInput
          id="bond-amount"
          label={modal === "topup" ? "Amount to add" : "Amount to bond"}
          value={amount}
          onChange={setAmount}
          hint={amountHint()}
          invalid={amountInvalid}
          maxValue={wallet.balances.hcow}
          balanceLabel={`Wallet · ${fmtHcow(wallet.balances.hcow)}`}
          disabled={busy}
        />

        <div>
          <KV label="Currently bonded" value={pos ? fmtHcow(pos.bondedAmount) : "—"} />
          <KV
            label="After this transaction"
            value={pos && amountReady ? fmtHcow(pos.bondedAmount + parsed) : "—"}
          />
          <KV label="Takes effect" value="Next epoch snapshot" />
          <KV label="Cooldown to exit" value={`${PROTOCOL.UNBOND_COOLDOWN_DAYS} days`} />
        </div>

        <div
          style={{
            padding: "12px 14px",
            borderRadius: T.rMd,
            background: T.warnBg,
            border: `1px solid ${T.warnBd}`,
            fontSize: 13,
            color: T.tPri,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: T.warnFg }}>This is not a deposit product.</strong> Bonded HCOW can be deducted
          by up to {PROTOCOL.DEDUCTION_CAP_PCT}% per {PROTOCOL.EPOCH_DAYS}-day epoch based on ecosystem usage, and
          deductions are permanent. In an epoch with no distributable profit, no deduction runs.
        </div>

        {needsAck ? (
          <Checkbox
            id="bond-ack"
            checked={ack}
            onChange={setAck}
            disabled={busy}
            label={`I understand that my bonded balance can be reduced by up to ${PROTOCOL.DEDUCTION_CAP_PCT}% per epoch and that deductions are permanent.`}
          />
        ) : null}
      </Modal>

      <Modal
        open={modal === "unbond"}
        title="Request unbond"
        description={`A ${PROTOCOL.UNBOND_COOLDOWN_DAYS}-day cooldown starts immediately. Withdrawal is a second, manual step.`}
        onClose={closeModal}
        busy={busy}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !amountReady}
              onClick={() =>
                void submit(
                  () => adapter.requestUnbond(parsed),
                  "Unbond requested",
                  `${fmtHcow(parsed)} enters the ${PROTOCOL.UNBOND_COOLDOWN_DAYS}-day cooldown.`,
                )
              }
            >
              {busy ? "Confirming…" : `Request unbond${amountReady ? ` ${fmtHcow(parsed)}` : ""}`}
            </Button>
          </>
        }
      >
        <AmountInput
          id="unbond-amount"
          label="Amount to unbond"
          value={amount}
          onChange={setAmount}
          hint={amountHint()}
          invalid={amountInvalid}
          maxValue={pos ? pos.bondedAmount : null}
          balanceLabel={pos ? `Bonded · ${fmtHcow(pos.bondedAmount)}` : undefined}
          disabled={busy}
        />
        <div>
          <KV label="Cooldown" value={`${PROTOCOL.UNBOND_COOLDOWN_DAYS} days`} />
          <KV label="Bonded after request" value={pos && amountReady ? fmtHcow(pos.bondedAmount - parsed) : "—"} />
          <KV label="Ready to withdraw" value="Set on chain when the request confirms" />
        </div>
        <p style={{ margin: 0, fontSize: 13, color: T.tSec, lineHeight: 1.6 }}>
          The requested amount leaves the bonded pool, so it stops earning a share and stops being deductible. You
          can cancel the request at any time before the cooldown ends, which returns it to your bonded balance.
        </p>
      </Modal>

      <Modal
        open={modal === "claim"}
        title={`Claim ${PROTOCOL.REWARD_CURRENCY}`}
        onClose={closeModal}
        busy={busy}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !pos || pos.pendingClaimUsdt <= 0}
              onClick={() =>
                void submit(
                  () => adapter.claimUsdt(),
                  "Claim confirmed",
                  `${pos ? fmtUsdt(pos.pendingClaimUsdt) : PROTOCOL.REWARD_CURRENCY} is on the way to your wallet.`,
                )
              }
            >
              {busy ? "Confirming…" : `Claim ${pos ? fmtUsdt(pos.pendingClaimUsdt) : ""}`}
            </Button>
          </>
        }
      >
        <div style={{ padding: 18, borderRadius: T.rMd, background: T.inset, border: `1px solid ${T.bDefault}` }}>
          <div style={{ ...MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.tSec }}>
            Available to claim
          </div>
          <div style={{ ...MONO, fontSize: 30, fontWeight: 500, color: T.okFg, marginTop: 8 }}>
            {pos ? fmtUsdt(pos.pendingClaimUsdt) : "—"}
          </div>
        </div>
        <div>
          <KV label="Destination" value={wallet.address ? shortHash(wallet.address, 8, 6) : "—"} />
          <KV label="You receive" value={`${PROTOCOL.REWARD_CURRENCY} (BEP-20)`} />
          <KV label="Gas token" value={PROTOCOL.GAS_TOKEN} />
        </div>
      </Modal>
    </div>
  );
}
