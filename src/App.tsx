/**
 * HCOW dApp — application shell.
 *
 * Owns: routing, the wallet header, the global banners, the toast host and the
 * wallet-connect modal. It holds no protocol data of its own; screens fetch what
 * they need through useAsync and reload after a write or a wallet change.
 *
 * Nothing here polls. Wallet state arrives from subscribeWallet via useWallet.
 */

import { useCallback, useRef, useState } from "react";
import { adapter } from "./data";
import { T } from "./config/tokens";
import { EXTERNAL_LINKS, PROTOCOL } from "./config/constants";
import { HCOW_MARK } from "./config/brand";
import { presentError } from "./lib/errors";
import { fmtAmount, shortHash } from "./lib/format";
import { useWallet } from "./hooks/useWallet";
import { LowGasBanner, WrongNetworkBanner } from "./components/Banners";
import { ToastHost } from "./components/Toast";
import type { ToastInput, ToastItem } from "./components/Toast";
import { WalletConnectModal } from "./components/WalletConnectModal";
import { Button, MONO } from "./components/ui";
import type { Route } from "./components/ui";
import { HomeScreen } from "./screens/HomeScreen";
import { ProfitShareScreen } from "./screens/ProfitShareScreen";
import { NetworkStakingScreen } from "./screens/NetworkStakingScreen";
import { PortfolioScreen } from "./screens/PortfolioScreen";

interface NavItem {
  id: Route;
  label: string;
}

const NAV: readonly NavItem[] = [
  { id: "home", label: "Dashboard" },
  { id: "profit", label: "Profit Share" },
  { id: "staking", label: "Network Staking" },
  { id: "portfolio", label: "Portfolio" },
];

const MAX_WIDTH = 1280;

export default function App() {
  const { wallet, wrongNetwork, lowGas } = useWallet();
  const [route, setRoute] = useState<Route>("home");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const toastId = useRef(0);

  const pushToast = useCallback((t: ToastInput) => {
    toastId.current += 1;
    const item: ToastItem = { ...t, id: toastId.current };
    setToasts((prev) => [...prev.slice(-3), item]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const openConnect = useCallback(() => setConnectOpen(true), []);
  const navigate = useCallback((r: Route) => setRoute(r), []);

  /* Identity of the current account. Screens use it as a useAsync dependency so
     data refetches on account or chain change, and never on a timer. */
  const walletKey = `${wallet.address ?? "none"}:${wallet.chainId ?? "none"}`;
  const canRead = wallet.connected && !wrongNetwork;

  async function disconnect(): Promise<void> {
    setDisconnecting(true);
    try {
      await adapter.disconnectWallet();
      pushToast({ tone: "info", title: "Wallet disconnected", body: "Ecosystem data stays visible." });
      setRoute("home");
    } catch (e) {
      const p = presentError(e);
      pushToast({ tone: p.tone, title: p.title, body: p.body, txHash: p.txHash, offerTxLink: p.offerTxLink });
    } finally {
      setDisconnecting(false);
    }
  }

  const screenProps = {
    wallet,
    walletKey,
    canRead,
    pushToast,
    onNavigate: navigate,
    onConnect: openConnect,
  } as const;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.tPri, fontFamily: T.font }}>
      {/* ---------------- header ---------------- */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: T.bg,
          borderBottom: `1px solid ${T.bSubtle}`,
        }}
      >
        <div
          style={{
            maxWidth: MAX_WIDTH,
            margin: "0 auto",
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: "auto" }}>
            <img
              src={HCOW_MARK}
              alt=""
              aria-hidden="true"
              width={28}
              height={28}
              style={{ display: "block", width: 28, height: 28 }}
            />
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>HashCow</span>
          </div>

          <nav aria-label="Primary">
            <div role="tablist" aria-label="Primary" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {NAV.map((n) => {
                const selected = n.id === route;
                return (
                  <button
                    key={n.id}
                    id={`tab-${n.id}`}
                    role="tab"
                    type="button"
                    aria-selected={selected}
                    aria-controls="screen-panel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setRoute(n.id)}
                    style={{
                      height: 34,
                      padding: "0 14px",
                      borderRadius: T.r,
                      border: `1px solid ${selected ? T.bDefault : "transparent"}`,
                      background: selected ? T.s2 : "transparent",
                      color: selected ? T.tPri : T.tSec,
                      fontSize: 13,
                      fontWeight: selected ? 600 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {n.label}
                  </button>
                );
              })}
            </div>
          </nav>

          {wallet.connected && wallet.address ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  height: 34,
                  padding: "0 12px",
                  borderRadius: T.r,
                  border: `1px solid ${T.bDefault}`,
                  background: T.s1,
                  ...MONO,
                  fontSize: 12,
                }}
              >
                <span aria-hidden="true">⛽</span>
                <span title={`${PROTOCOL.GAS_TOKEN} balance`}>
                  {fmtAmount(wallet.balances.bnb, 3)} {PROTOCOL.GAS_TOKEN}
                </span>
                <span aria-hidden="true" style={{ color: T.bStrong }}>
                  |
                </span>
                <span>{shortHash(wallet.address, 6, 4)}</span>
              </span>
              <Button size="sm" variant="ghost" disabled={disconnecting} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="primary" onClick={openConnect}>
              Connect wallet
            </Button>
          )}
        </div>
      </header>

      {/* ---------------- global banners ---------------- */}
      {wrongNetwork || lowGas ? (
        <div style={{ maxWidth: MAX_WIDTH, margin: "0 auto", padding: "16px 24px 0", display: "grid", gap: 10 }}>
          {wrongNetwork ? <WrongNetworkBanner /> : null}
          {lowGas ? <LowGasBanner bnb={wallet.balances.bnb} /> : null}
        </div>
      ) : null}

      {/* ---------------- screen ---------------- */}
      <main
        id="screen-panel"
        role="tabpanel"
        aria-labelledby={`tab-${route}`}
        tabIndex={0}
        style={{ maxWidth: MAX_WIDTH, margin: "0 auto", padding: "28px 24px 96px" }}
      >
        {route === "home" ? <HomeScreen {...screenProps} /> : null}
        {route === "profit" ? <ProfitShareScreen {...screenProps} /> : null}
        {route === "staking" ? <NetworkStakingScreen {...screenProps} /> : null}
        {route === "portfolio" ? <PortfolioScreen {...screenProps} /> : null}
      </main>

      {/* ---------------- footer ---------------- */}
      <footer style={{ borderTop: `1px solid ${T.bSubtle}` }}>
        <div
          style={{
            maxWidth: MAX_WIDTH,
            margin: "0 auto",
            padding: "24px",
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            justifyContent: "space-between",
            fontSize: 12,
            color: T.tSec,
          }}
        >
          <span>
            HashCow · {PROTOCOL.CHAIN_NAME} · Epoch length {PROTOCOL.EPOCH_DAYS} days
          </span>
          <span style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <a href={EXTERNAL_LINKS.HOMEPAGE} target="_blank" rel="noreferrer noopener" style={{ color: T.tSec, textDecoration: "none" }}>
              Homepage
            </a>
            <a href={EXTERNAL_LINKS.DOCS} target="_blank" rel="noreferrer noopener" style={{ color: T.tSec, textDecoration: "none" }}>
              Docs
            </a>
            <a href={EXTERNAL_LINKS.X} target="_blank" rel="noreferrer noopener" style={{ color: T.tSec, textDecoration: "none" }}>
              X
            </a>
            <a href={EXTERNAL_LINKS.TERMS} target="_blank" rel="noreferrer noopener" style={{ color: T.tSec, textDecoration: "none" }}>
              Terms
            </a>
            <a href={EXTERNAL_LINKS.PRIVACY} target="_blank" rel="noreferrer noopener" style={{ color: T.tSec, textDecoration: "none" }}>
              Privacy
            </a>
          </span>
        </div>
      </footer>

      <WalletConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} pushToast={pushToast} />
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
