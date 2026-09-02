/**
 * HCOW dApp — Mock Adapter
 *
 * This is the EXECUTABLE SPECIFICATION of IHcowAdapter.
 * When the chain adapter is written, its observable behaviour must match this
 * one: same error codes, same null handling, same pending-then-confirmed
 * lifecycle, same guards. Where this file and prose disagree, this file wins.
 *
 * Deliberate behaviours worth copying:
 *   - every write validates preconditions and throws a typed AdapterError
 *   - writes go pending first, then confirm. Nothing resolves instantly.
 *   - subscribeWallet fires once immediately, then on every change
 *   - readyAt timestamps are authoritative, never recomputed by the UI
 *   - deduction does not run in an epoch with no distributable profit
 */

import {
  AdapterError,
  type Address,
  type Amount,
  type BondedPosition,
  type BurnStats,
  type CostLine,
  type Epoch,
  type EpochDistribution,
  type Hex,
  type IHcowAdapter,
  type PoolStats,
  type Representative,
  type RevenueLine,
  type StakedPosition,
  type Transaction,
  type TxFilter,
  type TxResult,
  type TxType,
  type WalletProvider,
  type WalletState,
} from "./adapter";
import { FOUNDATION_NODES, PROTOCOL } from "../config/constants";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const ZERO_BALANCES = { hcow: 0, bnb: 0, usdt: 0 };
const DISCONNECTED: WalletState = {
  connected: false,
  address: null,
  chainId: null,
  balances: ZERO_BALANCES,
};

function hex(len: number, seed: number): Hex {
  let out = "";
  let x = seed >>> 0;
  for (let i = 0; i < len; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out += "0123456789abcdef"[x % 16];
  }
  return `0x${out}`;
}

let nonce = 7;
const nextHash = (): Hex => hex(64, ++nonce * 2654435761);
const MOCK_ADDRESS: Address = hex(40, 991);

interface Store {
  wallet: WalletState;
  epoch: Epoch;
  pool: PoolStats;
  burn: BurnStats;
  bonded: BondedPosition;
  staked: StakedPosition;
  reps: Representative[];
  history: Transaction[];
  lastDistribution: EpochDistribution | null;
  blockNumber: number;
}

const now = Date.now();
const epochEnds = now + 3 * 24 * 60 * 60 * 1000;

const revenue30d: RevenueLine[] = [
  { origin: "table_game_fees", cls: "offchain_settled", grossUsdt: 18420.5, chainVerifiable: false,
    attestationUrl: "https://hash-cow.io/attestations/2026-07-table-games", depositTxHash: hex(64, 31) },
  { origin: "in_game_hcow", cls: "onchain_native", grossUsdt: 9240.0, chainVerifiable: true,
    attestationUrl: null, depositTxHash: null },
  { origin: "apple_app_store", cls: "offchain_settled", grossUsdt: 6110.25, chainVerifiable: false,
    attestationUrl: "https://hash-cow.io/attestations/2026-06-apple", depositTxHash: hex(64, 32) },
  { origin: "google_play", cls: "offchain_settled", grossUsdt: 4380.75, chainVerifiable: false,
    attestationUrl: "https://hash-cow.io/attestations/2026-06-google", depositTxHash: hex(64, 33) },
  { origin: "ad_network", cls: "offchain_settled", grossUsdt: 1210.0, chainVerifiable: false,
    attestationUrl: "https://hash-cow.io/attestations/2026-06-ads", depositTxHash: hex(64, 34) },
];

const gross30d = revenue30d.reduce((a, r) => a + r.grossUsdt, 0);
const verifiable30d = revenue30d.filter((r) => r.chainVerifiable).reduce((a, r) => a + r.grossUsdt, 0);

const lastCosts: CostLine[] = [
  { category: "platform_fee", amountUsdt: 2340.2, isDirect: true, note: "Apple 15%, Google 15%" },
  { category: "payment_processing", amountUsdt: 186.4, isDirect: true, note: null },
  { category: "fx_and_conversion", amountUsdt: 94.1, isDirect: true, note: "KRW to USDT, incl. slippage" },
  { category: "transaction_tax", amountUsdt: 512.0, isDirect: true, note: "VAT on store revenue" },
  { category: "infrastructure", amountUsdt: 1180.0, isDirect: false, note: "servers, RPC, storage" },
  { category: "personnel", amountUsdt: 1420.0, isDirect: false, note: null },
  { category: "marketing", amountUsdt: 610.0, isDirect: false, note: null },
  { category: "support_and_ops", amountUsdt: 240.0, isDirect: false, note: null },
];

function buildDistribution(epoch: number, settledAt: number): EpochDistribution {
  const revenue = revenue30d.map((r) => ({ ...r, grossUsdt: r.grossUsdt / 4 }));
  const grossReceivedUsdt = revenue.reduce((a, r) => a + r.grossUsdt, 0);
  const costs = lastCosts.map((c) => ({ ...c, amountUsdt: c.amountUsdt / 4 }));
  const directCostsUsdt = costs.filter((c) => c.isDirect).reduce((a, c) => a + c.amountUsdt, 0);
  const netRevenueUsdt = grossReceivedUsdt - directCostsUsdt;

  const opexIncurred = costs.filter((c) => !c.isDirect).reduce((a, c) => a + c.amountUsdt, 0);
  const cap = (netRevenueUsdt * PROTOCOL.OPEX_CAP_PCT) / 100;
  const operatingCostsUsdt = Math.min(opexIncurred, cap);
  const operatingCostsAboveCapUsdt = Math.max(0, opexIncurred - cap);

  const distributableProfitUsdt = Math.max(0, netRevenueUsdt - operatingCostsUsdt);
  const d = PROTOCOL.DISTRIBUTION;

  // Rule 4: no distribution, no deduction.
  const snapshotBondedHcow = 4_280_000;
  const totalHcowDeducted = distributableProfitUsdt > 0 ? 41_820 : 0;

  return {
    epoch,
    settledAt,
    txHash: hex(64, epoch * 7919),
    revenue,
    grossReceivedUsdt,
    costs,
    directCostsUsdt,
    netRevenueUsdt,
    operatingCostsUsdt,
    operatingCostsAboveCapUsdt,
    distributableProfitUsdt,
    participantsUsdt: (distributableProfitUsdt * d.PARTICIPANTS_PCT) / 100,
    gameStudioUsdt: (distributableProfitUsdt * d.GAME_STUDIO_PCT) / 100,
    teamUsdt: (distributableProfitUsdt * d.TEAM_PCT) / 100,
    totalHcowDeducted,
    snapshotBondedHcow,
    chainVerifiableRatio: grossReceivedUsdt > 0
      ? revenue.filter((r) => r.chainVerifiable).reduce((a, r) => a + r.grossUsdt, 0) / grossReceivedUsdt
      : 0,
  };
}

const store: Store = {
  wallet: { ...DISCONNECTED },
  epoch: { current: 27, startsAt: epochEnds - PROTOCOL.EPOCH_MS, endsAt: epochEnds, snapshotInMs: 0, settling: false },
  pool: {
    totalBondedHcow: 4_280_000,
    participants: 1247,
    estimatedAprPct: null,
    grossReceivedUsdtToday: 842.15,
    grossReceivedUsdt7d: 9_812.4,
    grossReceivedUsdt30d: gross30d,
    distributedToParticipantsUsdt30d: 11_460.8,
    revenue30dByOrigin: revenue30d,
    chainVerifiableRatio30d: verifiable30d / gross30d,
    lastUpdatedAt: now - 90_000,
  },
  burn: {
    totalBurnedHcow: 1_846_200,
    burnedToday: 8_420,
    burnedThisEpoch: 52_180,
    percentOfSupply: (1_846_200 / PROTOCOL.TOKEN_TOTAL_SUPPLY) * 100,
    last30dTxFeeBurn: 108_400,
    last30dGamePaymentBurn: 214_900,
  },
  bonded: {
    status: "active",
    bondedAmount: 8_400,
    shareOfPool: 8_400 / 4_280_000,
    estimatedEpochUsdt: 16.74,
    pendingUnbondAmount: null,
    pendingUnbondReadyAt: null,
    pendingClaimUsdt: 41.2,
    lifetimeDeductedHcow: 412,
    lifetimeClaimedUsdt: 318.6,
  },
  staked: {
    status: "active",
    stakedAmount: 3_500,
    delegatedTo: "node-02",
    estimatedAprPct: null,
    pendingUnstakeAmount: null,
    pendingUnstakeReadyAt: null,
    pendingRewardHcow: 22.14,
    lifetimeRewardHcow: 184.2,
  },
  reps: FOUNDATION_NODES.map((n, i) => ({
    id: n.id,
    name: n.name,
    address: hex(40, 400 + i),
    isFoundation: true,
    commissionPct: 5,
    totalDelegatedHcow: [820_000, 910_000, 740_000, 680_000, 590_000][i] ?? 500_000,
    delegatorCount: [248, 312, 196, 174, 156][i] ?? 100,
    status: i === 4 ? "warning" : "active",
    estimatedAprPct: null,
    uptimeLast30dPct: null,
  })),
  history: [],
  lastDistribution: buildDistribution(26, now - 2 * 24 * 3600 * 1000),
  blockNumber: 42_610_902,
};

// ---- seed history ----
function seed(type: TxType, ageH: number, amount: number | null, reward: number | null): Transaction {
  return {
    hash: nextHash(),
    type,
    status: type === "epoch_settlement" ? "auto" : "confirmed",
    timestamp: now - ageH * 3600_000,
    blockNumber: store.blockNumber - Math.round(ageH * 1200),
    amount,
    rewardAmount: reward,
    meta: type === "epoch_settlement" ? { snapshotBondedHcow: 4_280_000, effectiveEpoch: 26 } : {},
  };
}
store.history = [
  seed("claim_usdt", 6, 38.9, null),
  seed("epoch_settlement", 48, 84.2, 16.1),
  seed("topup", 96, 2_000, null),
  seed("stake", 150, 3_500, null),
  seed("epoch_settlement", 216, 79.4, 15.2),
  seed("claim_hcow", 260, 12.4, null),
  seed("bond", 400, 6_400, null),
];

// ---- guards ----
function requireConnected(): Address {
  if (!store.wallet.connected || !store.wallet.address) {
    throw new AdapterError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
  }
  if (store.wallet.chainId !== PROTOCOL.CHAIN_ID) {
    throw new AdapterError("WRONG_NETWORK", `Switch to ${PROTOCOL.CHAIN_NAME}.`);
  }
  return store.wallet.address;
}

function requireGas(): void {
  if (store.wallet.balances.bnb < PROTOCOL.LOW_BNB_THRESHOLD) {
    throw new AdapterError("INSUFFICIENT_BNB", "Not enough BNB for gas.");
  }
}

function requireHcow(amount: Amount): void {
  if (amount <= 0) throw new AdapterError("TX_REVERTED", "Amount must be greater than zero.");
  if (amount > store.wallet.balances.hcow) {
    throw new AdapterError("INSUFFICIENT_HCOW", "Not enough HCOW.");
  }
}

// ---- wallet subscription ----
type WalletCb = (s: WalletState) => void;
const subscribers = new Set<WalletCb>();
function emitWallet(): void {
  const snapshot: WalletState = { ...store.wallet, balances: { ...store.wallet.balances } };
  subscribers.forEach((cb) => cb(snapshot));
}

// ---- writes ----
async function write(type: TxType, amount: Amount | null, meta: Transaction["meta"] = {}): Promise<TxResult> {
  const hash = nextHash();
  const row: Transaction = {
    hash, type, status: "pending", timestamp: Date.now(),
    blockNumber: null, amount, rewardAmount: null, meta,
  };
  store.history = [row, ...store.history];
  emitWallet();

  await sleep(900 + Math.round(Math.abs(Math.sin(nonce)) * 700));

  store.blockNumber += 3;
  row.status = "confirmed";
  row.blockNumber = store.blockNumber;
  store.history = [...store.history];
  emitWallet();

  return {
    hash,
    confirmed: true,
    blockNumber: store.blockNumber,
    failureReason: null,
    effectiveEpoch: type === "bond" || type === "topup" ? store.epoch.current + 1 : null,
  };
}

export const mockAdapter: IHcowAdapter = {
  // ---- WALLET ----
  async getWalletState() {
    return { ...store.wallet, balances: { ...store.wallet.balances } };
  },

  async connectWallet(provider: WalletProvider) {
    await sleep(600);
    if (provider === "walletconnect" && typeof window !== "undefined" && !("WalletConnect" in window)) {
      // Mock stays permissive. The chain adapter must map a real rejection to USER_REJECTED.
    }
    store.wallet = {
      connected: true,
      address: MOCK_ADDRESS,
      chainId: PROTOCOL.CHAIN_ID,
      balances: { hcow: 12_450, bnb: 0.084, usdt: 312.45 },
    };
    emitWallet();
    return { ...store.wallet, balances: { ...store.wallet.balances } };
  },

  async disconnectWallet() {
    await sleep(180);
    store.wallet = { ...DISCONNECTED };
    emitWallet();
  },

  subscribeWallet(cb) {
    subscribers.add(cb);
    cb({ ...store.wallet, balances: { ...store.wallet.balances } }); // fire immediately
    return () => { subscribers.delete(cb); };
  },

  // ---- READ ----
  async getEpoch() {
    const remaining = store.epoch.endsAt - Date.now();
    return { ...store.epoch, snapshotInMs: remaining, settling: remaining <= 0 };
  },

  async getLastEpochDistribution() {
    return store.lastDistribution ? { ...store.lastDistribution } : null;
  },

  async getEpochDistribution(epoch: number) {
    if (epoch > store.epoch.current - 1 || epoch < 1) return null;
    return buildDistribution(epoch, now - (store.epoch.current - epoch) * PROTOCOL.EPOCH_MS);
  },

  async getPoolStats() {
    return { ...store.pool, revenue30dByOrigin: store.pool.revenue30dByOrigin.map((r) => ({ ...r })) };
  },

  async getNetworkStats() {
    const active = store.reps.filter((r) => r.status === "active").length;
    return {
      activeRepresentatives: active,
      totalRepresentatives: store.reps.length,
      networkStatus: active >= 4 ? "healthy" : active >= 2 ? "degraded" : "down",
      lastBlockAt: Date.now() - 2_400,
    };
  },

  async getBurnStats() {
    return { ...store.burn };
  },

  async getBondedPosition() {
    requireConnected();
    return { ...store.bonded };
  },

  async getStakedPosition() {
    requireConnected();
    return { ...store.staked };
  },

  async getRepresentatives() {
    return store.reps.map((r) => ({ ...r }));
  },

  async getTxHistory(filter: TxFilter = "all") {
    requireConnected();
    const ps: TxType[] = ["bond", "topup", "request_unbond", "cancel_unbond", "withdraw_unbonded", "claim_usdt", "epoch_settlement"];
    const ns: TxType[] = ["stake", "redelegate", "request_unstake", "cancel_unstake", "withdraw_unstaked", "claim_hcow"];
    const cl: TxType[] = ["claim_usdt", "claim_hcow"];
    const pick =
      filter === "profit_share" ? ps :
      filter === "network_staking" ? ns :
      filter === "claim" ? cl : null;
    const rows = pick ? store.history.filter((h) => pick.includes(h.type)) : store.history;
    return rows.map((h) => ({ ...h, meta: { ...h.meta } }));
  },

  // ---- WRITE: PROFIT SHARE ----
  async bond(amount) {
    requireConnected(); requireGas(); requireHcow(amount);
    const r = await write("bond", amount);
    store.wallet.balances.hcow -= amount;
    store.bonded.bondedAmount += amount;
    store.bonded.status = "active";
    store.pool.totalBondedHcow += amount;
    store.bonded.shareOfPool = store.bonded.bondedAmount / store.pool.totalBondedHcow;
    emitWallet();
    return r;
  },

  async topUpBond(amount) {
    requireConnected(); requireGas(); requireHcow(amount);
    const r = await write("topup", amount);
    store.wallet.balances.hcow -= amount;
    store.bonded.bondedAmount += amount;
    store.pool.totalBondedHcow += amount;
    store.bonded.shareOfPool = store.bonded.bondedAmount / store.pool.totalBondedHcow;
    emitWallet();
    return r;
  },

  async requestUnbond(amount) {
    requireConnected(); requireGas();
    if (store.bonded.pendingUnbondAmount !== null) {
      throw new AdapterError("UNBOND_COOLDOWN_ACTIVE", "An unbond request is already in progress.");
    }
    if (amount <= 0 || amount > store.bonded.bondedAmount) {
      throw new AdapterError("TX_REVERTED", "Amount exceeds bonded balance.");
    }
    const r = await write("request_unbond", amount);
    store.bonded.bondedAmount -= amount;
    store.bonded.pendingUnbondAmount = amount;
    store.bonded.pendingUnbondReadyAt = Date.now() + PROTOCOL.UNBOND_COOLDOWN_MS;
    store.bonded.status = "cooldown";
    store.pool.totalBondedHcow -= amount;
    store.bonded.shareOfPool = store.pool.totalBondedHcow > 0 ? store.bonded.bondedAmount / store.pool.totalBondedHcow : 0;
    emitWallet();
    return r;
  },

  async cancelUnbond() {
    requireConnected(); requireGas();
    const amt = store.bonded.pendingUnbondAmount;
    if (amt === null) throw new AdapterError("TX_REVERTED", "No unbond request to cancel.");
    const r = await write("cancel_unbond", amt);
    store.bonded.bondedAmount += amt;
    store.pool.totalBondedHcow += amt;
    store.bonded.pendingUnbondAmount = null;
    store.bonded.pendingUnbondReadyAt = null;
    store.bonded.status = "active";
    store.bonded.shareOfPool = store.bonded.bondedAmount / store.pool.totalBondedHcow;
    emitWallet();
    return r;
  },

  async withdrawUnbonded() {
    requireConnected(); requireGas();
    const amt = store.bonded.pendingUnbondAmount;
    const readyAt = store.bonded.pendingUnbondReadyAt;
    if (amt === null || readyAt === null) throw new AdapterError("TX_REVERTED", "Nothing to withdraw.");
    if (Date.now() < readyAt) throw new AdapterError("UNBOND_COOLDOWN_ACTIVE", "Cooldown has not finished.");
    const r = await write("withdraw_unbonded", amt);
    store.wallet.balances.hcow += amt;
    store.bonded.pendingUnbondAmount = null;
    store.bonded.pendingUnbondReadyAt = null;
    store.bonded.status = store.bonded.bondedAmount > 0 ? "active" : "first_time";
    emitWallet();
    return r;
  },

  async claimUsdt() {
    requireConnected(); requireGas();
    const amt = store.bonded.pendingClaimUsdt;
    if (amt <= 0) throw new AdapterError("TX_REVERTED", "Nothing to claim.");
    const r = await write("claim_usdt", amt);
    store.wallet.balances.usdt += amt;
    store.bonded.lifetimeClaimedUsdt += amt;
    store.bonded.pendingClaimUsdt = 0;
    emitWallet();
    return r;
  },

  // ---- WRITE: NETWORK STAKING ----
  async stake(amount, representativeId) {
    requireConnected(); requireGas(); requireHcow(amount);
    const rep = store.reps.find((x) => x.id === representativeId);
    if (!rep || rep.status === "inactive") {
      throw new AdapterError("INVALID_REPRESENTATIVE", "That node is not accepting delegations.");
    }
    const r = await write("stake", amount, { toRepresentative: rep.name });
    store.wallet.balances.hcow -= amount;
    store.staked.stakedAmount += amount;
    store.staked.delegatedTo = rep.id;
    store.staked.status = "active";
    rep.totalDelegatedHcow += amount;
    rep.delegatorCount += 1;
    emitWallet();
    return r;
  },

  async redelegate(toRepresentativeId) {
    requireConnected(); requireGas();
    const to = store.reps.find((x) => x.id === toRepresentativeId);
    const from = store.reps.find((x) => x.id === store.staked.delegatedTo);
    if (!to || to.status === "inactive") {
      throw new AdapterError("INVALID_REPRESENTATIVE", "That node is not accepting delegations.");
    }
    if (!from || to.id === from.id) throw new AdapterError("TX_REVERTED", "Already delegated to that node.");
    const r = await write("redelegate", store.staked.stakedAmount, {
      fromRepresentative: from.name, toRepresentative: to.name,
    });
    from.totalDelegatedHcow -= store.staked.stakedAmount;
    from.delegatorCount -= 1;
    to.totalDelegatedHcow += store.staked.stakedAmount;
    to.delegatorCount += 1;
    store.staked.delegatedTo = to.id;
    emitWallet();
    return r;
  },

  async requestUnstake(amount) {
    requireConnected(); requireGas();
    if (store.staked.pendingUnstakeAmount !== null) {
      throw new AdapterError("UNBOND_COOLDOWN_ACTIVE", "An unstake request is already in progress.");
    }
    if (amount <= 0 || amount > store.staked.stakedAmount) {
      throw new AdapterError("TX_REVERTED", "Amount exceeds staked balance.");
    }
    const r = await write("request_unstake", amount);
    store.staked.stakedAmount -= amount;
    store.staked.pendingUnstakeAmount = amount;
    store.staked.pendingUnstakeReadyAt = Date.now() + PROTOCOL.UNSTAKE_COOLDOWN_MS;
    store.staked.status = "cooldown";
    const rep = store.reps.find((x) => x.id === store.staked.delegatedTo);
    if (rep) rep.totalDelegatedHcow -= amount;
    emitWallet();
    return r;
  },

  async cancelUnstake() {
    requireConnected(); requireGas();
    const amt = store.staked.pendingUnstakeAmount;
    if (amt === null) throw new AdapterError("TX_REVERTED", "No unstake request to cancel.");
    const r = await write("cancel_unstake", amt);
    store.staked.stakedAmount += amt;
    store.staked.pendingUnstakeAmount = null;
    store.staked.pendingUnstakeReadyAt = null;
    store.staked.status = "active";
    const rep = store.reps.find((x) => x.id === store.staked.delegatedTo);
    if (rep) rep.totalDelegatedHcow += amt;
    emitWallet();
    return r;
  },

  async withdrawUnstaked() {
    requireConnected(); requireGas();
    const amt = store.staked.pendingUnstakeAmount;
    const readyAt = store.staked.pendingUnstakeReadyAt;
    if (amt === null || readyAt === null) throw new AdapterError("TX_REVERTED", "Nothing to withdraw.");
    if (Date.now() < readyAt) throw new AdapterError("UNBOND_COOLDOWN_ACTIVE", "Cooldown has not finished.");
    const r = await write("withdraw_unstaked", amt);
    store.wallet.balances.hcow += amt;
    store.staked.pendingUnstakeAmount = null;
    store.staked.pendingUnstakeReadyAt = null;
    store.staked.status = store.staked.stakedAmount > 0 ? "active" : "first_time";
    if (store.staked.stakedAmount === 0) store.staked.delegatedTo = null;
    emitWallet();
    return r;
  },

  async claimHcow() {
    requireConnected(); requireGas();
    const amt = store.staked.pendingRewardHcow;
    if (amt <= 0) throw new AdapterError("TX_REVERTED", "Nothing to claim.");
    const r = await write("claim_hcow", amt);
    store.wallet.balances.hcow += amt;
    store.staked.lifetimeRewardHcow += amt;
    store.staked.pendingRewardHcow = 0;
    emitWallet();
    return r;
  },
};

/** Test hook. Lets QA force the wallet into states the UI must handle. */
export const mockControls = {
  setChainId(id: number) { store.wallet.chainId = id; emitWallet(); },
  setBnb(v: number) { store.wallet.balances.bnb = v; emitWallet(); },
  switchAccount() { store.wallet.address = hex(40, Date.now() % 100000); emitWallet(); },
  expireCooldowns() {
    if (store.bonded.pendingUnbondReadyAt) store.bonded.pendingUnbondReadyAt = Date.now() - 1000;
    if (store.staked.pendingUnstakeReadyAt) store.staked.pendingUnstakeReadyAt = Date.now() - 1000;
    emitWallet();
  },
};
