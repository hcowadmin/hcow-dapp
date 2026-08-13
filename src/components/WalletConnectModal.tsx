/**
 * HCOW dApp — wallet connect.
 *
 * Connection is gated on an explicit acknowledgement: Terms, Privacy, age and
 * jurisdiction. The links are real URLs from EXTERNAL_LINKS, never "#".
 */

import { useEffect, useState } from "react";
import { adapter } from "../data";
import type { WalletProvider } from "../data";
import { T } from "../config/tokens";
import { EXTERNAL_LINKS, PROTOCOL } from "../config/constants";
import { presentError } from "../lib/errors";
import { Modal } from "./Modal";
import { Button, Checkbox, ExtLink, MONO } from "./ui";
import type { PushToast } from "./Toast";

export interface WalletConnectModalProps {
  open: boolean;
  onClose: () => void;
  pushToast: PushToast;
}

interface ProviderOption {
  id: WalletProvider;
  name: string;
  glyph: string;
  blurb: string;
}

const OPTIONS: readonly ProviderOption[] = [
  {
    id: "metamask",
    name: "MetaMask",
    glyph: "M",
    blurb: "Browser extension or the MetaMask mobile app.",
  },
  {
    id: "walletconnect",
    name: "WalletConnect",
    glyph: "W",
    blurb: "Scan a QR code with any WalletConnect v2 wallet.",
  },
];

/** The chain adapter throws UNKNOWN_ERROR with a message the UI turns into an install link. */
function mentionsMissingProvider(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : "";
  return /no provider|no injected|not detected|not installed|install/i.test(msg);
}

export function WalletConnectModal({ open, onClose, pushToast }: WalletConnectModalProps) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<WalletProvider | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    if (!open) {
      setBusy(null);
      setShowInstall(false);
    }
  }, [open]);

  async function connect(provider: WalletProvider): Promise<void> {
    setBusy(provider);
    try {
      const state = await adapter.connectWallet(provider);
      pushToast({
        tone: "success",
        title: "Wallet connected",
        body: state.address
          ? `Connected as ${state.address.slice(0, 6)}…${state.address.slice(-4)} on ${PROTOCOL.CHAIN_NAME}.`
          : `Connected on ${PROTOCOL.CHAIN_NAME}.`,
      });
      onClose();
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
      if (provider === "metamask" && mentionsMissingProvider(e)) setShowInstall(true);
      if (!p.keepModalOpen) onClose();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open={open}
      title="Connect a wallet"
      description={`HCOW runs on ${PROTOCOL.CHAIN_NAME}. Ecosystem data is visible without connecting.`}
      onClose={onClose}
      busy={busy !== null}
      width={460}
    >
      <div style={{ display: "grid", gap: 10 }}>
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={!agreed || busy !== null}
            onClick={() => void connect(o.id)}
            aria-describedby="wallet-consent"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              width: "100%",
              textAlign: "left",
              padding: "14px 16px",
              borderRadius: T.rMd,
              border: `1px solid ${T.bDefault}`,
              background: T.inset,
              color: T.tPri,
              cursor: !agreed || busy !== null ? "not-allowed" : "pointer",
              opacity: !agreed || busy !== null ? 0.5 : 1,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                borderRadius: T.r,
                display: "grid",
                placeItems: "center",
                background: T.gradientSoft,
                border: `1px solid ${T.bDefault}`,
                ...MONO,
                fontSize: 15,
                fontWeight: 700,
                color: T.tPri,
              }}
            >
              {o.glyph}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{o.name}</span>
              <span style={{ display: "block", fontSize: 12, color: T.tSec, marginTop: 2 }}>{o.blurb}</span>
            </span>
            <span style={{ ...MONO, fontSize: 12, color: T.tSec }}>
              {busy === o.id ? "Connecting…" : "→"}
            </span>
          </button>
        ))}
      </div>

      {showInstall ? (
        <div
          role="status"
          style={{
            padding: "12px 14px",
            borderRadius: T.rMd,
            background: T.infoBg,
            border: `1px solid ${T.infoBd}`,
            fontSize: 13,
            color: T.tPri,
            lineHeight: 1.55,
          }}
        >
          No wallet provider was detected in this browser.{" "}
          <ExtLink href={EXTERNAL_LINKS.METAMASK_INSTALL} style={{ fontSize: 13 }}>
            Install MetaMask
          </ExtLink>{" "}
          and reload the page, or connect with WalletConnect instead.
        </div>
      ) : null}

      <div
        style={{
          padding: 14,
          borderRadius: T.rMd,
          background: T.inset,
          border: `1px solid ${T.bDefault}`,
          display: "grid",
          gap: 10,
        }}
      >
        <Checkbox
          id="wallet-consent-check"
          checked={agreed}
          onChange={setAgreed}
          describedById="wallet-consent"
          label="I have read and agree to the Terms of Service and the Privacy Policy."
        />
        <p id="wallet-consent" style={{ margin: 0, fontSize: 12, color: T.tSec, lineHeight: 1.6 }}>
          I confirm I am at least 18 years old and that using this application is permitted in my jurisdiction.
          Connecting a wallet does not create an account and grants no custody of your assets.{" "}
          <ExtLink href={EXTERNAL_LINKS.TERMS}>Terms of Service</ExtLink>{" · "}
          <ExtLink href={EXTERNAL_LINKS.PRIVACY}>Privacy Policy</ExtLink>
        </p>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: T.tSec, lineHeight: 1.6 }}>
        Bonded HCOW can be reduced by up to {PROTOCOL.DEDUCTION_CAP_PCT}% per {PROTOCOL.EPOCH_DAYS}-day epoch.
        Staked HCOW is locked, and is not subject to deduction.
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
          Not now
        </Button>
      </div>
    </Modal>
  );
}
