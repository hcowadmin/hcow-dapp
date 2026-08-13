/**
 * HCOW dApp — Error presentation
 *
 * One row per AdapterErrorCode. This is the twelve-row matrix from the
 * Data & Integration Spec, implemented. If the chain adapter miscategorises
 * an error the user gets the wrong guidance, so classification accuracy on
 * the adapter side is a UX requirement, not an implementation detail.
 */

import { AdapterError, type AdapterErrorCode } from "../data/adapter";

export type Tone = "info" | "warning" | "danger";

export interface ErrorPresentation {
  tone: Tone;
  title: string;
  body: string;
  /** When true the modal that triggered the action stays open. */
  keepModalOpen: boolean;
  /** Renders a "Switch network" affordance. */
  offerNetworkSwitch?: boolean;
  /** Renders a link to the tx on BscScan when a hash is available. */
  offerTxLink?: boolean;
}

const MAP: Record<AdapterErrorCode, ErrorPresentation> = {
  USER_REJECTED: {
    tone: "info",
    title: "Transaction cancelled",
    body: "You declined the signature in your wallet. Nothing was sent.",
    keepModalOpen: true,
  },
  WALLET_NOT_CONNECTED: {
    tone: "warning",
    title: "Wallet not connected",
    body: "Connect a wallet to continue.",
    keepModalOpen: false,
  },
  WRONG_NETWORK: {
    tone: "warning",
    title: "Wrong network",
    body: "This app runs on BNB Smart Chain. Switch networks and try again.",
    keepModalOpen: true,
    offerNetworkSwitch: true,
  },
  INSUFFICIENT_BNB: {
    tone: "warning",
    title: "Not enough BNB for gas",
    body: "Every transaction needs a small amount of BNB. Top up and try again.",
    keepModalOpen: true,
  },
  INSUFFICIENT_HCOW: {
    tone: "warning",
    title: "Not enough HCOW",
    body: "Your balance is lower than the amount entered.",
    keepModalOpen: true,
  },
  DEDUCTION_CAP_EXCEEDED: {
    tone: "warning",
    title: "Above the epoch deduction cap",
    body: "This action would exceed the per-epoch deduction cap. Try a smaller amount.",
    keepModalOpen: true,
  },
  UNBOND_COOLDOWN_ACTIVE: {
    tone: "warning",
    title: "Cooldown in progress",
    body: "A withdrawal request is already running. Wait for it to finish or cancel it first.",
    keepModalOpen: false,
  },
  INVALID_REPRESENTATIVE: {
    tone: "warning",
    title: "Node unavailable",
    body: "This node is not accepting delegations right now. Choose another one.",
    keepModalOpen: true,
  },
  TX_REVERTED: {
    tone: "danger",
    title: "Transaction failed",
    body: "The network rejected this transaction. Nothing was charged beyond gas.",
    keepModalOpen: false,
  },
  TX_TIMEOUT: {
    tone: "warning",
    title: "Still pending",
    body: "This is taking longer than usual. It may still confirm. Check BscScan in a few minutes.",
    keepModalOpen: false,
    offerTxLink: true,
  },
  RPC_ERROR: {
    tone: "danger",
    title: "Network problem",
    body: "Could not reach the blockchain. Check your connection and try again.",
    keepModalOpen: true,
  },
  UNKNOWN_ERROR: {
    tone: "danger",
    title: "Something went wrong",
    body: "The action did not complete. Try again in a moment.",
    keepModalOpen: false,
  },
};

export function presentError(e: unknown): ErrorPresentation & { txHash?: string } {
  if (e instanceof AdapterError) {
    return { ...MAP[e.code], txHash: e.txHash };
  }
  return MAP.UNKNOWN_ERROR;
}
