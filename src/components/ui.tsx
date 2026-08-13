/**
 * HCOW dApp — primitive UI kit.
 *
 * Every colour, radius and font comes from src/config/tokens.ts. No hex values
 * are written here. Every protocol number comes from src/config/constants.ts.
 */

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { T } from "../config/tokens";
import { addressUrl } from "../config/constants";
import { fmtAmount, shortHash } from "../lib/format";

/** Top-level destinations. Lives here so screens and the shell agree. */
export type Route = "home" | "profit" | "staking" | "portfolio";

export type Tone = "ok" | "warn" | "danger" | "info" | "muted" | "burn";

export interface ToneColors {
  fg: string;
  bg: string;
  bd: string;
}

const TONES: Record<Tone, ToneColors> = {
  ok: { fg: T.okFg, bg: T.okBg, bd: T.okBd },
  warn: { fg: T.warnFg, bg: T.warnBg, bd: T.warnBd },
  danger: { fg: T.dangerFg, bg: T.dangerBg, bd: T.dangerBd },
  info: { fg: T.infoFg, bg: T.infoBg, bd: T.infoBd },
  muted: { fg: T.tSec, bg: T.s2, bd: T.bDefault },
  burn: { fg: T.burn, bg: T.s2, bd: T.bDefault },
};

export function toneColors(tone: Tone): ToneColors {
  return TONES[tone];
}

/* ============================================================
   TEXT HELPERS
   ============================================================ */

export const MONO: CSSProperties = { fontFamily: T.mono };

export interface SectionLabelProps {
  children: ReactNode;
  right?: ReactNode;
  style?: CSSProperties;
}

export function SectionLabel({ children, right, style }: SectionLabelProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 16,
        paddingBottom: 12,
        marginBottom: 16,
        borderBottom: `1px solid ${T.bSubtle}`,
        ...style,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: "-0.005em",
          color: T.tPri,
        }}
      >
        {children}
      </h2>
      {right ? (
        <div style={{ ...MONO, fontSize: 11, letterSpacing: "0.1em", color: T.tSec, textTransform: "uppercase" }}>
          {right}
        </div>
      ) : null}
    </div>
  );
}

export interface DividerProps {
  space?: number;
}

export function Divider({ space = 16 }: DividerProps) {
  return <div style={{ height: 1, background: T.bSubtle, margin: `${space}px 0` }} />;
}

/* ============================================================
   BUTTON
   ============================================================ */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  block?: boolean;
  type?: "button" | "submit";
  /** Required when the button has no readable text (icon-only). */
  ariaLabel?: string;
  ariaPressed?: boolean;
  ariaControls?: string;
  title?: string;
  style?: CSSProperties;
}

const SIZES: Record<ButtonSize, { h: number; fs: number; px: number }> = {
  sm: { h: 32, fs: 12, px: 12 },
  md: { h: 40, fs: 14, px: 16 },
  lg: { h: 48, fs: 15, px: 24 },
};

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  disabled = false,
  block = false,
  type = "button",
  ariaLabel,
  ariaPressed,
  ariaControls,
  title,
  style,
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const s = SIZES[size];

  let bg: string = T.s2;
  let fg: string = T.tPri;
  let bd: string = T.bDefault;
  let weight = 600;

  if (variant === "primary") {
    bg = T.gradient;
    fg = T.tInv;
    bd = "transparent";
    weight = 700;
  } else if (variant === "ghost") {
    bg = "transparent";
    fg = T.tSec;
    bd = "transparent";
  } else if (variant === "danger") {
    bg = T.dangerBg;
    fg = T.dangerFg;
    bd = T.dangerBd;
  } else if (variant === "success") {
    bg = T.okBg;
    fg = T.okFg;
    bd = T.okBd;
  }

  const lifted = hover && !disabled;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-controls={ariaControls}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onBlur={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: s.h,
        padding: `0 ${s.px}px`,
        width: block ? "100%" : undefined,
        fontSize: s.fs,
        fontWeight: weight,
        lineHeight: 1,
        letterSpacing: "-0.005em",
        borderRadius: T.r,
        border: `1px solid ${bd}`,
        background: bg,
        color: fg,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        whiteSpace: "nowrap",
        transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease",
        transform: lifted && variant === "primary" ? "translateY(-1px)" : "none",
        boxShadow: lifted && variant === "primary" ? T.shadowSm : "none",
        filter: lifted && variant !== "primary" ? "brightness(1.25)" : "none",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/* ============================================================
   CARD
   ============================================================ */

export interface CardProps {
  children: ReactNode;
  title?: ReactNode;
  kicker?: ReactNode;
  right?: ReactNode;
  elevated?: boolean;
  padding?: number;
  tone?: Tone;
  style?: CSSProperties;
}

export function Card({ children, title, kicker, right, elevated = false, padding = 24, tone, style }: CardProps) {
  const c = tone ? toneColors(tone) : null;
  return (
    <section
      style={{
        background: elevated ? T.s2 : T.s1,
        border: `1px solid ${c ? c.bd : T.bDefault}`,
        borderRadius: T.rLg,
        padding,
        boxShadow: elevated ? T.shadow : "none",
        ...style,
      }}
    >
      {title || kicker || right ? (
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            {kicker ? (
              <div
                style={{
                  ...MONO,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: T.tSec,
                  marginBottom: 6,
                }}
              >
                {kicker}
              </div>
            ) : null}
            {title ? (
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: T.tPri }}>{title}</h3>
            ) : null}
          </div>
          {right ? <div>{right}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/* ============================================================
   METRIC
   ============================================================ */

export interface MetricProps {
  label: string;
  /** Pass a Skeleton while loading. Never pass a number derived from null data. */
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: Tone;
}

export function Metric({ label, value, unit, hint, tone }: MetricProps) {
  const c = tone ? toneColors(tone) : null;
  return (
    <div
      style={{
        padding: 20,
        background: T.s1,
        border: `1px solid ${T.bDefault}`,
        borderRadius: T.rLg,
        minWidth: 0,
      }}
    >
      <div
        style={{
          ...MONO,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: T.tSec,
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <div
        style={{
          ...MONO,
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: c ? c.fg : T.tPri,
          wordBreak: "break-word",
        }}
      >
        {value}
        {unit ? <span style={{ fontSize: 13, color: T.tSec, marginLeft: 6 }}>{unit}</span> : null}
      </div>
      {hint ? <div style={{ marginTop: 8, fontSize: 12, color: T.tSec, lineHeight: 1.45 }}>{hint}</div> : null}
    </div>
  );
}

/* ============================================================
   BADGE
   ============================================================ */

export interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}

export function Badge({ children, tone = "muted", title }: BadgeProps) {
  const c = toneColors(tone);
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...MONO,
        fontSize: 11,
        fontWeight: 500,
        padding: "4px 8px",
        borderRadius: T.r,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 6, height: 6, borderRadius: "50%", background: c.fg, flexShrink: 0 }}
      />
      {children}
    </span>
  );
}

/* ============================================================
   KEY / VALUE ROW
   ============================================================ */

export interface KVProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  emphasis?: boolean;
  tone?: Tone;
}

export function KV({ label, value, sub, emphasis = false, tone }: KVProps) {
  const c = tone ? toneColors(tone) : null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 16,
        padding: "12px 0",
        borderBottom: `1px solid ${T.bSubtle}`,
      }}
    >
      <div style={{ fontSize: 13, color: T.tSec, minWidth: 0 }}>{label}</div>
      <div style={{ textAlign: "right", minWidth: 0 }}>
        <div
          style={{
            ...MONO,
            fontSize: emphasis ? 17 : 14,
            fontWeight: 500,
            color: c ? c.fg : T.tPri,
            wordBreak: "break-word",
          }}
        >
          {value}
        </div>
        {sub ? <div style={{ fontSize: 11, color: T.tSec, marginTop: 4 }}>{sub}</div> : null}
      </div>
    </div>
  );
}

/* ============================================================
   PROGRESS
   ============================================================ */

export interface ProgressBarProps {
  /** 0..1 */
  ratio: number;
  label: string;
  tone?: Tone;
}

export function ProgressBar({ ratio, label, tone = "ok" }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const c = toneColors(tone);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      style={{
        height: 8,
        width: "100%",
        borderRadius: 999,
        background: T.inset,
        border: `1px solid ${T.bSubtle}`,
        overflow: "hidden",
      }}
    >
      <div style={{ height: "100%", width: `${clamped * 100}%`, background: c.fg }} />
    </div>
  );
}

/* ============================================================
   SKELETON
   ============================================================ */

export interface SkeletonProps {
  width?: number | string;
  height?: number;
  radius?: number;
}

export function Skeleton({ width = "100%", height = 16, radius = 6 }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width,
        height,
        borderRadius: radius,
        background: T.s3,
        opacity: 0.55,
      }}
    />
  );
}

/** Screen-reader friendly loading region wrapper. */
export interface LoadingBlockProps {
  label: string;
  rows?: number;
}

export function LoadingBlock({ label, rows = 3 }: LoadingBlockProps) {
  return (
    <div aria-busy="true" aria-live="polite" style={{ display: "grid", gap: 10 }}>
      <span style={SR_ONLY}>{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={14} width={i % 2 === 0 ? "100%" : "72%"} />
      ))}
    </div>
  );
}

export const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/* ============================================================
   EMPTY STATE
   ============================================================ */

export interface EmptyStateProps {
  title: string;
  body: string;
  action?: ReactNode;
  tone?: Tone;
}

export function EmptyState({ title, body, action, tone = "muted" }: EmptyStateProps) {
  const c = toneColors(tone);
  return (
    <div
      style={{
        padding: 32,
        borderRadius: T.rMd,
        border: `1px dashed ${c.bd}`,
        background: T.inset,
        textAlign: "center",
      }}
    >
      <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: T.tPri }}>{title}</p>
      <p style={{ margin: "0 auto", maxWidth: 480, fontSize: 13, color: T.tSec, lineHeight: 1.55 }}>{body}</p>
      {action ? <div style={{ marginTop: 18 }}>{action}</div> : null}
    </div>
  );
}

/* ============================================================
   ADDRESS CHIP
   ============================================================ */

export interface AddressChipProps {
  address: string;
  label?: string;
}

export function AddressChip({ address, label }: AddressChipProps) {
  return (
    <a
      href={addressUrl(address)}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`${label ?? "Address"} ${address} on BscScan, opens in a new tab`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...MONO,
        fontSize: 12,
        padding: "4px 8px",
        borderRadius: T.r,
        background: T.s2,
        border: `1px solid ${T.bDefault}`,
        color: T.tPri,
        textDecoration: "none",
      }}
    >
      {shortHash(address, 6, 4)}
      <span aria-hidden="true" style={{ color: T.tSec }}>
        ↗
      </span>
    </a>
  );
}

/* ============================================================
   APR
   ============================================================
   PoolStats / StakedPosition / Representative all expose
   estimatedAprPct as number | null. Null renders a dash and
   "Methodology pending". Non-null always carries the disclaimer.
   Nothing else in the app may render an APR. */

export interface AprProps {
  pct: number | null;
  size?: "lg" | "sm";
}

export function Apr({ pct, size = "lg" }: AprProps) {
  const big = size === "lg";
  if (pct === null) {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
        <span style={{ ...MONO, fontSize: big ? 26 : 14, color: T.tSec }}>—</span>
        <span style={{ fontSize: 11, color: T.tSec }}>Methodology pending</span>
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...MONO, fontSize: big ? 26 : 14, color: T.tPri }}>~{fmtAmount(pct, 1)}%</span>
      <span style={{ fontSize: 11, color: T.tSec }}>Based on last epoch. Not guaranteed.</span>
    </span>
  );
}

/* ============================================================
   AMOUNT INPUT
   ============================================================ */

export interface AmountInputProps {
  id: string;
  label: string;
  /** Controlled string so the field can be empty. */
  value: string;
  onChange: (next: string) => void;
  /** Rendered under the field and wired through aria-describedby. */
  hint: string;
  ticker?: string;
  balanceLabel?: string;
  maxValue?: number | null;
  disabled?: boolean;
  invalid?: boolean;
}

const QUICK: readonly number[] = [0.25, 0.5, 0.75, 1];

export function AmountInput({
  id,
  label,
  value,
  onChange,
  hint,
  ticker = "HCOW",
  balanceLabel,
  maxValue = null,
  disabled = false,
  invalid = false,
}: AmountInputProps) {
  const hintId = `${id}-hint`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <label htmlFor={id} style={{ fontSize: 13, color: T.tSec }}>
          {label}
        </label>
        {balanceLabel ? (
          <span style={{ ...MONO, fontSize: 12, color: T.tSec }}>{balanceLabel}</span>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: T.inset,
          border: `1px solid ${invalid ? T.dangerBd : T.bDefault}`,
          borderRadius: T.rMd,
          padding: "0 14px",
          height: 56,
        }}
      >
        <input
          id={id}
          name={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          autoComplete="off"
          disabled={disabled}
          value={value}
          aria-describedby={hintId}
          aria-invalid={invalid}
          placeholder="0.00"
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: 0,
            outline: "none",
            ...MONO,
            fontSize: 20,
            fontWeight: 500,
            color: T.tPri,
          }}
        />
        <span
          style={{
            ...MONO,
            fontSize: 13,
            color: T.tSec,
            paddingLeft: 12,
            borderLeft: `1px solid ${T.bDefault}`,
          }}
        >
          {ticker}
        </span>
      </div>

      {maxValue !== null && maxValue > 0 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {QUICK.map((q) => (
            <Button
              key={q}
              size="sm"
              variant="secondary"
              disabled={disabled}
              ariaLabel={`Set amount to ${Math.round(q * 100)} percent of ${fmtAmount(maxValue, 2)} ${ticker}`}
              onClick={() => onChange(String(Number((maxValue * q).toFixed(6))))}
            >
              {q === 1 ? "MAX" : `${Math.round(q * 100)}%`}
            </Button>
          ))}
        </div>
      ) : null}

      <p id={hintId} style={{ margin: 0, fontSize: 12, color: invalid ? T.dangerFg : T.tSec, lineHeight: 1.5 }}>
        {hint}
      </p>
    </div>
  );
}

/* ============================================================
   RESPONSIVE GRID
   ============================================================ */

export interface AutoGridProps {
  children: ReactNode;
  /** Minimum column width before the grid wraps. */
  min?: number;
  gap?: number;
  style?: CSSProperties;
}

export function AutoGrid({ children, min = 240, gap = 16, style }: AutoGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`,
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ============================================================
   EXTERNAL LINK
   ============================================================ */

export interface ExtLinkProps {
  href: string;
  children: ReactNode;
  ariaLabel?: string;
  style?: CSSProperties;
}

export function ExtLink({ href, children, ariaLabel, style }: ExtLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={ariaLabel}
      style={{ color: T.infoFg, textDecoration: "none", fontSize: 12, ...style }}
    >
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

/* ============================================================
   CHECKBOX
   ============================================================ */

export interface CheckboxProps {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  describedById?: string;
  disabled?: boolean;
}

export function Checkbox({ id, checked, onChange, label, describedById, disabled = false }: CheckboxProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedById}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 2, accentColor: T.mint, flexShrink: 0 }}
      />
      <label htmlFor={id} style={{ fontSize: 13, color: T.tPri, lineHeight: 1.5 }}>
        {label}
      </label>
    </div>
  );
}
