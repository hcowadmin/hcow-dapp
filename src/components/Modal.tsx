/**
 * HCOW dApp — accessible dialog.
 *
 * role="dialog" + aria-modal, labelled by its heading, Escape closes, focus is
 * moved into the dialog on open and returned to the trigger on close, Tab is
 * trapped inside, and background scrolling is locked while it is open.
 */

import { useCallback, useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { T } from "../config/tokens";

export interface ModalProps {
  open: boolean;
  title: string;
  /** Optional one-line description rendered under the title and wired to aria-describedby. */
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Blocks Escape and the close button while a transaction is in flight. */
  busy?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = 480,
  busy = false,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  /* Focus in on open, focus back on close. */
  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }
    return () => {
      const target = restoreTo.current;
      if (target && document.contains(target)) target.focus();
      restoreTo.current = null;
    };
  }, [open]);

  /* Escape closes. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  /* Background scroll lock. */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 150,
        background: "rgba(0,0,0,0.62)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 24,
        overflowY: "auto",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
        style={{
          width: "100%",
          maxWidth: width,
          marginTop: "6vh",
          marginBottom: 24,
          background: T.s2,
          border: `1px solid ${T.bStrong}`,
          borderRadius: T.rLg,
          boxShadow: T.shadow,
          outline: "none",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            padding: "20px 24px 16px",
            borderBottom: `1px solid ${T.bSubtle}`,
          }}
        >
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: 18, fontWeight: 600, color: T.tPri }}>
              {title}
            </h2>
            {description ? (
              <p id={descId} style={{ margin: "6px 0 0", fontSize: 13, color: T.tSec, lineHeight: 1.5 }}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label={`Close ${title} dialog`}
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: T.r,
              border: `1px solid ${T.bDefault}`,
              background: "transparent",
              color: T.tSec,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.4 : 1,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>{children}</div>

        {footer ? (
          <footer
            style={{
              padding: "16px 24px 20px",
              borderTop: `1px solid ${T.bSubtle}`,
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
