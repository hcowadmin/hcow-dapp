/**
 * HCOW dApp — persistent banners.
 *
 * The Profit Share warning is deliberately NOT dismissible: the deduction risk
 * is the single most important fact about that lane.
 */

import type { ReactNode } from "react";
import { T } from "../config/tokens";
import { EXTERNAL_LINKS, PROTOCOL } from "../config/constants";
import { fmtCountdown, fmtDate, fmtHcow } from "../lib/format";
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
          Bonded HCOW is consumed as the ecosystem is used. Up to {PROTOCOL.DEDUCTION_CAP_PCT}% of your bonded
          balance can be deducted in a single {PROTOCOL.EPOCH_DAYS}-day epoch, and deductions are permanent. In an
          epoch with no distributable profit, no deduction runs. This notice cannot be dismissed.
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
        {lane === "profit_share"
          ? `Cancelling returns this amount to your bonded balance. Withdrawing is a manual step after the ${PROTOCOL.UNBOND_COOLDOWN_DAYS}-day cooldown.`
          : `Cancelling returns this amount to your delegation. Withdrawing is a manual step after the ${PROTOCOL.UNSTAKE_COOLDOWN_DAYS}-day cooldown.`}
      </p>
    </BannerShell>
  );
}
