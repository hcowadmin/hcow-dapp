/**
 * HCOW dApp — Design Tokens
 * Mirrors HCOW_DesignSystem_v0_1.html.
 * Never hardcode a hex value anywhere else.
 */
export const T = {
  bg: "#0A0E14",
  s1: "#131822",
  s2: "#1A2030",
  s3: "#232B3D",
  inset: "#0E131C",

  bSubtle: "rgba(232,236,242,0.06)",
  bDefault: "rgba(232,236,242,0.10)",
  bStrong: "rgba(232,236,242,0.18)",

  tPri: "#E8ECF2",
  tSec: "#8895AB",
  /** Only for decorative text. Fails WCAG AA on bg for body copy. */
  tTer: "#6C7A90",
  tInv: "#0A0E14",

  mint: "#00E5A0",
  blue: "#1E90FF",
  gradient: "linear-gradient(135deg, #00E5A0 0%, #1E90FF 100%)",
  gradientSoft: "linear-gradient(135deg, rgba(0,229,160,0.18) 0%, rgba(30,144,255,0.18) 100%)",

  okFg: "#00E5A0",
  okBg: "rgba(0,229,160,0.10)",
  okBd: "rgba(0,229,160,0.32)",

  infoFg: "#1E90FF",
  infoBg: "rgba(30,144,255,0.10)",
  infoBd: "rgba(30,144,255,0.32)",

  /** Reserved for the Profit Share lane only. */
  warnFg: "#FFB547",
  warnBg: "rgba(255,181,71,0.10)",
  warnBd: "rgba(255,181,71,0.32)",

  dangerFg: "#FF5C5C",
  dangerBg: "rgba(255,92,92,0.10)",
  dangerBd: "rgba(255,92,92,0.32)",

  /** Burn only. Deliberately separate from warning amber. */
  burn: "#FF8A4C",

  shadow: "0 8px 32px rgba(0,0,0,0.44)",
  shadowSm: "0 2px 10px rgba(0,0,0,0.30)",

  r: 6,
  rMd: 10,
  rLg: 14,

  font: "'Inter', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;
