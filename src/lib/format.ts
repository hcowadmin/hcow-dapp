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

/** Countdown. Returns null when the deadline has passed, so callers show "Settling...". */
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
