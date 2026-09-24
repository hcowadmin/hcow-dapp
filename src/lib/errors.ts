/**
 * HCOW dApp — Error presentation
 *
 * One row per AdapterErrorCode. This is the twelve-row matrix from the
 * Data & Integration Spec, implemented. If the chain adapter miscategorises
 * an error the user gets the wrong guidance, so classification accuracy on
 * the adapter side is a UX requirement, not an implementation detail.
 */

import { AdapterError, type AdapterErrorCode } from "../data/adapter";
import { PROTOCOL } from "../config/constants";

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
  ACCOUNT_CHANGED: {
    tone: "warning",
    title: "Wallet account changed",
    body: "Your wallet switched to another account before this was sent. Nothing was sent. Check the details for the new account and try again.",
    keepModalOpen: false,
  },
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
    // Chain and gas token from the deployment, like the banners. These two
    // said "BNB Smart Chain" and "BNB" on a testnet build while the banner above
    // named the testnet (audit 6, L-4).
    body: `This app runs on ${PROTOCOL.CHAIN_NAME}. Switch networks and try again.`,
    keepModalOpen: true,
    offerNetworkSwitch: true,
  },
  INSUFFICIENT_BNB: {
    tone: "warning",
    title: `Not enough ${PROTOCOL.GAS_TOKEN} for gas`,
    body: `Every transaction needs a small amount of ${PROTOCOL.GAS_TOKEN}. Top up and try again.`,
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

/** Codes whose own adapter sentence replaces the generic body when there is one. */
const DETAIL_REPLACES: ReadonlySet<AdapterErrorCode> = new Set<AdapterErrorCode>([
  "INVALID_REPRESENTATIVE",
  "UNBOND_COOLDOWN_ACTIVE",
  // The generic "Try again in a moment" contradicts a detail that says the
  // action is disabled (review F6).
  "UNKNOWN_ERROR",
]);

/**
 * Codes that, without a transaction hash, mean the step was refused before
 * anything was broadcast: declined in the wallet, refused by a check here, or
 * reverted when the node estimated gas. A network error or an unknown error
 * without a hash is not in this list: the transaction may have gone out and
 * only the answer been lost.
 */
const REFUSED_BEFORE_SENDING: ReadonlySet<AdapterErrorCode> = new Set<AdapterErrorCode>([
  "USER_REJECTED",
  "TX_REVERTED",
  "INSUFFICIENT_BNB",
  "INSUFFICIENT_HCOW",
  "INVALID_REPRESENTATIVE",
  "ACCOUNT_CHANGED",
]);

/**
 * After a confirmed approval, whether the step after it is known NOT to have
 * gone through. Only then is "your next attempt reuses the approval" true. A
 * timeout, or a network error, leaves the bond or stake possibly on its way,
 * and a retry could send it twice (review F3). Decided by whether the step was
 * broadcast, not by the code alone (re-review R2): a revert that was mined
 * also left the allowance unused.
 */
function stepDidNotHappen(e: AdapterError): boolean {
  if (e.txHash) return e.code === "TX_REVERTED";
  return REFUSED_BEFORE_SENDING.has(e.code);
}

export function presentError(e: unknown): ErrorPresentation & { txHash?: string } {
  if (!(e instanceof AdapterError)) return MAP.UNKNOWN_ERROR;
  const base = MAP[e.code];

  // The adapter's specific reason, when it has one (audit 6, L-14). It used to
  // be thrown away here, so "Already delegated. Redelegate instead of staking
  // again." reached the user as "This node is not accepting delegations".
  let body = base.body;
  if (e.code === "TX_REVERTED" && !e.txHash) {
    // Refused before sending: by a check here, or by the node when estimating
    // gas. Nothing was sent, so nothing was charged, not even gas (review F7).
    // After a confirmed approval, "nothing" would be false: only this step
    // was not sent (re-review R1).
    body = `${e.detail ?? "The network would reject this transaction."} ${e.approvalHash ? "This step was not sent." : "Nothing was sent."}`;
  } else if (e.detail) {
    body = DETAIL_REPLACES.has(e.code) ? e.detail : `${e.detail} ${base.body}`;
  }

  // The approval before this step was confirmed (audit 6, H-4). "Nothing was
  // sent" is false and the user should know an allowance is still in place.
  if (e.approvalHash) {
    if (stepDidNotHappen(e)) {
      const approvalNote =
        "The approval before it was already confirmed, so the contract may still draw up to this amount from your wallet. Your next attempt reuses that approval instead of asking again.";
      body =
        e.code === "USER_REJECTED"
          ? `You declined the second signature, so nothing was bonded or staked. ${approvalNote}`
          : `${body} ${approvalNote}`;
      // Link to the step if it was mined, else to the approval that is on chain.
      return { ...base, body, txHash: e.txHash ?? e.approvalHash, offerTxLink: true };
    }
    if (e.txHash) {
      body = `${body} The approval before it was confirmed. Check this transaction on BscScan before trying again: if it confirms, trying again would send it a second time.`;
      return { ...base, body, txHash: e.txHash, offerTxLink: true };
    }
    // No hash for the step: the link would show the approval, which says
    // nothing about whether the bond or stake went out (re-review R2).
    body = `${body} The approval before it was confirmed. Check your wallet's activity before trying again: if the bond or stake was sent and confirms, trying again would send it a second time.`;
    return { ...base, body, txHash: undefined, offerTxLink: false };
  }

  return { ...base, body, txHash: e.txHash };
}
