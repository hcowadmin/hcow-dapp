/**
 * HCOW dApp — Network Staking lane.
 *
 * Staked HCOW is locked, and is not subject to deduction. That is a statement
 * about mechanics, not a promise about outcomes, so nothing on this screen
 * describes staking as risk free.
 *
 * The lane is fully round-trippable: stake, redelegate, request unstake,
 * cancel a request, and withdraw once the cooldown has elapsed.
 */

import { useState } from "react";
import { adapter } from "../data";
import type { NetworkStats, Representative, StakedPosition, TxResult, WalletState } from "../data";
import { T } from "../config/tokens";
import { LIMITS, PROTOCOL } from "../config/constants";
import { presentError } from "../lib/errors";
import { fmtAmount, fmtDate, fmtHcow, fmtInt, fmtPct, shortHash } from "../lib/format";
import { useAsync } from "../hooks/useAsync";
import { PendingWithdrawalBanner } from "../components/Banners";
import { Modal } from "../components/Modal";
import { useErrorToast } from "../components/Toast";
import type { PushToast } from "../components/Toast";
import {
  AddressChip,
  AmountInput,
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
  SectionLabel,
  Skeleton,
} from "../components/ui";
import type { Route, Tone } from "../components/ui";

export interface NetworkStakingScreenProps {
  wallet: WalletState;
  walletKey: string;
  canRead: boolean;
  pushToast: PushToast;
  onNavigate: (route: Route) => void;
  onConnect: () => void;
}

type StakingModal = "stake" | "redelegate" | "unstake" | "claim" | null;

interface PublicData {
  network: NetworkStats;
  reps: Representative[];
}

const REP_TONE: Record<Representative["status"], Tone> = {
  active: "ok",
  warning: "warn",
  inactive: "danger",
};

const REP_LABEL: Record<Representative["status"], string> = {
  active: "Active",
  warning: "Degraded",
  inactive: "Inactive",
};

export function NetworkStakingScreen({
  wallet,
  walletKey,
  canRead,
  pushToast,
  onNavigate,
  onConnect,
}: NetworkStakingScreenProps) {
  const [modal, setModal] = useState<StakingModal>(null);
  const [amount, setAmount] = useState("");
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pub = useAsync<PublicData>(async () => {
    const [network, reps] = await Promise.all([adapter.getNetworkStats(), adapter.getRepresentatives()]);
    return { network, reps };
  }, []);

  const position = useAsync<StakedPosition>(() => adapter.getStakedPosition(), [walletKey], canRead);

  useErrorToast(pub.error, pushToast);
  useErrorToast(position.error, pushToast);

  const reps = pub.data ? pub.data.reps : [];
  const network = pub.data ? pub.data.network : null;
  const pos = position.data;
  const totalDelegated = reps.reduce((sum, r) => sum + r.totalDelegatedHcow, 0);
  const currentRep = pos && pos.delegatedTo ? reps.find((r) => r.id === pos.delegatedTo) ?? null : null;

  function closeModal(): void {
    setModal(null);
    setAmount("");
    setSelectedRep(null);
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

  function openStake(repId: string | null): void {
    setModal("stake");
    setAmount("");
    setSelectedRep(repId ?? (pos ? pos.delegatedTo : null));
  }

  /* ---- client-side amount validation ---- */
  const parsed = Number(amount);
  const isStake = modal === "stake";
  const maxForModal = isStake ? wallet.balances.hcow : pos ? pos.stakedAmount : 0;
  const minStake = LIMITS.MIN_STAKE_HCOW;
  const amountEmpty = amount.trim() === "";
  const amountInvalid =
    !amountEmpty &&
    (!Number.isFinite(parsed) ||
      parsed <= 0 ||
      parsed > maxForModal ||
      (isStake && minStake !== null && parsed < minStake));
  const amountReady = !amountEmpty && !amountInvalid;

  function amountHint(): string {
    if (amountInvalid && parsed > maxForModal) return `That is more than the available ${fmtHcow(maxForModal)}.`;
    if (amountInvalid && isStake && minStake !== null && parsed < minStake) {
      return `The minimum is ${fmtHcow(minStake)}.`;
    }
    if (amountInvalid) return "Enter an amount greater than zero.";
    if (isStake) return "Staked HCOW is locked, and is not subject to deduction. Rewards are paid in HCOW.";
    return `Requesting starts a ${PROTOCOL.UNSTAKE_COOLDOWN_DAYS}-day cooldown. You can cancel it at any time before it ends.`;
  }

  return (
    <div style={{ display: "grid", gap: 32 }}>
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
            Delegation and commission
          </div>
          <h1 style={{ margin: "10px 0 12px", fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Network Staking
          </h1>
          <p style={{ margin: 0, maxWidth: 560, fontSize: 15, lineHeight: 1.6, color: T.tSec }}>
            Delegate HCOW to a representative and receive HCOW rewards. HCOW is a BEP-20 token on BNB Chain, so
            nothing here secures a network and representatives do not run infrastructure: this contract distributes
            rewards and pays representative commission. Staked HCOW is locked, is not subject to deduction, and is
            released to your wallet after a {PROTOCOL.UNSTAKE_COOLDOWN_DAYS}-day cooldown and a manual withdrawal.
          </p>
          <div style={{ marginTop: 20 }}>
            <Button variant="ghost" onClick={() => onNavigate("profit")}>
              Looking for the bonded deposit lane? Open Profit Share
            </Button>
          </div>
        </div>

        <Card kicker="Representative registry" title="Status" elevated>
          {network ? (
            <div style={{ display: "grid", gap: 10 }}>
              <Badge tone={network.networkStatus === "healthy" ? "ok" : network.networkStatus === "degraded" ? "warn" : "danger"}>
                {network.networkStatus}
              </Badge>
              <KV
                label="Representatives active"
                value={`${network.activeRepresentatives} / ${network.totalRepresentatives}`}
              />
              <KV label="BNB Chain head" value={fmtDate(network.lastBlockAt)} />
            </div>
          ) : (
            <LoadingBlock label="Loading registry status" rows={3} />
          )}
        </Card>
      </section>

      {/* ---------------- network overview ---------------- */}
      <section>
        <SectionLabel right={`Commission capped at ${PROTOCOL.COMMISSION_CAP_PCT}%`}>Delegation overview</SectionLabel>
        <AutoGrid min={230}>
          <Metric
            label="Total delegated"
            value={pub.data ? fmtAmount(totalDelegated, 0) : <Skeleton width={120} height={24} />}
            unit="HCOW"
            hint="Across every representative."
          />
          <Metric
            label="Representatives"
            value={network ? `${network.activeRepresentatives} / ${network.totalRepresentatives}` : <Skeleton width={70} height={24} />}
            hint="Foundation nodes at launch."
          />
          <Metric
            label="Cooldown"
            value={`${PROTOCOL.UNSTAKE_COOLDOWN_DAYS}`}
            unit="days"
            hint="Then a manual withdrawal moves HCOW back to your wallet."
          />
          <Metric
            label="Your estimated APR"
            value={
              position.loading ? (
                <Skeleton width={90} height={24} />
              ) : pos ? (
                <Apr pct={pos.estimatedAprPct} />
              ) : (
                "—"
              )
            }
            hint={!wallet.connected ? "Connect a wallet to see your position." : undefined}
          />
        </AutoGrid>
      </section>

      {/* ---------------- your position ---------------- */}
      <section>
        <SectionLabel right={wallet.address ? shortHash(wallet.address, 6, 4) : "Not connected"}>
          Your staking
        </SectionLabel>

        {!wallet.connected ? (
          <EmptyState
            title="Connect a wallet to delegate"
            body="Representatives and network data are public. Connect a wallet to delegate HCOW, claim rewards and manage withdrawals."
            action={
              <Button variant="primary" onClick={onConnect}>
                Connect wallet
              </Button>
            }
          />
        ) : !canRead ? (
          <EmptyState
            title="Wrong network"
            body={`Your staking position lives on ${PROTOCOL.CHAIN_NAME}. Switch networks in your wallet to load it.`}
            tone="warn"
          />
        ) : position.loading || !pos ? (
          <LoadingBlock label="Loading your staking position" rows={5} />
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {pos.pendingUnstakeAmount !== null && pos.pendingUnstakeReadyAt !== null ? (
              <PendingWithdrawalBanner
                lane="network_staking"
                amount={pos.pendingUnstakeAmount}
                readyAt={pos.pendingUnstakeReadyAt}
                busy={busy}
                onCancel={() =>
                  void submit(
                    () => adapter.cancelUnstake(),
                    "Unstake request cancelled",
                    "The amount returned to your delegation.",
                  )
                }
                onWithdraw={() =>
                  void submit(
                    () => adapter.withdrawUnstaked(),
                    "Withdrawal complete",
                    "The unstaked HCOW is back in your wallet.",
                  )
                }
              />
            ) : null}

            {pos.stakedAmount <= 0 && pos.pendingUnstakeAmount === null ? (
              <EmptyState
                title="Nothing staked yet"
                body="Pick a representative below and delegate HCOW. Staked HCOW is locked, and is not subject to deduction; it is released after the cooldown and a manual withdrawal."
                action={
                  <Button variant="primary" onClick={() => openStake(null)}>
                    Start staking
                  </Button>
                }
              />
            ) : (
              <AutoGrid min={320}>
                <Card
                  kicker="Delegation"
                  title="Your staked balance"
                  right={<Badge tone={pos.status === "active" ? "ok" : "info"}>{pos.status === "cooldown" ? "Cooldown" : pos.status === "active" ? "Active" : "Not staked"}</Badge>}
                >
                  <KV label="Staked" value={fmtHcow(pos.stakedAmount)} emphasis />
                  <KV
                    label="Delegated to"
                    value={currentRep ? currentRep.name : pos.delegatedTo ?? "Not delegated"}
                    sub={currentRep ? `${fmtPct(currentRep.commissionPct, 1)} commission` : undefined}
                  />
                  <KV label="Estimated APR" value={<Apr pct={pos.estimatedAprPct} size="sm" />} />
                  <KV label="Earned to date" value={fmtHcow(pos.lifetimeRewardHcow)} />

                  <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
                    <Button variant="primary" disabled={busy} onClick={() => openStake(pos.delegatedTo)}>
                      Stake more
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy || pos.delegatedTo === null}
                      onClick={() => {
                        setModal("redelegate");
                        setSelectedRep(null);
                      }}
                    >
                      Redelegate
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy || pos.stakedAmount <= 0 || pos.pendingUnstakeAmount !== null}
                      title={pos.pendingUnstakeAmount !== null ? "An unstake request is already running." : undefined}
                      onClick={() => {
                        setModal("unstake");
                        setAmount("");
                      }}
                    >
                      Request unstake
                    </Button>
                    <Button variant="ghost" onClick={() => onNavigate("portfolio")}>
                      View activity
                    </Button>
                  </div>
                </Card>

                <Card kicker="Claimable HCOW" title="Rewards from your representative">
                  <div style={{ ...MONO, fontSize: 32, fontWeight: 500, color: pos.pendingRewardHcow > 0 ? T.okFg : T.tSec }}>
                    {fmtAmount(pos.pendingRewardHcow)}
                    <span style={{ fontSize: 14, color: T.tSec, marginLeft: 6 }}>HCOW</span>
                  </div>
                  <p style={{ margin: "10px 0 18px", fontSize: 13, color: T.tSec, lineHeight: 1.6 }}>
                    {pos.pendingRewardHcow > 0
                      ? "Claiming moves the rewards to your wallet. They do not compound automatically."
                      : "No rewards accrued yet. They appear here as your representative produces blocks."}
                  </p>
                  <Button variant="primary" block disabled={busy || pos.pendingRewardHcow <= 0} onClick={() => setModal("claim")}>
                    Claim {fmtHcow(pos.pendingRewardHcow)}
                  </Button>
                </Card>
              </AutoGrid>
            )}
          </div>
        )}
      </section>

      {/* ---------------- representatives ---------------- */}
      <section>
        <SectionLabel right={`${reps.length} representatives`}>Representatives</SectionLabel>
        {pub.loading ? (
          <LoadingBlock label="Loading representatives" rows={5} />
        ) : reps.length === 0 ? (
          <EmptyState title="No representatives listed" body="The registry returned no representatives. Delegation is unavailable until at least one is active." />
        ) : (
          <AutoGrid min={300}>
            {reps.map((r) => {
              const isCurrent = pos !== null && pos.delegatedTo === r.id;
              return (
                <Card key={r.id} tone={isCurrent ? "ok" : undefined}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: T.tPri }}>{r.name}</div>
                      <div style={{ marginTop: 6 }}>
                        <AddressChip address={r.address} label={r.name} />
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                      <Badge tone={REP_TONE[r.status]}>{REP_LABEL[r.status]}</Badge>
                      {r.isFoundation ? <Badge tone="muted">Foundation</Badge> : null}
                      {isCurrent ? <Badge tone="info">Your delegate</Badge> : null}
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <KV label="Total delegated" value={fmtHcow(r.totalDelegatedHcow, 0)} />
                    <KV label="Delegators" value={fmtInt(r.delegatorCount)} />
                    <KV
                      label="Commission"
                      value={fmtPct(r.commissionPct, 1)}
                      sub={`Contract cap ${PROTOCOL.COMMISSION_CAP_PCT}%`}
                    />
                    <KV label="Estimated APR" value={<Apr pct={r.estimatedAprPct} size="sm" />} />
                  </div>

                  <div style={{ marginTop: 16 }}>
                    {isCurrent ? (
                      <Button variant="secondary" block disabled>
                        Currently delegated
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        block
                        disabled={busy || r.status === "inactive" || !wallet.connected}
                        title={!wallet.connected ? "Connect a wallet to delegate." : undefined}
                        onClick={() => {
                          if (pos && pos.stakedAmount > 0 && pos.delegatedTo !== null) {
                            setModal("redelegate");
                            setSelectedRep(r.id);
                          } else {
                            openStake(r.id);
                          }
                        }}
                      >
                        {pos && pos.stakedAmount > 0 && pos.delegatedTo !== null ? "Redelegate here" : "Delegate"}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </AutoGrid>
        )}
      </section>

      {/* ---------------- modals ---------------- */}
      <Modal
        open={modal === "stake"}
        title="Delegate HCOW"
        description="Choose a representative and an amount. You can redelegate later without a new cooldown."
        onClose={closeModal}
        busy={busy}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !amountReady || selectedRep === null}
              onClick={() => {
                const rep = selectedRep;
                if (rep === null) return;
                void submit(
                  () => adapter.stake(parsed, rep),
                  "Delegation confirmed",
                  `${fmtHcow(parsed)} is now staked.`,
                );
              }}
            >
              {busy ? "Confirming…" : `Delegate ${amountReady ? fmtHcow(parsed) : "HCOW"}`}
            </Button>
          </>
        }
      >
        <AmountInput
          id="stake-amount"
          label="Amount to stake"
          value={amount}
          onChange={setAmount}
          hint={amountHint()}
          invalid={amountInvalid}
          maxValue={wallet.balances.hcow}
          balanceLabel={`Wallet · ${fmtHcow(wallet.balances.hcow)}`}
          disabled={busy}
        />
        <RepPicker
          name="stake-rep"
          legend="Representative"
          reps={reps}
          selected={selectedRep}
          onSelect={setSelectedRep}
          disabled={busy}
        />
        <div>
          <KV label="Cooldown to exit" value={`${PROTOCOL.UNSTAKE_COOLDOWN_DAYS} days`} />
          <KV label="Rewards paid in" value="HCOW" />
          <KV label="Deduction" value="Staked HCOW is not subject to deduction" />
        </div>
      </Modal>

      <Modal
        open={modal === "redelegate"}
        title="Redelegate"
        description="Moves your whole staked balance to another representative. No new cooldown."
        onClose={closeModal}
        busy={busy}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || selectedRep === null || (pos !== null && selectedRep === pos.delegatedTo)}
              onClick={() => {
                const rep = selectedRep;
                if (rep === null) return;
                void submit(() => adapter.redelegate(rep), "Redelegation confirmed", "Your stake moved to the new representative.");
              }}
            >
              {busy ? "Confirming…" : "Redelegate"}
            </Button>
          </>
        }
      >
        <div>
          <KV label="Currently delegated to" value={currentRep ? currentRep.name : pos?.delegatedTo ?? "—"} />
          <KV label="Amount moving" value={pos ? fmtHcow(pos.stakedAmount) : "—"} />
        </div>
        <RepPicker
          name="redelegate-rep"
          legend="New representative"
          reps={reps}
          selected={selectedRep}
          onSelect={setSelectedRep}
          disabled={busy}
          excludeId={pos ? pos.delegatedTo : null}
        />
        <p style={{ margin: 0, fontSize: 13, color: T.tSec, lineHeight: 1.6 }}>
          Redelegation does not start a cooldown and does not unlock any HCOW. Confirm the pending-reward policy
          with your representative before moving a large balance.
        </p>
      </Modal>

      <Modal
        open={modal === "unstake"}
        title="Request unstake"
        description={`A ${PROTOCOL.UNSTAKE_COOLDOWN_DAYS}-day cooldown starts immediately. Withdrawal is a second, manual step.`}
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
                  () => adapter.requestUnstake(parsed),
                  "Unstake requested",
                  `${fmtHcow(parsed)} enters the ${PROTOCOL.UNSTAKE_COOLDOWN_DAYS}-day cooldown.`,
                )
              }
            >
              {busy ? "Confirming…" : `Request unstake${amountReady ? ` ${fmtHcow(parsed)}` : ""}`}
            </Button>
          </>
        }
      >
        <AmountInput
          id="unstake-amount"
          label="Amount to unstake"
          value={amount}
          onChange={setAmount}
          hint={amountHint()}
          invalid={amountInvalid}
          maxValue={pos ? pos.stakedAmount : null}
          balanceLabel={pos ? `Staked · ${fmtHcow(pos.stakedAmount)}` : undefined}
          disabled={busy}
        />
        <div>
          <KV label="Cooldown" value={`${PROTOCOL.UNSTAKE_COOLDOWN_DAYS} days`} />
          <KV label="Staked after request" value={pos && amountReady ? fmtHcow(pos.stakedAmount - parsed) : "—"} />
          <KV label="Ready to withdraw" value="Set on chain when the request confirms" />
        </div>
        <p style={{ margin: 0, fontSize: 13, color: T.tSec, lineHeight: 1.6 }}>
          You can cancel the request at any time before the cooldown ends, which returns the amount to your
          delegation. After the cooldown you must withdraw manually.
        </p>
      </Modal>

      <Modal
        open={modal === "claim"}
        title="Claim staking rewards"
        onClose={closeModal}
        busy={busy}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !pos || pos.pendingRewardHcow <= 0}
              onClick={() =>
                void submit(
                  () => adapter.claimHcow(),
                  "Claim confirmed",
                  `${pos ? fmtHcow(pos.pendingRewardHcow) : "HCOW"} is on the way to your wallet.`,
                )
              }
            >
              {busy ? "Confirming…" : `Claim ${pos ? fmtHcow(pos.pendingRewardHcow) : ""}`}
            </Button>
          </>
        }
      >
        <div style={{ padding: 18, borderRadius: T.rMd, background: T.inset, border: `1px solid ${T.bDefault}` }}>
          <div style={{ ...MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.tSec }}>
            Available to claim
          </div>
          <div style={{ ...MONO, fontSize: 30, fontWeight: 500, color: T.okFg, marginTop: 8 }}>
            {pos ? fmtHcow(pos.pendingRewardHcow) : "—"}
          </div>
        </div>
        <div>
          <KV label="Destination" value={wallet.address ? shortHash(wallet.address, 8, 6) : "—"} />
          <KV label="You receive" value="HCOW (BEP-20)" />
          <KV label="Gas token" value={PROTOCOL.GAS_TOKEN} />
        </div>
      </Modal>
    </div>
  );
}

/* ============================================================
   REPRESENTATIVE PICKER
   ============================================================ */

interface RepPickerProps {
  name: string;
  legend: string;
  reps: Representative[];
  selected: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  excludeId?: string | null;
}

function RepPicker({ name, legend, reps, selected, onSelect, disabled = false, excludeId = null }: RepPickerProps) {
  const options = reps.filter((r) => r.id !== excludeId);
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend style={{ ...MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.tSec, padding: 0, marginBottom: 8 }}>
        {legend}
      </legend>
      {options.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: T.tSec }}>No other representative is available right now.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {options.map((r) => {
            const id = `${name}-${r.id}`;
            const unavailable = r.status === "inactive";
            return (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: T.rMd,
                  background: T.inset,
                  border: `1px solid ${selected === r.id ? T.okBd : T.bDefault}`,
                  opacity: unavailable ? 0.5 : 1,
                }}
              >
                <input
                  id={id}
                  type="radio"
                  name={name}
                  value={r.id}
                  checked={selected === r.id}
                  disabled={disabled || unavailable}
                  onChange={() => onSelect(r.id)}
                  aria-describedby={`${id}-meta`}
                  style={{ width: 16, height: 16, accentColor: T.mint }}
                />
                <label htmlFor={id} style={{ flex: 1, minWidth: 0, fontSize: 14, color: T.tPri, cursor: "pointer" }}>
                  {r.name}
                  <span id={`${id}-meta`} style={{ display: "block", fontSize: 11, color: T.tSec, marginTop: 2 }}>
                    {fmtPct(r.commissionPct, 1)} commission · {fmtHcow(r.totalDelegatedHcow, 0)} delegated ·{" "}
                    {REP_LABEL[r.status]}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
