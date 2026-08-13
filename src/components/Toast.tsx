/**
 * HCOW dApp — toast host.
 *
 * Every adapter failure lands here through presentError(). A raw error message
 * is never rendered. The host is a polite live region so a screen reader
 * announces the outcome of an action without stealing focus.
 */

import { useEffect } from "react";
import { T } from "../config/tokens";
import { PROTOCOL, txUrl } from "../config/constants";
import { shortHash } from "../lib/format";
import { presentError } from "../lib/errors";
import { MONO } from "./ui";

export type ToastTone = "info" | "warning" | "danger" | "success";

export interface ToastInput {
  tone: ToastTone;
  title: string;
  body: string;
  txHash?: string;
  offerTxLink?: boolean;
  offerNetworkSwitch?: boolean;
}

export interface ToastItem extends ToastInput {
  id: number;
}

export type PushToast = (t: ToastInput) => void;

const COLORS: Record<ToastTone, string> = {
  info: T.infoFg,
  warning: T.warnFg,
  danger: T.dangerFg,
  success: T.okFg,
};

export interface ToastHostProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxWidth: "min(92vw, 400px)",
      }}
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

interface ToastRowProps {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}

function ToastRow({ toast, onDismiss }: ToastRowProps) {
  const { id } = toast;

  useEffect(() => {
    const handle = setTimeout(() => onDismiss(id), PROTOCOL.TOAST_MS);
    return () => clearTimeout(handle);
  }, [id, onDismiss]);

  const accent = COLORS[toast.tone];
  const showLink = Boolean(toast.txHash) && (toast.offerTxLink !== false);

  return (
    <div
      style={{
        background: T.s2,
        border: `1px solid ${T.bDefault}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: T.r,
        boxShadow: T.shadow,
        padding: "12px 12px 12px 14px",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: "block", fontSize: 13, fontWeight: 600, color: accent, marginBottom: 2 }}>
          {toast.title}
        </strong>
        <p style={{ margin: 0, fontSize: 13, color: T.tPri, lineHeight: 1.5, wordBreak: "break-word" }}>
          {toast.body}
        </p>

        {toast.offerNetworkSwitch ? (
          <p style={{ margin: "6px 0 0", fontSize: 12, color: T.tSec }}>
            Open your wallet and switch to {PROTOCOL.CHAIN_NAME}, then try again.
          </p>
        ) : null}

        {showLink && toast.txHash ? (
          <a
            href={txUrl(toast.txHash)}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`View transaction ${toast.txHash} on BscScan, opens in a new tab`}
            style={{ ...MONO, display: "inline-block", marginTop: 8, fontSize: 11, color: T.infoFg, textDecoration: "none" }}
          >
            {shortHash(toast.txHash)} ↗
          </a>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label={`Dismiss notification: ${toast.title}`}
        style={{
          flexShrink: 0,
          width: 24,
          height: 24,
          lineHeight: 1,
          borderRadius: T.r,
          border: `1px solid ${T.bSubtle}`,
          background: "transparent",
          color: T.tSec,
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}

/**
 * Routes a failed read (from useAsync) into a toast exactly once per error.
 * Writes call presentError directly so they can honour keepModalOpen.
 */
export function useErrorToast(error: unknown, push: PushToast): void {
  useEffect(() => {
    if (error === null || error === undefined) return;
    const p = presentError(error);
    push({
      tone: p.tone,
      title: p.title,
      body: p.body,
      txHash: p.txHash,
      offerTxLink: p.offerTxLink,
      offerNetworkSwitch: p.offerNetworkSwitch,
    });
  }, [error, push]);
}
