import { PROTOCOL } from "../config/constants";
import type { Ratio } from "../data/adapter";

export function fmtAmount(n: number, dp = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtUsdt(n: number, dp = 2): string {
  return `${fmtAmount(n, dp)} USDT`;
}

export function fmtHcow(n: number, dp = 2): string {
  return `${fmtAmount(n, dp)} HCOW`;
}

/**
 * Every digit the number carries, at least two decimals. For the amount a user
 * is about to sign: a 2 dp label read "Bond 0.00 HCOW" over a signed 0.001
 * (audit 6, L-1). Same formatting the adapter uses to convert to wei, so the
 * label and the signed value cannot differ.
 */
export function fmtExact(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 18 });
}

export function fmtHcowExact(n: number): string {
  return `${fmtExact(n)} HCOW`;
}

/**
 * The shortest plain decimal string that reads back as exactly `n` (what
 * String(n) gives), for an amount field. Exponent forms, which String() uses
 * below 1e-6 and from 1e21, are written out instead. 0 for anything not a
 * positive finite number.
 */
export function exactDecimal(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

/**
 * Cut to `dp` decimals, never rounding up, as a plain decimal string. The
 * quick-fill buttons used toFixed, which rounds half up, so MAX wrote more
 * than the balance and the form refused its own value (audit 6, H-5). This
 * cuts the shortest decimal form of the number, so 0.3 stays 0.3: cutting the
 * double's full binary expansion (0.29999999999999998890) wrote 0.299999
 * for about half of all two-decimal balances (review, 2026-09-25).
 */
export function floorDecimals(n: number, dp = 6): string {
  const [int, frac = ""] = exactDecimal(n).split(".");
  const cut = frac.slice(0, dp).replace(/0+$/, "");
  return cut.length > 0 ? `${int}.${cut}` : int;
}

/** Percent value in 0..100. */
export function fmtPct(n: number, dp = 1): string {
  return `${fmtAmount(n, dp)}%`;
}

/** Ratio in 0..1, rendered as a percent with a small-value floor. */
export function fmtRatioPct(r: Ratio, dp = 2): string {
  if (r > 0 && r < PROTOCOL.MIN_DISPLAY_SHARE_RATIO) return "< 0.01%";
  return `${fmtAmount(r * 100, dp)}%`;
}

export function shortHash(h: string, head = 6, tail = 4): string {
  if (h.length <= head + tail + 2) return h;
  return `${h.slice(0, head)}...${h.slice(-tail)}`;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** Countdown. Returns null once the target time has passed; callers show a status instead. */
export function fmtCountdown(ms: number): string | null {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${h}h ${m}m ${sec}s`;
}

export function fmtDuration(ms: number): string {
  const days = Math.ceil(ms / 86400000);
  return days === 1 ? "1 day" : `${days} days`;
}
