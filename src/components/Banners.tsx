/**
 * HCOW dApp — persistent banners.
 *
 * The Profit Share warning is deliberately NOT dismissible: the deduction risk
 * is the single most important fact about that lane.
 */

import type { ReactNode } from "react";
import { T } from "../config/tokens";
import { DEDUCTION_PER_SETTLEMENT_PCT, EXTERNAL_LINKS, PROTOCOL } from "../config/constants";
import { DEPLOYMENT } from "../config/deployment";
import { fmtCountdown, fmtDate, fmtHcow, fmtUsdt } from "../lib/format";
import { useCountdown } from "../hooks/useCountdown";
import { Badge, Button, ExtLink, MONO, toneColors } from "./ui";
import type { Tone } from "./ui";

interface ShellProps {
  tone: Tone;
  icon: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  role?: "status" | "alert";
}

function BannerShell({ tone, icon, title, children, actions, role = "status" }: ShellProps) {
  const c = toneColors(tone);
  return (
    <div
      role={role}
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "14px 16px",
        borderRadius: T.rMd,
        border: `1px solid ${c.bd}`,
        background: c.bg,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 20,
          height: 20,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: c.fg,
          color: T.tInv,
          ...MONO,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: "block", fontSize: 13, fontWeight: 600, color: c.fg, marginBottom: 2 }}>
          {title}
        </strong>
        <div style={{ fontSize: 13, color: T.tPri, lineHeight: 1.55 }}>{children}</div>
      </div>
      {actions ? <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>{actions}</div> : null}
    </div>
  );
}

/* ============================================================
   TESTNET STRIP
   ============================================================ */

/**
 * Sits above the header, full width, on every screen, and is not dismissible.
 *
 * The reason it is here and not inside the page is screenshots. Someone will
 * crop the Portfolio panel showing a nine figure HCOW balance and post it, and
 * without a strip pinned to the very top of the viewport that image reads as a
 * real holding. A caveat that only appears on the dashboard protects nobody.
 */
export function TestnetStrip() {
  if (!DEPLOYMENT.isTestDeployment) return null;
  return (
    <div
      role="status"
      style={{
        background: T.warnBg,
        borderBottom: `1px solid ${T.warnBd}`,
        color: T.warnFg,
        fontSize: 12,
        lineHeight: 1.5,
        padding: "8px 24px",
        textAlign: "center",
        ...MONO,
      }}
    >
      TESTNET · {DEPLOYMENT.chainName} · every token and amount shown here is a
      test value with no monetary worth
    </div>
  );
}

/* ============================================================
   TEST FAUCET
   ============================================================ */

interface FaucetBannerProps {
  /** What a claim pays right now, per token. 0 for a side the faucet cannot pay. */
  hcowNow: number;
  usdtNow: number;
  readyAt: number | null;
  /** The shared per-window limit. At 0 both sides read 0 although the faucet still holds tokens. */
  windowClaimsLeft: number;
  windowResetsAt: number | null;
  busy: boolean;
  onClaim: () => void;
}

export function FaucetBanner({
  hcowNow,
  usdtNow,
  readyAt,
  windowClaimsLeft,
  windowResetsAt,
  busy,
  onClaim,
}: FaucetBannerProps) {
  // Empty only when a claim would pay nothing at all. The two tokens are paid
  // independently, and the button used to be disabled on claimsLeft, which
  // counts full allowances and reads 0 while one side can still pay.
  const empty = hcowNow <= 0 && usdtNow <= 0;
  const waiting = readyAt !== null;
  const windowFull = windowClaimsLeft === 0;

  return (
    <BannerShell
      tone="info"
      icon="+"
      title="Test tokens"
      actions={
        <Button onClick={onClaim} disabled={busy || empty || waiting}>
          {busy ? "Claiming..." : "Get test tokens"}
        </Button>
      }
    >
      {waiting ? (
        <>
          Already claimed. Next claim after{" "}
          <span style={MONO}>{fmtDate(readyAt as number)}</span>.
        </>
      ) : empty && windowFull ? (
        <>
          {/* The shared limit, not an empty faucet. Nothing is claimed about
              the faucet's balance here (re-review R5). */}
          Today&apos;s claims for everyone are used up
          {windowResetsAt !== null ? (
            <>
              . Claims reopen after <span style={MONO}>{fmtDate(windowResetsAt)}</span>
            </>
          ) : null}
          .
        </>
      ) : empty ? (
        <>The faucet is out of test tokens. Ask the team to refill it.</>
      ) : (
        <>
          {/* fmtHcow already ends in "HCOW" ("10,000.00 HCOW HCOW", audit 6, L-2). */}
          A claim now gives{" "}
          {hcowNow > 0 && usdtNow > 0 ? (
            <>
              <span style={MONO}>{fmtHcow(hcowNow)}</span> and <span style={MONO}>{fmtUsdt(usdtNow)}</span>
            </>
          ) : hcowNow > 0 ? (
            <>
              <span style={MONO}>{fmtHcow(hcowNow)}</span> only. The faucet has no test USDT left
            </>
          ) : (
            <>
              <span style={MONO}>{fmtUsdt(usdtNow)}</span> only. The faucet has no test HCOW left
            </>
          )}
          . One claim per address per day. These are test tokens and cannot be sold or transferred for value.
        </>
      )}
    </BannerShell>
  );
}

/* ============================================================
   WRONG NETWORK
   ============================================================ */

export function WrongNetworkBanner() {
  return (
    <BannerShell tone="warn" icon="!" title="Wrong network" role="alert">
      This app runs on {PROTOCOL.CHAIN_NAME} (chain id {PROTOCOL.CHAIN_ID}). Switch networks in your wallet to
      read your position and sign transactions.
    </BannerShell>
  );
}

/* ============================================================
   POLICY MISMATCH  (audit 6, policy getters)
   Shown only when a figure on the page differs from the contracts.
   ============================================================ */

export function PolicyMismatchBanner() {
  return (
    <BannerShell tone="warn" icon="!" title="Page out of date" role="alert">
      Some limits on this page do not match the contracts on {PROTOCOL.CHAIN_NAME}. New bonding and staking are
      disabled here until this page is updated. Withdrawals and claims still work.
    </BannerShell>
  );
}

/* ============================================================
   LOW GAS
   ============================================================ */

export interface LowGasBannerProps {
  bnb: number;
}

export function LowGasBanner({ bnb }: LowGasBannerProps) {
  return (
    <BannerShell tone="warn" icon="⛽" title={`Low ${PROTOCOL.GAS_TOKEN} for gas`}>
      You hold <span style={MONO}>{bnb.toFixed(4)} {PROTOCOL.GAS_TOKEN}</span>, under the{" "}
      <span style={MONO}>{PROTOCOL.LOW_BNB_THRESHOLD} {PROTOCOL.GAS_TOKEN}</span> guideline. Every transaction
      needs a small amount of {PROTOCOL.GAS_TOKEN}. Top up before signing.
    </BannerShell>
  );
}

/* ============================================================
   PROFIT SHARE WARNING  (not dismissible)
   ============================================================ */

export function ProfitShareWarningBanner() {
  return (
    <div
      role="note"
      aria-label="Bonded deposit risk notice"
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "16px 18px",
        borderRadius: T.rMd,
        border: `1px solid ${T.warnBd}`,
        background: T.warnBg,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: T.warnFg,
          color: T.tInv,
          ...MONO,
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        !
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: "block", fontSize: 14, fontWeight: 700, color: T.warnFg, marginBottom: 4 }}>
          Your bonded balance can be reduced.
        </strong>
        <p style={{ margin: 0, fontSize: 13, color: T.tPri, lineHeight: 1.6 }}>
          {/* The contract's limits (audit 6, H-8): 2% per settlement, and the rolling
              30-day worst case the contract itself says to quote. Not "10% per
              7-day epoch", which the page said before. */}
          Bonded HCOW is consumed as the ecosystem is used. Up to {DEDUCTION_PER_SETTLEMENT_PCT}% of your bonded
          balance can be deducted at each settlement, and at most about {PROTOCOL.DEDUCTION.ROLLING_30D_MAX_PCT}% over
          any {PROTOCOL.DEDUCTION.WINDOW_DAYS} days. Deductions are permanent. In an epoch with no distributable
          profit, no deduction runs. This notice cannot be dismissed.
        </p>
        <p style={{ margin: "8px 0 0" }}>
          <ExtLink href={EXTERNAL_LINKS.LEARN_BONDED_DEPOSIT}>How bonded deposits work</ExtLink>
        </p>
      </div>
    </div>
  );
}

/* ============================================================
   PENDING WITHDRAWAL  (both lanes)
   ============================================================ */

export type Lane = "profit_share" | "network_staking";

export interface PendingWithdrawalBannerProps {
  lane: Lane;
  amount: number;
  /** Chain-authoritative. Never recomputed on the client. */
  readyAt: number;
  onCancel: () => void;
  onWithdraw: () => void;
  busy?: boolean;
}

export function PendingWithdrawalBanner({
  lane,
  amount,
  readyAt,
  onCancel,
  onWithdraw,
  busy = false,
}: PendingWithdrawalBannerProps) {
  const { remainingMs } = useCountdown(readyAt);
  const remaining = fmtCountdown(remainingMs);
  const ready = remaining === null;
  const noun = lane === "profit_share" ? "Unbond" : "Unstake";

  return (
    <BannerShell
      tone={ready ? "ok" : "info"}
      icon={ready ? "✓" : "⏳"}
      title={ready ? `${noun} ready to withdraw` : `${noun} request pending`}
      actions={
        <>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel request
          </Button>
          <Button size="sm" variant={ready ? "primary" : "secondary"} disabled={busy || !ready} onClick={onWithdraw}>
            Withdraw
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <span style={{ ...MONO, fontSize: 15, color: T.tPri }}>{fmtHcow(amount)}</span>
        <Badge tone={ready ? "ok" : "info"}>{ready ? "Ready now" : remaining}</Badge>
        <span style={{ fontSize: 12, color: T.tSec }}>
          {ready
            ? "Cooldown complete. Withdraw to move it back to your wallet."
            : `Cooldown ends ${fmtDate(readyAt)}`}
        </span>
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 12, color: T.tSec }}>
        {/* A pending unbond can still be charged once, at the first settlement
            after the request, and the amount shown is what it pays out now.
            Cancelling is allowed until the withdrawal, not only during the
            cooldown (audit 6, L-17). */}
        {lane === "profit_share"
          ? `The amount shown is what it pays out now. It can still be charged at the first settlement after your request, and never after that. You can cancel until you withdraw, which returns it to your bonded balance. Withdrawing is a manual step after the ${PROTOCOL.UNBOND_COOLDOWN_DAYS}-day cooldown.`
          : `You can cancel until you withdraw, which returns this amount to your delegation. Withdrawing is a manual step after the ${PROTOCOL.UNSTAKE_COOLDOWN_DAYS}-day cooldown.`}
      </p>
    </BannerShell>
  );
}
