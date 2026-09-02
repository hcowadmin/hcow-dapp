/**
 * HCOW dApp — published epoch waterfall.
 *
 * Renders EpochDistribution in full, in the order the policy defines:
 *   gross received -> direct costs -> net revenue -> operating costs (capped)
 *   -> distributable profit -> 50 / 25 / 25 split.
 *
 * Publishing every line is what keeps the discretion visible, so nothing here
 * is collapsed or rounded away. Chain-verifiable lines and attested off-chain
 * lines are visually separated: an attestation is a published statement, not a
 * chain proof, and the UI must not blur that difference.
 */

import type { ReactNode } from "react";
import { T } from "../config/tokens";
import { PROTOCOL, txUrl } from "../config/constants";
import type { CostCategory, CostLine, EpochDistribution, RevenueLine, RevenueOrigin } from "../data";
import { fmtDate, fmtHcow, fmtRatioPct, fmtUsdt, shortHash } from "../lib/format";
import { Badge, Divider, ExtLink, MONO, ProgressBar, toneColors } from "./ui";

/**
 * Display names for revenue origins. The remaining off-chain table-game origin
 * is handled by the default branch so its raw identifier is never rendered.
 */
export function originLabel(origin: RevenueOrigin): string {
  switch (origin) {
    case "in_game_hcow":
      return "In-game HCOW spend";
    case "apple_app_store":
      return "Apple App Store";
    case "google_play":
      return "Google Play";
    case "ad_network":
      return "Ad networks";
    case "b2b_licensing":
      return "B2B licensing";
    case "other":
      return "Other game revenue";
    default:
      return "Table game fees";
  }
}

const COST_LABEL: Record<CostCategory, string> = {
  platform_fee: "Platform fee",
  payment_processing: "Payment processing",
  fx_and_conversion: "FX and stablecoin conversion",
  transaction_tax: "Transaction-level tax",
  infrastructure: "Infrastructure",
  personnel: "Personnel",
  marketing: "Marketing",
  game_content: "Game content",
  support_and_ops: "Support and operations",
};

interface RowProps {
  label: string;
  value: string;
  sign?: "plus" | "minus" | "none";
  strong?: boolean;
  note?: string;
  indent?: boolean;
  right?: ReactNode;
}

function Row({ label, value, sign = "none", strong = false, note, indent = false, right }: RowProps) {
  const color = sign === "minus" ? T.warnFg : T.tPri;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 16,
        padding: strong ? "14px 0" : "9px 0",
        paddingLeft: indent ? 16 : 0,
        borderBottom: `1px solid ${T.bSubtle}`,
        background: strong ? T.inset : "transparent",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: strong ? 14 : 13, fontWeight: strong ? 600 : 400, color: strong ? T.tPri : T.tSec }}>
          {label}
        </div>
        {note ? <div style={{ fontSize: 11, color: T.tSec, marginTop: 3 }}>{note}</div> : null}
        {right ? <div style={{ marginTop: 6 }}>{right}</div> : null}
      </div>
      <div
        style={{
          ...MONO,
          fontSize: strong ? 16 : 13,
          fontWeight: 500,
          color,
          whiteSpace: "nowrap",
        }}
      >
        {sign === "minus" ? "− " : null}
        {value}
      </div>
    </div>
  );
}

export function RevenueLineRow({ line }: { line: RevenueLine }) {
  return (
    <Row
      label={originLabel(line.origin)}
      value={fmtUsdt(line.grossUsdt)}
      indent
      right={
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {line.chainVerifiable ? (
            <Badge tone="ok" title="Settled on chain and independently verifiable">
              Chain verified
            </Badge>
          ) : (
            <Badge tone="warn" title="Received off chain. Backed by a published statement, not by chain state.">
              Attested
            </Badge>
          )}
          {line.attestationUrl ? (
            <ExtLink href={line.attestationUrl} ariaLabel={`Payout statement for ${originLabel(line.origin)}`}>
              Statement
            </ExtLink>
          ) : null}
          {line.depositTxHash ? (
            <ExtLink
              href={txUrl(line.depositTxHash)}
              ariaLabel={`Deposit transaction ${line.depositTxHash} on BscScan`}
            >
              Deposit {shortHash(line.depositTxHash, 6, 4)}
            </ExtLink>
          ) : null}
        </div>
      }
    />
  );
}

function CostRow({ line }: { line: CostLine }) {
  return (
    <Row
      label={COST_LABEL[line.category]}
      value={fmtUsdt(line.amountUsdt)}
      sign="minus"
      indent
      note={line.note ?? undefined}
    />
  );
}

interface SplitProps {
  label: string;
  pct: number;
  value: number;
  tone: "ok" | "info" | "muted";
  note: string;
}

function Split({ label, pct, value, tone, note }: SplitProps) {
  const c = toneColors(tone);
  return (
    <div
      style={{
        padding: 16,
        borderRadius: T.rMd,
        background: T.inset,
        border: `1px solid ${c.bd}`,
        minWidth: 0,
      }}
    >
      <div style={{ ...MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: c.fg }}>
        {pct}% · {label}
      </div>
      <div style={{ ...MONO, fontSize: 20, fontWeight: 500, color: T.tPri, marginTop: 8, wordBreak: "break-word" }}>
        {fmtUsdt(value)}
      </div>
      <div style={{ fontSize: 11, color: T.tSec, marginTop: 6, lineHeight: 1.5 }}>{note}</div>
    </div>
  );
}

export interface EpochWaterfallProps {
  distribution: EpochDistribution;
}

export function EpochWaterfall({ distribution: d }: EpochWaterfallProps) {
  const directLines = d.costs.filter((c) => c.isDirect);
  const opexLines = d.costs.filter((c) => !c.isDirect);

  return (
    <div>
      {/* ---- header ---- */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Badge tone="info">Epoch #{d.epoch}</Badge>
          <span style={{ fontSize: 12, color: T.tSec }}>Settled {fmtDate(d.settledAt)}</span>
        </div>
        <ExtLink href={txUrl(d.txHash)} ariaLabel={`Settlement transaction ${d.txHash} on BscScan`}>
          Settlement tx {shortHash(d.txHash, 6, 4)}
        </ExtLink>
      </div>

      {/* ---- chain verifiable indicator ---- */}
      <div
        style={{
          padding: 16,
          borderRadius: T.rMd,
          background: T.inset,
          border: `1px solid ${T.bDefault}`,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: T.tPri }}>Chain verifiable share of gross</span>
          <span style={{ ...MONO, fontSize: 16, color: T.okFg }}>{fmtRatioPct(d.chainVerifiableRatio, 1)}</span>
        </div>
        <ProgressBar
          ratio={d.chainVerifiableRatio}
          label={`Chain verifiable share of gross received in epoch ${d.epoch}`}
        />
        <p style={{ margin: "10px 0 0", fontSize: 12, color: T.tSec, lineHeight: 1.55 }}>
          Chain verified money is HCOW spent in game and settled on {PROTOCOL.CHAIN_NAME}. The remainder arrives
          off chain and is attested by a published payout statement paired with the on-chain deposit that carried
          it into the vault. An attestation is a statement, not a chain proof.
        </p>
      </div>

      {/* ---- waterfall ---- */}
      <div style={{ ...MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.tSec, marginBottom: 6 }}>
        Money received
      </div>
      {d.revenue.map((line) => (
        <RevenueLineRow key={`${line.origin}-${line.cls}`} line={line} />
      ))}
      <Row label="Gross received" value={fmtUsdt(d.grossReceivedUsdt)} strong />

      <Divider space={12} />

      <div style={{ ...MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.tSec, marginBottom: 6 }}>
        Direct costs · not subject to the cap
      </div>
      {directLines.length === 0 ? (
        <Row label="No direct costs recorded" value={fmtUsdt(0)} indent />
      ) : (
        directLines.map((line) => <CostRow key={line.category} line={line} />)
      )}
      <Row label="Direct costs" value={fmtUsdt(d.directCostsUsdt)} sign="minus" />
      <Row label="Net revenue" value={fmtUsdt(d.netRevenueUsdt)} strong />

      <Divider space={12} />

      <div style={{ ...MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.tSec, marginBottom: 6 }}>
        Operating costs · capped at {PROTOCOL.OPEX_CAP_PCT}% of net revenue
      </div>
      {opexLines.length === 0 ? (
        <Row label="No operating costs recorded" value={fmtUsdt(0)} indent />
      ) : (
        opexLines.map((line) => <CostRow key={line.category} line={line} />)
      )}
      <Row label="Operating costs deducted" value={fmtUsdt(d.operatingCostsUsdt)} sign="minus" />

      {d.operatingCostsAboveCapUsdt > 0 ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 16,
            padding: "12px 14px",
            margin: "10px 0",
            borderRadius: T.rMd,
            background: T.warnBg,
            border: `1px solid ${T.warnBd}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.warnFg }}>Operating costs above the cap</div>
            <div style={{ fontSize: 12, color: T.tPri, marginTop: 3, lineHeight: 1.5 }}>
              Absorbed by the game studio and project team shares. Not deducted from the participant share.
            </div>
          </div>
          <div style={{ ...MONO, fontSize: 14, color: T.warnFg, whiteSpace: "nowrap" }}>
            {fmtUsdt(d.operatingCostsAboveCapUsdt)}
          </div>
        </div>
      ) : null}

      <Row label="Distributable profit" value={fmtUsdt(d.distributableProfitUsdt)} strong />

      {/* ---- split ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
          gap: 12,
          marginTop: 20,
        }}
      >
        <Split
          label="Participants"
          pct={PROTOCOL.DISTRIBUTION.PARTICIPANTS_PCT}
          value={d.participantsUsdt}
          tone="ok"
          note="Paid pro-rata to bonded balance at the epoch snapshot."
        />
        <Split
          label="Game studio"
          pct={PROTOCOL.DISTRIBUTION.GAME_STUDIO_PCT}
          value={d.gameStudioUsdt}
          tone="info"
          note="Live operations and new titles."
        />
        <Split
          label="Project team"
          pct={PROTOCOL.DISTRIBUTION.TEAM_PCT}
          value={d.teamUsdt}
          tone="muted"
          note="Paid to the project team. The contract calls this leg team."
        />
      </div>

      {/* ---- deduction ---- */}
      <div style={{ marginTop: 20 }}>
        <Row
          label="HCOW deducted from bonded principal"
          value={fmtHcow(d.totalHcowDeducted)}
          sign={d.totalHcowDeducted > 0 ? "minus" : "none"}
          note={
            d.distributableProfitUsdt > 0
              ? `Metered by RNG and VRF usage, capped at ${PROTOCOL.DEDUCTION_CAP_PCT}% of a bonded balance per epoch.`
              : "No distributable profit this epoch, so no deduction ran."
          }
        />
        <Row
          label="Bonded pool at snapshot"
          value={fmtHcow(d.snapshotBondedHcow)}
          note="The denominator for every participant share this epoch."
        />
      </div>
    </div>
  );
}
