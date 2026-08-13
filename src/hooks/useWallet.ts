import { useEffect, useState } from "react";
import { adapter, type WalletState } from "../data";
import { PROTOCOL } from "../config/constants";

const INITIAL: WalletState = {
  connected: false,
  address: null,
  chainId: null,
  balances: { hcow: 0, bnb: 0, usdt: 0 },
};

/**
 * Event-based wallet state. No polling.
 * subscribeWallet fires once immediately, so there is no separate initial fetch.
 */
export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>(INITIAL);

  useEffect(() => adapter.subscribeWallet(setWallet), []);

  const wrongNetwork = wallet.connected && wallet.chainId !== PROTOCOL.CHAIN_ID;
  const lowGas = wallet.connected && wallet.balances.bnb < PROTOCOL.LOW_BNB_THRESHOLD;

  return { wallet, wrongNetwork, lowGas };
}
