/**
 * HCOW dApp — Protocol Constants
 *
 * SINGLE SOURCE OF TRUTH for every numeric and temporal constant.
 * Nothing in this codebase may hardcode any of these values.
 * A change here must be mirrored back into the master document.
 *
 * CHAIN IDENTITY IS NOT DEFINED HERE. Chain id, chain name and explorer base
 * come from src/config/deployment.ts and are re-exported below so the UI keeps
 * importing them from one place. Two files disagreeing about which chain the
 * app is on is exactly how a wrong-network banner ends up lying to a user.
 */

import { DEPLOYMENT } from "./deployment";

export const PROTOCOL = {
  // ---- Epoch ----
  EPOCH_DAYS: 7,
  EPOCH_MS: 7 * 24 * 60 * 60 * 1000,

  // ---- Profit Share (Bonded Deposit) ----
  /** Max share of bonded balance deductible in one epoch. */
  DEDUCTION_CAP_PCT: 10,
  UNBOND_COOLDOWN_DAYS: 7,
  UNBOND_COOLDOWN_MS: 7 * 24 * 60 * 60 * 1000,

  // ---- Network Staking (DPoS) ----
  UNSTAKE_COOLDOWN_DAYS: 7,
  UNSTAKE_COOLDOWN_MS: 7 * 24 * 60 * 60 * 1000,
  /** Contract-level ceiling on representative commission. */
  COMMISSION_CAP_PCT: 10,

  // ---- Distribution of distributable profit ----
  DISTRIBUTION: {
    PARTICIPANTS_PCT: 50,
    GAME_STUDIO_PCT: 25,
    FOUNDATION_PCT: 25,
  },

  /** Deductible operating cost ceiling, as a share of net revenue. */
  OPEX_CAP_PCT: 40,

  // ---- Burn (supply level, never a user balance) ----
  BURN: {
    TX_FEE_PCT: 20,
    NATIVE_GAME_PCT: 50,
  },

  // ---- Token ----
  TOKEN_TOTAL_SUPPLY: 200_000_000,
  REWARD_CURRENCY: "USDT",
  // tBNB on testnet, BNB on mainnet. Follows deployment.ts so the balance
  // label cannot claim a token the user is not actually holding.
  GAS_TOKEN: DEPLOYMENT.nativeSymbol,

  // ---- Chain ---- (see deployment.ts)
  CHAIN_ID: DEPLOYMENT.chainId,
  CHAIN_NAME: DEPLOYMENT.chainName,
  BSCSCAN_BASE: DEPLOYMENT.explorerBase,

  // ---- UX ----
  LOW_BNB_THRESHOLD: 0.005,
  /** Write calls stop waiting after this and switch to background watch. */
  TX_TIMEOUT_MS: 60_000,
  /** Pool share below this renders as "< 0.01%". */
  MIN_DISPLAY_SHARE_RATIO: 0.0001,
  TOAST_MS: 4500,
} as const;

/**
 * UNCONFIRMED. Both values are open questions for the HashCow side.
 * While null the UI does not enforce a minimum and shows no minimum copy.
 */
export const LIMITS: {
  MIN_STAKE_HCOW: number | null;
  MIN_BOND_HCOW: number | null;
} = {
  MIN_STAKE_HCOW: null,
  MIN_BOND_HCOW: null,
};

/** Placeholder names. Operations team to confirm before TGE. */
export const FOUNDATION_NODES = [
  { id: "node-01", name: "HCOW-Node-01" },
  { id: "node-02", name: "HCOW-Node-02" },
  { id: "node-03", name: "HCOW-Node-03" },
  { id: "node-04", name: "HCOW-Node-04" },
  { id: "node-05", name: "HCOW-Node-05" },
] as const;

export const EXTERNAL_LINKS = {
  HOMEPAGE: "https://hash-cow.io/",
  DOCS: "https://hashcow.gitbook.io/hashcow-docs-2",
  X: "https://x.com/HCOW_Official",
  /** TODO ops: publish before TGE. Wallet connect is blocked until these exist. */
  TERMS: "https://hash-cow.io/terms",
  PRIVACY: "https://hash-cow.io/privacy",
  LEARN_BONDED_DEPOSIT: "https://hashcow.gitbook.io/hashcow-docs-2",
  METAMASK_INSTALL: "https://metamask.io/download/",
} as const;

export const txUrl = (hash: string) => `${PROTOCOL.BSCSCAN_BASE}/tx/${hash}`;
export const addressUrl = (addr: string) => `${PROTOCOL.BSCSCAN_BASE}/address/${addr}`;
