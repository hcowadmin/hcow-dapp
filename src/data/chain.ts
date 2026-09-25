/**
 * HCOW dApp — Chain Adapter
 *
 * Implements IHcowAdapter against the deployed BSC contracts:
 *   HCOWProfitShare   bonded deposit, epoch settlement, USDT distribution
 *   HCOWStaking       delegated staking, representatives, commission
 *   HCOWLedger        integrity anchor (not used by this adapter yet)
 *
 * Addresses and chain come from src/config/deployment.ts. Nothing here is
 * hardcoded to a network, so the same build points at testnet or mainnet
 * through Vite env vars.
 *
 * =============================================================================
 * WHAT IS NOT IMPLEMENTED, AND WHY. Read this before trusting a number.
 * =============================================================================
 * Everything marked [C] in the original stub file is implemented and reads or
 * writes real chain state. The methods marked [I] (event indexer) and [B]
 * (backend) have no backend behind them yet. Rather than invent plausible
 * numbers, this adapter returns null for those wherever the interface allows
 * it (adapter v0.4.2), and
 * every such field is listed in CHAIN_ADAPTER_GAPS below so the UI, and
 * anyone reading a screenshot, can tell a real zero from a missing one.
 * The burn figures and the rolling windows are read from the contracts
 * (adapter v0.4.6): the burn address's balance, and the settlement records.
 *
 * The remaining gaps are genuinely off-chain and need the indexer:
 *   revenue and cost line items, transaction history, every APR figure, and
 *   the settlement tx hash.
 * =============================================================================
 */

import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  decodeBytes32String,
  encodeBytes32String,
  formatUnits,
  parseUnits,
  type Eip1193Provider,
  type Signer,
  type TransactionResponse,
} from "ethers";

import {
  AdapterError,
  type AdapterErrorCode,
  type Address,
  type Amount,
  type BondedPosition,
  type BondedStatus,
  type BurnStats,
  type Epoch,
  type EpochDistribution,
  type FaucetStatus,
  type Hex,
  type IHcowAdapter,
  type NetworkStats,
  type PolicyStatus,
  type PoolStats,
  type Representative,
  type StakedPosition,
  type StakedStatus,
  type Transaction,
  type TxFilter,
  type TxResult,
  type TxType,
  type WalletBalances,
  type WalletProvider,
  type WalletState,
} from "./adapter";

import { ERC20_ABI, FAUCET_ABI, LEDGER_ABI, PROFIT_SHARE_ABI, STAKING_ABI } from "./abi";
import {
  eventsForAccount,
  indexerConfigured,
  settlementForEpoch,
  type ChainEventRow,
} from "./indexer";
import { DEPLOYMENT } from "../config/deployment";
import { PROTOCOL } from "../config/constants";

/**
 * Fields this adapter cannot populate from chain state alone. Exported so a
 * banner or a debug panel can render it. Keeping the list in code rather than
 * in a document is deliberate: a stale document lies, a stale export fails to
 * compile when the field is removed.
 */
export const CHAIN_ADAPTER_GAPS = {
  needsContractRevision: [],
  /**
   * Still missing even with the index running. These are off-chain business
   * records, not events: no contract emits which share of revenue came from
   * the App Store, so no indexer can recover it.
   */
  needsIndexer: [
    "EpochDistribution.revenue[]",
    "EpochDistribution.costs[]",
    "EpochDistribution.chainVerifiableRatio",
    "PoolStats.revenue30dByOrigin",
    "PoolStats.chainVerifiableRatio30d",
    "Transaction.epoch_settlement rows (needs per-account share replay)",
  ],
  needsBackend: [
    "BondedPosition.estimatedEpochUsdt",
    "PoolStats.estimatedAprPct",
    "Representative.estimatedAprPct",
    "Representative.uptimeLast30dPct",
    "NetworkStats.networkStatus beyond a simple active-count check",
  ],
} as const;

// ============================================================
// PRIMITIVES
// ============================================================

const DECIMALS = 18;
const ZERO_BALANCES: WalletBalances = { hcow: 0, bnb: 0, usdt: 0 };
const ZERO_BYTES32 = "0x" + "0".repeat(64);

/** wei -> human number. Only this file may do this conversion. Rule D. */
const toAmount = (v: bigint): Amount => Number(formatUnits(v, DECIMALS));

/** human number -> wei. Uses a string to avoid float artefacts at 18 dp. */
const toWei = (v: Amount): bigint => parseUnits(trimForWei(v), DECIMALS);

/**
 * A JS number cannot express more than about 15 significant digits, so
 * parseUnits on its default toString can throw for values like 1e21. Clamp the
 * decimal tail to 18 places and drop exponent notation before converting.
 */
function trimForWei(v: Amount): string {
  if (!Number.isFinite(v) || v < 0) throw new AdapterError("UNKNOWN_ERROR", `invalid amount: ${v}`);
  if (v === 0) return "0";
  const s = v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: DECIMALS });
  return s;
}

const secToMs = (s: bigint | number): number => Number(s) * 1000;

// ============================================================
// PROVIDERS AND CONTRACTS
// ============================================================

interface InjectedProvider extends Eip1193Provider {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
}

const injected = (): InjectedProvider | null => {
  const w = globalThis as unknown as { ethereum?: InjectedProvider };
  return w.ethereum ?? null;
};

/** Read path. Never depends on a wallet being present. */
const readProvider = new JsonRpcProvider(DEPLOYMENT.rpcUrl, DEPLOYMENT.chainId, {
  staticNetwork: true,
});

const reader = {
  hcow: new Contract(DEPLOYMENT.addresses.hcow, ERC20_ABI, readProvider),
  usdt: new Contract(DEPLOYMENT.addresses.usdt, ERC20_ABI, readProvider),
  profitShare: new Contract(DEPLOYMENT.addresses.profitShare, PROFIT_SHARE_ABI, readProvider),
  staking: new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, readProvider),
  ledger: new Contract(DEPLOYMENT.addresses.ledger, LEDGER_ABI, readProvider),
};

/** Null on any deployment without a faucet configured, which includes mainnet. */
const faucetReader = DEPLOYMENT.addresses.faucet
  ? new Contract(DEPLOYMENT.addresses.faucet, FAUCET_ABI, readProvider)
  : null;

// ============================================================
// WALLET SESSION
// ============================================================

interface Session {
  address: Address | null;
  chainId: number | null;
  balances: WalletBalances;
}

const session: Session = { address: null, chainId: null, balances: { ...ZERO_BALANCES } };
const subscribers = new Set<(s: WalletState) => void>();

const snapshot = (): WalletState => ({
  connected: session.address !== null,
  address: session.address,
  // The interface requires null when not connected (audit 6, M-7). The chain
  // id is still tracked underneath so a reconnect does not have to re-read it.
  chainId: session.address !== null ? session.chainId : null,
  balances: session.address ? { ...session.balances } : { ...ZERO_BALANCES },
});

/**
 * The account the UI was last shown. requireSigner refuses to sign for any
 * other account (audit 6, H-1 residual): adoptAccounts sets session.address
 * before publish(), and a write in that gap would be signed by an account
 * whose screen state (first-bond acknowledgement included) was never shown.
 */
let shownAddress: Address | null = null;

const publish = () => {
  const s = snapshot();
  shownAddress = s.address;
  for (const cb of subscribers) {
    try {
      cb(s);
    } catch {
      // A broken subscriber must not take down the wallet event loop.
    }
  }
};

async function refreshBalances(): Promise<void> {
  if (!session.address) {
    session.balances = { ...ZERO_BALANCES };
    return;
  }
  const addr = session.address;
  const [hcow, usdt, bnb] = await Promise.all([
    reader.hcow.balanceOf(addr) as Promise<bigint>,
    reader.usdt.balanceOf(addr) as Promise<bigint>,
    readProvider.getBalance(addr),
  ]);
  session.balances = { hcow: toAmount(hcow), usdt: toAmount(usdt), bnb: toAmount(bnb) };
}

/** Orders overlapping adoptAccounts calls: only the latest may write the chain id it read. */
let adoptSeq = 0;

async function adoptAccounts(accounts: string[]): Promise<void> {
  const seq = ++adoptSeq;
  const next = accounts.length > 0 ? (accounts[0] as Address) : null;
  // Set before any await, so a later accountsChanged always wins (re-review R3).
  session.address = next;
  // The chain id is cleared when the wallet could not be read (M-7). An
  // account arriving afterwards must not be published as connected on chain
  // null, which every write then refuses as WRONG_NETWORK (review F8).
  if (next && session.chainId === null) {
    try {
      const eth = injected();
      const id = eth ? Number((await eth.request({ method: "eth_chainId" })) as string) : null;
      // Only if nothing newer (another account event, a chainChanged) has
      // set it meanwhile.
      if (id !== null && seq === adoptSeq && session.chainId === null) session.chainId = id;
    } catch {
      /* stays null: the wrong-network banner is then the honest state */
    }
  }
  if (!next) {
    session.balances = { ...ZERO_BALANCES };
    publish();
    return;
  }
  try {
    await refreshBalances();
  } catch {
    // Keep the address. A balance read failure is not a disconnection.
  }
  publish();
}

async function requireSigner(): Promise<Signer> {
  const eth = injected();
  if (!eth || !session.address) {
    throw new AdapterError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
  }
  if (session.chainId !== DEPLOYMENT.chainId) {
    throw new AdapterError(
      "WRONG_NETWORK",
      `Switch to ${DEPLOYMENT.chainName} (chain ${DEPLOYMENT.chainId}).`
    );
  }
  if (shownAddress === null || shownAddress.toLowerCase() !== session.address.toLowerCase()) {
    // Not published yet. Refuse rather than sign for an account the screen
    // has not shown. adoptAccounts publishes it moments later.
    throw new AdapterError(
      "ACCOUNT_CHANGED",
      "The wallet switched account before the page caught up. Nothing was sent."
    );
  }
  const bp = new BrowserProvider(eth, DEPLOYMENT.chainId);
  return bp.getSigner(session.address);
}

// ============================================================
// ERRORS
// ============================================================

interface ProviderErrorish {
  code?: string | number;
  shortMessage?: string;
  reason?: string;
  message?: string;
  info?: { error?: { code?: number; message?: string } };
  revert?: { name?: string; args?: unknown[] } | null;
  data?: unknown;
}

/**
 * Every contract revert this UI can provoke, mapped to one of the twelve
 * adapter codes. Anything not listed falls through to TX_REVERTED with the
 * error name as the reason, which still renders something specific.
 */
const REVERT_MAP: Record<string, { code: AdapterErrorCode; msg: string }> = {
  CooldownActive: { code: "UNBOND_COOLDOWN_ACTIVE", msg: "The cooldown has not finished yet." },
  UnknownRepresentative: { code: "INVALID_REPRESENTATIVE", msg: "That representative does not exist." },
  RepresentativeInactive: { code: "INVALID_REPRESENTATIVE", msg: "That representative is no longer active." },
  AlreadyDelegatedElsewhere: { code: "INVALID_REPRESENTATIVE", msg: "Already delegated. Redelegate instead of staking again." },
  ERC20InsufficientBalance: { code: "INSUFFICIENT_HCOW", msg: "Not enough HCOW." },
  ERC20InsufficientAllowance: { code: "TX_REVERTED", msg: "Approval was not granted for this amount." },
  InsufficientBonded: { code: "TX_REVERTED", msg: "More than the bonded balance." },
  InsufficientStake: { code: "TX_REVERTED", msg: "More than the staked balance." },
  NothingBonded: { code: "TX_REVERTED", msg: "Nothing is bonded." },
  NothingStaked: { code: "TX_REVERTED", msg: "Nothing is staked." },
  NothingToClaim: { code: "TX_REVERTED", msg: "Nothing to claim." },
  NoPendingUnbond: { code: "TX_REVERTED", msg: "No unbond is pending." },
  NoPendingUnstake: { code: "TX_REVERTED", msg: "No unstake is pending." },
  UnbondAlreadyPending: { code: "TX_REVERTED", msg: "An unbond is already pending." },
  UnstakeAlreadyPending: { code: "TX_REVERTED", msg: "An unstake is already pending." },
  SameRepresentative: { code: "INVALID_REPRESENTATIVE", msg: "Already delegated to that representative." },
  ZeroAmount: { code: "TX_REVERTED", msg: "Amount must be greater than zero." },
  FaucetEmpty: { code: "TX_REVERTED", msg: "The test faucet is empty. Ask the team to refill it." },
};

function withDetail(err: AdapterError, detail: string): AdapterError {
  err.detail = detail;
  return err;
}

/**
 * Reads go through this, so a page that cannot load says "network problem"
 * instead of "Something went wrong" (audit 6, H-6). A read is never declined
 * by the user and never reverts on the user's behalf: anything that is not
 * already an AdapterError means the chain could not be read as expected.
 */
function mapRead(e: unknown): AdapterError {
  if (e instanceof AdapterError) return e;
  return new AdapterError("RPC_ERROR", "Could not read from the network.", e);
}

async function read<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw mapRead(e);
  }
}

/** Latest block time, in ms. The contract's clock, as far as this page can see it. */
async function chainNowMs(): Promise<number> {
  const b = await readProvider.getBlock("latest");
  if (!b) throw new AdapterError("RPC_ERROR", "Could not read the latest block.");
  return secToMs(b.timestamp);
}

/**
 * A chain time carried onto this browser's clock (audit 6, M-8). Shifted only
 * when the browser runs AHEAD of the chain: that is the direction in which a
 * local countdown says "ready" before the contract agrees, and the user pays
 * gas for a certain CooldownActive revert. A browser running behind waits a
 * little longer than it has to, which costs nothing. The latest block trails
 * real time by a block or so, which errs the same way.
 */
function onLocalClock(chainMs: number, blockMs: number, localNow: number): number {
  return chainMs + Math.max(0, localNow - blockMs);
}

function mapError(e: unknown, txHash?: Hex): AdapterError {
  if (e instanceof AdapterError) return e;

  const err = (e ?? {}) as ProviderErrorish;
  const code = err.code;
  const inner = err.info?.error?.code;

  // EIP-1193 user rejection. ethers surfaces it as ACTION_REJECTED, raw
  // providers as 4001. Both mean the same thing and must not read as a failure.
  if (code === "ACTION_REJECTED" || code === 4001 || inner === 4001) {
    return new AdapterError("USER_REJECTED", "Signature declined.", e, txHash);
  }
  if (code === "INSUFFICIENT_FUNDS") {
    return new AdapterError("INSUFFICIENT_BNB", `Not enough ${DEPLOYMENT.nativeSymbol} for gas.`, e, txHash);
  }
  if (code === "NETWORK_ERROR" || code === "SERVER_ERROR" || code === "TIMEOUT") {
    return new AdapterError("RPC_ERROR", "The network did not respond.", e, txHash);
  }

  const name = err.revert?.name;
  if (name && Object.prototype.hasOwnProperty.call(REVERT_MAP, name)) {
    const m = REVERT_MAP[name];
    // The message is written for the user, so it travels as `detail` and the
    // toast shows it (audit 6, L-14). It used to be dropped by presentError.
    return withDetail(new AdapterError(m.code, m.msg, e, txHash), m.msg);
  }
  if (name) {
    return new AdapterError("TX_REVERTED", `Reverted: ${name}`, e, txHash);
  }
  if (code === "CALL_EXCEPTION") {
    return new AdapterError("TX_REVERTED", err.shortMessage ?? "The transaction reverted.", e, txHash);
  }

  return new AdapterError("UNKNOWN_ERROR", err.shortMessage ?? err.message ?? "Something went wrong.", e, txHash);
}

// ============================================================
// WRITE PIPELINE
// ============================================================

/**
 * Send a transaction and wait for one confirmation, or throw TX_TIMEOUT with
 * the hash attached after PROTOCOL.TX_TIMEOUT_MS. Rules A and C.
 *
 * The receipt wait is not cancelled on timeout. It is left running so the
 * transaction is still tracked if the user keeps the tab open.
 */
async function submit(send: () => Promise<TransactionResponse>): Promise<TxResult> {
  let tx: TransactionResponse;
  try {
    tx = await send();
  } catch (e) {
    throw mapError(e);
  }

  const hash = tx.hash as Hex;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new AdapterError("TX_TIMEOUT", "Still pending. It may yet confirm.", null, hash));
    }, PROTOCOL.TX_TIMEOUT_MS);
  });

  // Keep tracking after a timeout (audit 6, L-12). The toast says it may still
  // confirm; when it does, the balances and the screens have to follow. This
  // used to be claimed in a comment and done by nobody.
  const mined = tx.wait(1);
  mined.then(
    (r) => {
      if (timedOut && r) void refreshBalances().then(publish, publish);
    },
    () => undefined,
  );

  try {
    const receipt = await Promise.race([mined, timeout]);
    if (!receipt) throw new AdapterError("TX_REVERTED", "No receipt returned.", null, hash);
    if (receipt.status === 0) {
      throw new AdapterError("TX_REVERTED", "The transaction reverted.", null, hash);
    }
    // Balances moved. Tell the UI before the promise resolves so the screen
    // that re-renders on resolve already has the new numbers.
    await refreshBalances().catch(() => undefined);
    publish();
    return { hash, confirmed: true, blockNumber: receipt.blockNumber, failureReason: null, effectiveEpoch: null };
  } catch (e) {
    throw mapError(e, hash);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Approve exactly `amount` if the current allowance is short. Never unlimited.
 * Returns the approval's hash when one was sent and confirmed, else null.
 */
async function ensureAllowance(signer: Signer, spender: string, amount: bigint): Promise<Hex | null> {
  const owner = await signer.getAddress();
  const current = await read(() => reader.hcow.allowance(owner, spender) as Promise<bigint>);
  if (current >= amount) return null;
  const token = new Contract(DEPLOYMENT.addresses.hcow, ERC20_ABI, signer);
  const r = await submit(() => token.approve(spender, amount) as Promise<TransactionResponse>);
  return r.hash;
}

/**
 * The wei to sign for `amount` against an exact on-chain limit: the wallet's
 * HCOW, the bonded balance, the staked balance.
 *
 * Amounts cross the interface as JS numbers, so a balance shown in full (the
 * MAX button) can read back a few wei above the real one: a bonded balance of
 * 999.999999999999999999 HCOW is the number 1000 (review 2026-09-25, F1).
 * When `amount` is exactly the limit as displayed, the limit itself is signed.
 * Any other amount above it is refused here, before anything is sent: for a
 * bond that is before the approval, which is also what makes INSUFFICIENT_HCOW
 * reachable at all (audit 6, L-13; the token's own revert could not be named).
 */
function weiWithin(amount: Amount, limit: bigint, refuse: () => AdapterError): bigint {
  const wei = toWei(amount);
  if (wei === 0n) {
    // Below one wei: the form accepts it, and the contract would revert.
    const msg = "The amount is smaller than the smallest unit HCOW can express.";
    throw withDetail(new AdapterError("TX_REVERTED", msg), msg);
  }
  if (wei <= limit) return wei;
  if (limit > 0n && toAmount(limit) === amount) return limit;
  throw refuse();
}

async function hcowToSpend(owner: string, amount: Amount): Promise<bigint> {
  const balance = await read(() => reader.hcow.balanceOf(owner) as Promise<bigint>);
  return weiWithin(amount, balance, () => new AdapterError("INSUFFICIENT_HCOW", "Not enough HCOW."));
}

/**
 * Every policy figure the page states, read back from the contracts. The
 * deduction limits are the ones a user acknowledges before a first bond (audit
 * 6, H-8: the page said 10% per 7-day epoch for a contract that caps a
 * settlement at 2%); the rest are shown on the screens and used in the
 * waterfall. All are constants in the contracts, so one successful read per
 * page load is enough. A failed read is not a mismatch: the cache is dropped
 * and the error propagates as a read error.
 */
export const POLICY_MISMATCH_MSG =
  "The limits on this page do not match the contract, so this action is disabled here. Nothing was sent.";

let policyCache: Promise<string[]> | null = null;

async function readPolicyMismatches(): Promise<string[]> {
  if (!policyCache) {
    const d = PROTOCOL.DEDUCTION;
    const day = 86_400;
    policyCache = read(() => Promise.all([
      reader.profitShare.MAX_DEDUCT_PPM() as Promise<bigint>,
      reader.profitShare.MAX_DECAY_PER_WINDOW_PPM() as Promise<bigint>,
      reader.profitShare.DECAY_WINDOW() as Promise<bigint>,
      reader.profitShare.UNBOND_COOLDOWN() as Promise<bigint>,
      reader.profitShare.MIN_EPOCH_INTERVAL() as Promise<bigint>,
      reader.profitShare.PARTICIPANT_BPS() as Promise<bigint>,
      reader.profitShare.GAME_COMPANY_BPS() as Promise<bigint>,
      reader.profitShare.TEAM_BPS() as Promise<bigint>,
      reader.profitShare.OPEX_CAP_BPS() as Promise<bigint>,
      reader.staking.UNSTAKE_COOLDOWN() as Promise<bigint>,
      reader.staking.MAX_COMMISSION_BPS() as Promise<bigint>,
    ])).then((v) => {
      const expected: [string, number][] = [
        ["MAX_DEDUCT_PPM", d.PER_SETTLEMENT_PPM],
        ["MAX_DECAY_PER_WINDOW_PPM", d.PER_WINDOW_PPM],
        ["DECAY_WINDOW", d.WINDOW_DAYS * day],
        ["UNBOND_COOLDOWN", PROTOCOL.UNBOND_COOLDOWN_DAYS * day],
        ["MIN_EPOCH_INTERVAL", PROTOCOL.EPOCH_DAYS * day],
        ["PARTICIPANT_BPS", PROTOCOL.DISTRIBUTION.PARTICIPANTS_PCT * 100],
        ["GAME_COMPANY_BPS", PROTOCOL.DISTRIBUTION.GAME_STUDIO_PCT * 100],
        ["TEAM_BPS", PROTOCOL.DISTRIBUTION.TEAM_PCT * 100],
        ["OPEX_CAP_BPS", PROTOCOL.OPEX_CAP_PCT * 100],
        ["UNSTAKE_COOLDOWN", PROTOCOL.UNSTAKE_COOLDOWN_DAYS * day],
        ["MAX_COMMISSION_BPS", PROTOCOL.COMMISSION_CAP_PCT * 100],
      ];
      return expected.filter(([, want], i) => v[i] !== BigInt(want)).map(([name]) => name);
    });
    policyCache.catch(() => { policyCache = null; });
  }
  return policyCache;
}

/**
 * Refuse, before anything is sent, an action that puts HCOW in (bond, top-up,
 * stake, redelegate) when the page's figures differ from the contracts'.
 * Actions that take HCOW or USDT out are never blocked by this.
 */
async function assertPolicy(): Promise<void> {
  const mismatched = await readPolicyMismatches();
  if (mismatched.length > 0) {
    throw withDetail(new AdapterError("UNKNOWN_ERROR", POLICY_MISMATCH_MSG), POLICY_MISMATCH_MSG);
  }
}

/**
 * Run the step after an approval. If it fails, the error says the approval
 * already happened (audit 6, H-4): "Nothing was sent" was false there, and an
 * allowance for the amount stays on chain until the next attempt uses it.
 */
async function afterApproval<T>(approvalHash: Hex | null, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    const err = mapError(e);
    if (approvalHash) err.approvalHash = approvalHash;
    throw err;
  }
}

// ============================================================
// EPOCH CACHE
// ============================================================

interface EpochBase {
  current: number;
  startsAt: number;
  earliestSettlementAt: number | null;
  stallDeadlineAt: number;
  fetchedAt: number;
}
let epochCache: EpochBase | null = null;
const EPOCH_CACHE_MS = 15_000;
/** Minimum spacing of the balance refresh driven by new blocks. */
const BLOCK_REFRESH_MS = 15_000;

/**
 * Epoch timing from the contract only (audit 6, H-3). The contract does not
 * schedule epochs: one ends when the settler submits a settlement, no earlier
 * than MIN_EPOCH_INTERVAL after the last. The previous version counted down
 * to startsAt + 7 days, a browser constant, and then showed "Settling..."
 * for as long as nobody settled.
 */
async function epochBase(): Promise<EpochBase> {
  const now = Date.now();
  if (epochCache && now - epochCache.fetchedAt < EPOCH_CACHE_MS) return epochCache;

  const [next, last, deployed, minInterval, stall] = await Promise.all([
    reader.profitShare.nextEpoch() as Promise<bigint>,
    reader.profitShare.lastSettledAt() as Promise<bigint>,
    reader.profitShare.deployedAt() as Promise<bigint>,
    reader.profitShare.MIN_EPOCH_INTERVAL() as Promise<bigint>,
    reader.profitShare.epochStallDeadline() as Promise<bigint>,
  ]);
  const lastSettled = Number(last);
  epochCache = {
    current: Number(next),
    startsAt: secToMs(lastSettled > 0 ? lastSettled : Number(deployed)),
    // Before the first settlement the contract accepts one at any time.
    earliestSettlementAt: lastSettled > 0 ? secToMs(lastSettled + Number(minInterval)) : null,
    // The contract's own value, so the 30-day and 90-day fuses are not restated here.
    stallDeadlineAt: secToMs(stall),
    fetchedAt: now,
  };
  return epochCache;
}

/**
 * 24h / 7d / 30d windows summed from getSettlement records, newest first.
 *
 * These used to come from the event index (revenue_windows). On 2026-09-24 the
 * index had not recorded a single event of the current contracts, and the
 * public BSC testnet nodes no longer serve eth_getLogs for September blocks
 * (pruned, or refused outright), so it could not be backfilled. The windows
 * were showing a "measured" 0 over a 1,000 USDT settlement. The contract holds
 * every settlement anyway, and settlements are at least MIN_EPOCH_INTERVAL
 * (7 days) apart, a stall close at least 30 days, so a 30-day window holds at
 * most five of them: a handful of reads, no index.
 *
 * null when any read fails, or when more records than that fall inside the
 * window (the spacing assumption would be broken): not measured, never a
 * partial sum. Window test matches the old view: age strictly under the span.
 */
async function settlementWindows(): Promise<{
  gross24h: number; gross7d: number; gross30d: number; participants30d: number;
  deducted24h: number; deducted30d: number;
} | null> {
  const DAY = 86_400_000;
  const MAX_IN_30D = 5;
  try {
    const next = Number((await reader.profitShare.nextEpoch()) as bigint);
    const now = Date.now();
    let gross24h = 0, gross7d = 0, gross30d = 0, participants30d = 0, deducted24h = 0, deducted30d = 0, inside = 0;
    for (let e = next - 1; e >= 0; e--) {
      const s = (await reader.profitShare.getSettlement(e)) as {
        grossReceivedUsdt: bigint; participantsUsdt: bigint; hcowDeducted: bigint; settledAt: bigint;
      };
      const at = secToMs(s.settledAt);
      // A record with no time, or one older than 30 days: nothing older can be inside either.
      if (at === 0 || now - at >= 30 * DAY) break;
      if (++inside > MAX_IN_30D) return null;
      const age = Math.max(0, now - at);   // a record slightly "ahead" of this clock is brand new
      const gross = toAmount(s.grossReceivedUsdt);
      const deducted = toAmount(s.hcowDeducted);
      gross30d += gross;
      participants30d += toAmount(s.participantsUsdt);
      deducted30d += deducted;
      if (age < 7 * DAY) gross7d += gross;
      if (age < DAY) {
        gross24h += gross;
        deducted24h += deducted;
      }
    }
    return { gross24h, gross7d, gross30d, participants30d, deducted24h, deducted30d };
  } catch {
    return null;
  }
}

// ============================================================
// THE ADAPTER
// ============================================================

export const chainAdapter: IHcowAdapter = {
  // ---------------------------------------------------------- wallet

  async getWalletState(): Promise<WalletState> {
    // Rule E. Must never throw, must never return a stale address.
    const eth = injected();
    if (!eth) {
      session.address = null;
      session.chainId = null;
      return snapshot();
    }
    let accounts: string[];
    let chainHex: string;
    try {
      accounts = (await eth.request({ method: "eth_accounts" })) as string[];
      chainHex = (await eth.request({ method: "eth_chainId" })) as string;
    } catch {
      // The wallet could not be read (locked, extension reloading). Report
      // disconnected. "Leave whatever we had" returned the previous address as
      // live, the one thing this method must never do (audit 6, M-7).
      session.address = null;
      session.chainId = null;
      session.balances = { ...ZERO_BALANCES };
      return snapshot();
    }
    session.chainId = Number(chainHex);
    session.address = accounts.length > 0 ? (accounts[0] as Address) : null;
    if (session.address) {
      try {
        await refreshBalances();
      } catch {
        // Keep the address. A balance read failure is not a disconnection.
      }
    } else {
      session.balances = { ...ZERO_BALANCES };
    }
    return snapshot();
  },

  async connectWallet(provider: WalletProvider): Promise<WalletState> {
    if (provider === "walletconnect") {
      // No WalletConnect project id and no @walletconnect dependency in this
      // build. Saying so is better than a silent failure in the modal.
      throw new AdapterError(
        "UNKNOWN_ERROR",
        "WalletConnect is not configured in this build. Use MetaMask."
      );
    }
    const eth = injected();
    if (!eth) {
      throw new AdapterError("UNKNOWN_ERROR", "No wallet extension found. Install MetaMask.");
    }

    let accounts: string[];
    try {
      accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    } catch (e) {
      throw mapError(e);
    }

    const chainHex = (await eth.request({ method: "eth_chainId" })) as string;
    session.chainId = Number(chainHex);

    if (session.chainId !== DEPLOYMENT.chainId) {
      const target = "0x" + DEPLOYMENT.chainId.toString(16);
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: target }] });
      } catch (e) {
        const code = (e as ProviderErrorish).code;
        // 4902: the wallet does not know this chain yet. Offer to add it.
        if (code === 4902) {
          try {
            await eth.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: target,
                  chainName: DEPLOYMENT.chainName,
                  nativeCurrency: { name: DEPLOYMENT.nativeSymbol, symbol: DEPLOYMENT.nativeSymbol, decimals: 18 },
                  rpcUrls: [DEPLOYMENT.rpcUrl],
                  blockExplorerUrls: [DEPLOYMENT.explorerBase],
                },
              ],
            });
          } catch (addErr) {
            throw new AdapterError("WRONG_NETWORK", `Add ${DEPLOYMENT.chainName} to your wallet to continue.`, addErr);
          }
        } else {
          // A declined network switch is WRONG_NETWORK, not USER_REJECTED.
          // The user did connect; they just did not switch.
          throw new AdapterError("WRONG_NETWORK", `Switch to ${DEPLOYMENT.chainName} to continue.`, e);
        }
      }
      const after = (await eth.request({ method: "eth_chainId" })) as string;
      session.chainId = Number(after);
    }

    await adoptAccounts(accounts);
    return snapshot();
  },

  async disconnectWallet(): Promise<void> {
    // An injected wallet cannot be disconnected from the page side. Clearing
    // the session is the honest equivalent: the UI stops acting on the account.
    session.address = null;
    session.balances = { ...ZERO_BALANCES };
    publish();
  },

  subscribeWallet(cb: (state: WalletState) => void): () => void {
    subscribers.add(cb);

    const eth = injected();
    const onAccounts = (...args: unknown[]) => {
      void adoptAccounts((args[0] as string[]) ?? []);
    };
    const onChain = (...args: unknown[]) => {
      session.chainId = Number(args[0] as string);
      epochCache = null;
      void refreshBalances().then(publish, publish);
    };
    // Balances follow new blocks, but not every block: BSC produces one every
    // second or so and each refresh is three reads, which on a public node is
    // how a tab gets rate limited into read failures (audit 6, H-6). Writes
    // refresh on their own when they confirm.
    let lastBlockRefresh = 0;
    const onBlock = () => {
      const now = Date.now();
      if (!session.address || now - lastBlockRefresh < BLOCK_REFRESH_MS) return;
      lastBlockRefresh = now;
      void refreshBalances().then(publish, () => undefined);
    };

    eth?.on?.("accountsChanged", onAccounts);
    eth?.on?.("chainChanged", onChain);
    readProvider.on("block", onBlock);

    // Rule F: fire once immediately, with fresh state rather than the cached
    // snapshot, so a page reload does not show a stale account.
    void chainAdapter.getWalletState().then((s) => {
      shownAddress = s.address;
      try {
        cb(s);
      } catch {
        /* ignore */
      }
    });

    return () => {
      subscribers.delete(cb);
      eth?.removeListener?.("accountsChanged", onAccounts);
      eth?.removeListener?.("chainChanged", onChain);
      void readProvider.off("block", onBlock);
    };
  },

  // ---------------------------------------------------------- read

  async getEpoch(): Promise<Epoch> {
    // Rule G. Cached; any countdown is computed in the UI, not fetched.
    const base = await read(epochBase);
    return {
      current: base.current,
      startsAt: base.startsAt,
      earliestSettlementAt: base.earliestSettlementAt,
      stallDeadlineAt: base.stallDeadlineAt,
    };
  },

  async getLastEpochDistribution(): Promise<EpochDistribution | null> {
    const next = Number(await read(() => reader.profitShare.nextEpoch() as Promise<bigint>));
    if (next === 0) return null;
    return chainAdapter.getEpochDistribution(next - 1);
  },

  async getEpochDistribution(epoch: number): Promise<EpochDistribution | null> {
    let s: {
      grossReceivedUsdt: bigint;
      directCostsUsdt: bigint;
      operatingCostsUsdt: bigint;
      distributableProfitUsdt: bigint;
      participantsUsdt: bigint;
      gameCompanyUsdt: bigint;
      teamUsdt: bigint;
      hcowDeducted: bigint;
      snapshotBondedHcow: bigint;
      settledAt: bigint;
    };
    try {
      s = await reader.profitShare.getSettlement(epoch);
    } catch (e) {
      // A read: RPC_ERROR, not the write path's "The transaction reverted".
      throw mapRead(e);
    }
    if (Number(s.settledAt) === 0) return null;

    const gross = toAmount(s.grossReceivedUsdt);
    const direct = toAmount(s.directCostsUsdt);
    const opex = toAmount(s.operatingCostsUsdt);
    const profit = toAmount(s.distributableProfitUsdt);
    const participants = toAmount(s.participantsUsdt);

    // Both legs as the contract recorded them. They used to be derived here as
    // studio = profit x 25% and team = profit - participants - studio, which
    // is wrong whenever participantsUsdt includes carry from an earlier epoch
    // or is zero because nobody was eligible (audit 6, H-7): the testnet
    // epoch 0 records participants 0, studio 175, team 175, and the old
    // formula showed team 525.
    const studio = toAmount(s.gameCompanyUsdt);
    const team = toAmount(s.teamUsdt);

    const indexed = await settlementForEpoch(epoch);
    const txHash = (indexed?.[0]?.tx_hash ?? "") as Hex;

    return {
      epoch,
      settledAt: secToMs(s.settledAt),
      // From the EpochSettled event. Empty when the index is not configured
      // or has not caught up; the UI renders no link rather than a dead one.
      txHash,

      // Indexer gap. The contract stores the totals, not the line items.
      // null is "not published yet" (adapter v0.4.2). [] made the waterfall
      // print "No direct costs recorded 0.00" two rows above a non-zero
      // directCostsUsdt read from the contract (audit 6, L-16).
      revenue: null,
      grossReceivedUsdt: gross,

      costs: null,
      directCostsUsdt: direct,
      netRevenueUsdt: gross - direct,

      operatingCostsUsdt: opex,
      // Structurally always zero: settleEpoch reverts above the cap, so an
      // over-cap epoch can never be recorded in the first place.
      operatingCostsAboveCapUsdt: 0,

      distributableProfitUsdt: profit,
      participantsUsdt: participants,
      gameStudioUsdt: studio,
      teamUsdt: team,

      totalHcowDeducted: toAmount(s.hcowDeducted),
      snapshotBondedHcow: toAmount(s.snapshotBondedHcow),
      // Indexer gap. Requires the revenue lines to classify. Reported as null,
      // "not measured" (adapter v0.4.1). It used to be 0, chosen so an
      // unproven epoch would not look fully verified; the UI then printed
      // "0.0% chain verifiable" as if it had been measured (audit 6, C-2).
      chainVerifiableRatio: null,
    };
  },

  async getPoolStats(): Promise<PoolStats> {
    // totalUsdtDistributed() is no longer read here: it is a lifetime figure
    // and the only field it fed is labelled 30d (adapter v0.4.2).
    const [totalBonded, participants, w] = await read(() => Promise.all([
      reader.profitShare.totalBondedHcow() as Promise<bigint>,
      reader.profitShare.participantCount() as Promise<bigint>,
      settlementWindows(),
    ]));

    return {
      totalBondedHcow: toAmount(totalBonded),
      // Accounts holding shares. A pending unbond is not counted, matching
      // the contract: money on its way out is not participating.
      participants: Number(participants),
      // Null by policy until the APR methodology is confirmed. The UI renders
      // a dash. Do not replace this with a computed guess.
      estimatedAprPct: null,
      // Rolling windows over the contract's own settlement records (see
      // settlementWindows). Receipt basis: an epoch's gross lands in the
      // window its settlement did, the same basis the policy uses. null only
      // when those reads fail: never 0 for "unknown", never the lifetime total.
      grossReceivedUsdtToday: w ? w.gross24h : null,
      grossReceivedUsdt7d: w ? w.gross7d : null,
      grossReceivedUsdt30d: w ? w.gross30d : null,
      distributedToParticipantsUsdt30d: w ? w.participants30d : null,
      // Indexer gaps (CHAIN_ADAPTER_GAPS.needsIndexer). null is "not measured",
      // not "nothing arrived": [] here made the Profit Share screen say "No
      // money has been received into the vault in the last 30 days" on every
      // load, next to a non-zero gross figure (audit 6, C-1). See adapter v0.4.1.
      revenue30dByOrigin: null,
      chainVerifiableRatio30d: null,
      lastUpdatedAt: Date.now(),
    };
  },

  async getNetworkStats(): Promise<NetworkStats> {
    const [counts, block] = await read(() => Promise.all([
      reader.staking.representativeCount() as Promise<[bigint, bigint]>,
      readProvider.getBlock("latest"),
    ]));
    // No block means no head to report. The fallback used to be Date.now(),
    // which stamped a live-looking chain head on a failed read (audit 6, L-7).
    if (!block) throw new AdapterError("RPC_ERROR", "Could not read the latest block.");
    const total = Number(counts[0]);
    const active = Number(counts[1]);
    return {
      activeRepresentatives: active,
      totalRepresentatives: total,
      // Deliberately crude: this reflects registry state, not validator uptime,
      // because nothing here runs validators. Real health needs monitoring.
      networkStatus: active === 0 ? "down" : active < total ? "degraded" : "healthy",
      lastBlockAt: secToMs(block.timestamp),
    };
  },

  async getBurnStats(): Promise<BurnStats> {
    // The only burn is HCOWProfitShare sending HCOW to its BURN_ADDRESS
    // (deductions at settlement, forfeits on exit). A transfer to 0x...dEaD
    // does not reduce totalSupply(), so the burned figure is that address's
    // balance. It used to be 200,000,000 minus totalSupply(), which stays 0
    // however much is deducted (audit 6, M-3), and HCOWToken's published
    // source says to read balanceOf(0xdEaD) instead.
    // HCOWToken is also ERC20Burnable: a holder's own burn() lowers
    // totalSupply() and never reaches the burn address, so it is counted as
    // INITIAL_SUPPLY minus totalSupply() when the token publishes
    // INITIAL_SUPPLY (review F5). The testnet stand-in token does not; then
    // only the burn address is counted and the base is totalSupply().
    const burnAddress = await read(() => reader.profitShare.BURN_ADDRESS() as Promise<string>);
    const [supply, deadWei, initial, w] = await read(() => Promise.all([
      reader.hcow.totalSupply() as Promise<bigint>,
      reader.hcow.balanceOf(burnAddress) as Promise<bigint>,
      // null only when the token has no such getter. A network failure is a
      // failed read, not "no getter": swallowing it would publish a smaller
      // burned figure over a different base (re-review R4).
      (reader.hcow.INITIAL_SUPPLY() as Promise<bigint>).catch((e: unknown) => {
        const err = e as ProviderErrorish;
        // The node answered that the call reverts (no such function), or the
        // address returned nothing to decode. ethers labels a node outage on
        // eth_call CALL_EXCEPTION too, so the node's own message decides.
        const nodeSaid = err.info?.error?.message ?? "";
        if (err.code === "BAD_DATA") return null;
        if (err.code === "CALL_EXCEPTION" && (err.data != null || /revert/i.test(nodeSaid))) return null;
        throw e;
      }),
      settlementWindows(),
    ]));
    const selfBurnedWei = initial !== null && initial > supply ? initial - supply : 0n;
    const burned = toAmount(deadWei + selfBurnedWei);
    const supplyBaseHcow = toAmount(initial ?? supply);

    return {
      totalBurnedHcow: burned,
      supplyBaseHcow,
      countsHolderBurns: initial !== null,
      percentOfSupply: supplyBaseHcow > 0 ? (burned / supplyBaseHcow) * 100 : 0,
      // From the settlement records, like the gross windows. The 30d figure
      // used to fall back to the lifetime total under a "30d" label (M-4).
      deductedAtSettlement24h: w ? w.deducted24h : null,
      deductedAtSettlement30d: w ? w.deducted30d : null,
    };
  },

  async getBondedPosition(): Promise<BondedPosition> {
    if (!session.address) {
      throw new AdapterError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
    }
    const addr = session.address;
    const localNow = Date.now();
    const [account, claimable, totalBonded, lifetime, payout, blockMs] = await read(() => Promise.all([
      reader.profitShare.accountOf(addr) as Promise<{
        bondedHcow: bigint;
        shares: bigint;
        pendingUnbond: bigint;
        unbondReadyAt: bigint;
      }>,
      reader.profitShare.claimableOf(addr) as Promise<bigint>,
      reader.profitShare.totalBondedHcow() as Promise<bigint>,
      reader.profitShare.lifetimeOf(addr) as Promise<{
        deductedHcow: bigint;
        claimedUsdt: bigint;
      }>,
      // What the pending unbond pays out now. accountOf's pendingUnbond is the
      // amount as requested; the contract charges a pending unbond for at most
      // one settlement, so the payout can be lower (v0.4.5).
      reader.profitShare.pendingUnbondOf(addr) as Promise<bigint>,
      chainNowMs(),
    ]));

    const bonded = toAmount(account.bondedHcow);
    const pending = toAmount(account.pendingUnbond);
    const readyAt = Number(account.unbondReadyAt);
    const pool = toAmount(totalBonded);

    let status: BondedStatus;
    if (pending > 0) status = "cooldown";
    else if (bonded > 0) status = "active";
    else if (account.shares > 0n) status = "exhausted";
    else status = "first_time";

    return {
      status,
      bondedAmount: bonded,
      shareOfPool: pool > 0 ? bonded / pool : 0,
      // Backend gap. A forecast needs revenue projection, not chain state.
      // null, "not forecast" (adapter v0.4.2). A 0 under a "Forecast" label
      // was an invented number (audit 6, M-5).
      estimatedEpochUsdt: null,
      // Keyed on the request, not the payout: a pending unbond is pending even
      // if the charge took all of it.
      pendingUnbondAmount: pending > 0 ? toAmount(payout) : null,
      // Rule H. Chain value, never Date.now() + cooldown; on this browser's
      // clock only when that clock runs ahead (M-8).
      pendingUnbondReadyAt: readyAt > 0 ? onLocalClock(secToMs(readyAt), blockMs, localNow) : null,
      pendingClaimUsdt: toAmount(claimable),
      // Reconstructed from the deduction accumulator, so it is correct
      // between settlements without anyone having to poke the contract.
      lifetimeDeductedHcow: toAmount(lifetime.deductedHcow),
      lifetimeClaimedUsdt: toAmount(lifetime.claimedUsdt),
    };
  },

  async getStakedPosition(): Promise<StakedPosition> {
    if (!session.address) {
      throw new AdapterError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
    }
    const addr = session.address;
    const localNow = Date.now();
    const [d, blockMs] = await read(() => Promise.all([
      reader.staking.delegationOf(addr) as Promise<{
        repId: string;
        stakedAmount: bigint;
        pendingUnstake: bigint;
        unstakeReadyAt: bigint;
        pendingReward: bigint;
        lifetimeClaimed: bigint;
      }>,
      chainNowMs(),
    ]));

    const staked = toAmount(d.stakedAmount);
    const pending = toAmount(d.pendingUnstake);
    const readyAt = Number(d.unstakeReadyAt);

    let status: StakedStatus;
    if (pending > 0) status = "cooldown";
    else if (staked > 0) status = "active";
    else status = "first_time";

    return {
      status,
      stakedAmount: staked,
      delegatedTo: d.repId && d.repId !== ZERO_BYTES32 ? safeDecodeId(d.repId) : null,
      estimatedAprPct: null,
      pendingUnstakeAmount: pending > 0 ? pending : null,
      pendingUnstakeReadyAt: readyAt > 0 ? onLocalClock(secToMs(readyAt), blockMs, localNow) : null,
      pendingRewardHcow: toAmount(d.pendingReward),
      lifetimeRewardHcow: toAmount(d.lifetimeClaimed),
    };
  },

  async getRepresentatives(): Promise<Representative[]> {
    const ids = await read(() => reader.staking.representativeIds() as Promise<string[]>);
    const rows = await read(() => Promise.all(
      ids.map(async (id) => {
        const r = (await reader.staking.representativeOf(id)) as {
          name: string;
          payout: string;
          commissionBps: bigint;
          active: boolean;
          isFoundation: boolean;
          totalDelegated: bigint;
          delegatorCount: bigint;
        };
        const rep: Representative = {
          id: safeDecodeId(id),
          name: r.name,
          address: r.payout as Address,
          isFoundation: r.isFoundation,
          commissionPct: Number(r.commissionBps) / 100,
          totalDelegatedHcow: toAmount(r.totalDelegated),
          delegatorCount: Number(r.delegatorCount),
          // "warning" is a monitoring verdict and nothing monitors these yet,
          // so only the two states the contract actually knows are reported.
          status: r.active ? "active" : "inactive",
          estimatedAprPct: null,
          uptimeLast30dPct: null,
        };
        return rep;
      })
    ));
    return rows;
  },

  async getTxHistory(filter: TxFilter = "all"): Promise<Transaction[] | null> {
    // Deliberately not done with eth_getLogs from the browser: an unbounded
    // multi-topic scan over a growing range is rate limited into failure on
    // public BSC RPCs. The worker walks the chain once; this reads a table.
    if (!session.address) return [];
    // No index, or it could not be read: "unavailable", not "no transactions"
    // (adapter v0.4.2, audit 6 L-8). indexer.ts forbids turning null into [].
    if (!indexerConfigured()) return null;

    const rows = await eventsForAccount(session.address, PROTOCOL.HISTORY_LIMIT);
    if (!rows) return null;

    const out: Transaction[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;   // the index is untrusted (M-2)
      // Own keys only: row.event "constructor" or "toString" found a function
      // on the object's prototype and passed it on as a TxType (audit 6, M-2).
      const type = Object.prototype.hasOwnProperty.call(EVENT_TO_TX, row.event) ? EVENT_TO_TX[row.event] : undefined;
      if (!type) continue;               // protocol events with no user lane
      if (!matchesFilter(type, filter)) continue;
      const tx = toTransaction(row, type);
      if (tx) out.push(tx);
    }
    return out;
  },

  async getPolicyStatus(): Promise<PolicyStatus> {
    const mismatched = await readPolicyMismatches();
    return { matches: mismatched.length === 0, mismatched };
  },

  // ---------------------------------------------------------- write: profit share

  async bond(amount: Amount): Promise<TxResult> {
    const signer = await requireSigner();
    await assertPolicy();
    const wei = await hcowToSpend(await signer.getAddress(), amount);
    const approval = await ensureAllowance(signer, DEPLOYMENT.addresses.profitShare, wei);

    const c = new Contract(DEPLOYMENT.addresses.profitShare, PROFIT_SHARE_ABI, signer);
    const result = await afterApproval(approval, () => submit(() => c.bond(wei) as Promise<TransactionResponse>));

    epochCache = null;
    // The bond is confirmed. A failed read of the epoch number after it must
    // not turn a confirmed bond into an error toast, which invited a second
    // bond (audit 6, L-11).
    let next: number | null = null;
    try {
      next = Number((await reader.profitShare.nextEpoch()) as bigint);
    } catch {
      next = null;
    }
    return { ...result, effectiveEpoch: next };
  },

  async topUpBond(amount: Amount): Promise<TxResult> {
    // Same contract call. Split only so the UI can use different copy.
    return chainAdapter.bond(amount);
  },

  async requestUnbond(amount: Amount): Promise<TxResult> {
    const signer = await requireSigner();
    const owner = await signer.getAddress();
    // Against the exact bonded balance, so "unbond everything" is exactly
    // everything and not a certain InsufficientBonded revert (review F1).
    const bonded = await read(() => reader.profitShare.bondedOf(owner) as Promise<bigint>);
    const msg = "That is more than your bonded balance.";
    const wei = weiWithin(amount, bonded, () => withDetail(new AdapterError("TX_REVERTED", msg), msg));
    const c = new Contract(DEPLOYMENT.addresses.profitShare, PROFIT_SHARE_ABI, signer);
    return submit(() => c.requestUnbond(wei) as Promise<TransactionResponse>);
  },

  async cancelUnbond(): Promise<TxResult> {
    const signer = await requireSigner();
    const c = new Contract(DEPLOYMENT.addresses.profitShare, PROFIT_SHARE_ABI, signer);
    return submit(() => c.cancelUnbond() as Promise<TransactionResponse>);
  },

  async withdrawUnbonded(): Promise<TxResult> {
    if (!session.address) throw new AdapterError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
    // Re-verify against chain state before spending gas on a certain revert.
    const addr = session.address;
    const [account, nowMs] = await read(() => Promise.all([
      reader.profitShare.accountOf(addr) as Promise<{ unbondReadyAt: bigint }>,
      chainNowMs(),
    ]));
    const readyAt = Number(account.unbondReadyAt);
    if (readyAt === 0) {
      throw withDetail(new AdapterError("TX_REVERTED", "No unbond is pending."), "No unbond is pending.");
    }
    // Against the chain's clock, the one the contract checks. The browser's
    // clock let a fast machine through to a certain revert (audit 6, M-8).
    if (secToMs(readyAt) > nowMs) {
      const msg = `The ${PROTOCOL.UNBOND_COOLDOWN_DAYS}-day unbond cooldown has not finished yet.`;
      throw withDetail(new AdapterError("UNBOND_COOLDOWN_ACTIVE", msg), msg);
    }
    const signer = await requireSigner();
    const c = new Contract(DEPLOYMENT.addresses.profitShare, PROFIT_SHARE_ABI, signer);
    return submit(() => c.withdrawUnbonded() as Promise<TransactionResponse>);
  },

  async claimUsdt(): Promise<TxResult> {
    const signer = await requireSigner();
    const c = new Contract(DEPLOYMENT.addresses.profitShare, PROFIT_SHARE_ABI, signer);
    return submit(() => c.claimUsdt() as Promise<TransactionResponse>);
  },

  // ---------------------------------------------------------- write: staking

  async stake(amount: Amount, representativeId: string): Promise<TxResult> {
    const signer = await requireSigner();
    const id = encodeId(representativeId);
    await assertPolicy();
    await assertRepresentativeUsable(id);

    const wei = await hcowToSpend(await signer.getAddress(), amount);
    const approval = await ensureAllowance(signer, DEPLOYMENT.addresses.staking, wei);

    const c = new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, signer);
    return afterApproval(approval, () => submit(() => c.stake(wei, id) as Promise<TransactionResponse>));
  },

  async redelegate(toRepresentativeId: string): Promise<TxResult> {
    const signer = await requireSigner();
    const id = encodeId(toRepresentativeId);
    await assertPolicy();
    await assertRepresentativeUsable(id);
    const c = new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, signer);
    return submit(() => c.redelegate(id) as Promise<TransactionResponse>);
  },

  async requestUnstake(amount: Amount): Promise<TxResult> {
    const signer = await requireSigner();
    const owner = await signer.getAddress();
    const d = await read(() => reader.staking.delegationOf(owner) as Promise<{ stakedAmount: bigint }>);
    const msg = "That is more than your staked balance.";
    const wei = weiWithin(amount, d.stakedAmount, () => withDetail(new AdapterError("TX_REVERTED", msg), msg));
    const c = new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, signer);
    return submit(() => c.requestUnstake(wei) as Promise<TransactionResponse>);
  },

  async cancelUnstake(): Promise<TxResult> {
    const signer = await requireSigner();
    const c = new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, signer);
    return submit(() => c.cancelUnstake() as Promise<TransactionResponse>);
  },

  async withdrawUnstaked(): Promise<TxResult> {
    if (!session.address) throw new AdapterError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
    const addr = session.address;
    const [d, nowMs] = await read(() => Promise.all([
      reader.staking.delegationOf(addr) as Promise<{ unstakeReadyAt: bigint }>,
      chainNowMs(),
    ]));
    const readyAt = Number(d.unstakeReadyAt);
    if (readyAt === 0) throw withDetail(new AdapterError("TX_REVERTED", "No unstake is pending."), "No unstake is pending.");
    // Chain clock (M-8). The code set has no unstake-specific cooldown code;
    // the message says which cooldown it is (M-9 noted the unbond wording here).
    if (secToMs(readyAt) > nowMs) {
      const msg = `The ${PROTOCOL.UNSTAKE_COOLDOWN_DAYS}-day unstake cooldown has not finished yet.`;
      throw withDetail(new AdapterError("UNBOND_COOLDOWN_ACTIVE", msg), msg);
    }
    const signer = await requireSigner();
    const c = new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, signer);
    return submit(() => c.withdrawUnstaked() as Promise<TransactionResponse>);
  },

  async claimHcow(): Promise<TxResult> {
    const signer = await requireSigner();
    const c = new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, signer);
    return submit(() => c.claimHcow() as Promise<TransactionResponse>);
  },

  // ---------------------------------------------------------- testnet faucet

  /**
   * Attached only when an address is configured, so `adapter.faucet` is
   * undefined on a mainnet build and the UI renders nothing rather than a
   * button that cannot work.
   */
  faucet: faucetReader
    ? {
        async getStatus(): Promise<FaucetStatus> {
          // Reads for the zero address when disconnected, which still returns
          // the amounts and the remaining supply. The banner can then say what
          // the faucet offers before a wallet is attached.
          const who = session.address ?? "0x0000000000000000000000000000000000000000";
          const s = await read(() => faucetReader.status(who) as Promise<[
            bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
          ]>);
          const readyAt = Number(s[4]);
          return {
            hcowPerClaim: toAmount(s[0]),
            usdtPerClaim: toAmount(s[1]),
            hcowRemaining: toAmount(s[2]),
            usdtRemaining: toAmount(s[3]),
            // The contract returns 0 once the account may claim again.
            readyAt: readyAt > 0 ? secToMs(readyAt) : null,
            claimsLeft: Number(s[5]),
            // hcowNow / usdtNow: what a claim pays right now, per token. The
            // contract's own comment asks the UI to use these rather than
            // claimsLeft, which reads 0 while one side can still pay.
            hcowNow: toAmount(s[8]),
            usdtNow: toAmount(s[9]),
            // The faucet's shared per-window limit. When it is used up the
            // contract reports both sides as 0 although it still holds tokens.
            windowClaimsLeft: Number(s[6]),
            windowResetsAt: Number(s[7]) > 0 ? secToMs(s[7]) : null,
          };
        },

        async claim(): Promise<TxResult> {
          const signer = await requireSigner();
          const c = new Contract(DEPLOYMENT.addresses.faucet, FAUCET_ABI, signer);
          return submit(() => c.claim() as Promise<TransactionResponse>);
        },
      }
    : undefined,
};

// ============================================================
// TRANSACTION HISTORY MAPPING
// ============================================================

/**
 * Contract event to the lane the UI files it under. An event missing from
 * this map is skipped rather than shown as "unknown", because a history row
 * a user cannot interpret is worse than one fewer row.
 *
 * RewardsFunded, RepresentativeRegistered and the ownership events are
 * deliberately absent: they are protocol operations, not this user's actions.
 */
const EVENT_TO_TX: Record<string, TxType | undefined> = {
  Bonded: "bond",
  UnbondRequested: "request_unbond",
  UnbondCancelled: "cancel_unbond",
  Unbonded: "withdraw_unbonded",
  UsdtClaimed: "claim_usdt",
  Staked: "stake",
  Redelegated: "redelegate",
  UnstakeRequested: "request_unstake",
  UnstakeCancelled: "cancel_unstake",
  Unstaked: "withdraw_unstaked",
  RewardsClaimed: "claim_hcow",
};

const PROFIT_SHARE_TYPES = new Set<TxType>([
  "bond", "topup", "request_unbond", "cancel_unbond", "withdraw_unbonded",
  "claim_usdt", "epoch_settlement",
]);

const CLAIM_TYPES = new Set<TxType>(["claim_usdt", "claim_hcow"]);

function matchesFilter(type: TxType, filter: TxFilter): boolean {
  if (filter === "all") return true;
  if (filter === "claim") return CLAIM_TYPES.has(type);
  if (filter === "profit_share") return PROFIT_SHARE_TYPES.has(type);
  return !PROFIT_SHARE_TYPES.has(type);
}

/**
 * An indexed event is by definition already mined, so status is always
 * confirmed. Pending transactions are the write path's business, not history's.
 */
function toTransaction(row: ChainEventRow, type: TxType): Transaction | null {
  // The index is outside this app's trust boundary (audit 6, M-2). A row
  // without a usable hash, time or block is dropped rather than rendered as a
  // dead link or "Invalid Date". Nothing from here ever reaches a transaction.
  const timestamp = Date.parse(row.block_time);
  if (typeof row.tx_hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(row.tx_hash)) return null;
  if (!Number.isFinite(timestamp) || !Number.isFinite(row.block_number)) return null;
  const args = row.args ?? {};
  const raw = args.hcowAmount ?? args.amount ?? null;
  return {
    hash: row.tx_hash as Hex,
    type,
    status: "confirmed",
    timestamp,
    blockNumber: row.block_number,
    // An amount that is not a plain wei integer is shown as unknown, never as
    // 0: BigInt("") is 0n, so an empty string rendered a real bond as "0 HCOW".
    amount: raw === null ? null : weiFromIndex(raw) === null ? null : toAmount(weiFromIndex(raw) as bigint),
    // Only epoch_settlement rows carry a separate reward, and those are not
    // produced here yet. See CHAIN_ADAPTER_GAPS.
    rewardAmount: null,
    meta: {
      fromRepresentative: args.fromRep ? safeDecodeId(args.fromRep) : undefined,
      toRepresentative: args.toRep
        ? safeDecodeId(args.toRep)
        : args.repId
        ? safeDecodeId(args.repId)
        : undefined,
    },
  };
}

/**
 * A wei amount from the index, else null. The indexer stores event arguments
 * as decimal strings; anything else is not an amount.
 */
function weiFromIndex(v: unknown): bigint | null {
  return typeof v === "string" && /^[0-9]+$/.test(v) ? BigInt(v) : null;
}

// ============================================================
// REPRESENTATIVE ID HELPERS
// ============================================================

/**
 * The UI uses string ids such as "node-02". The contract keys on bytes32.
 * encodeBytes32String is the mapping, which caps an id at 31 bytes.
 */
function encodeId(id: string): string {
  try {
    return encodeBytes32String(id);
  } catch (e) {
    throw new AdapterError("INVALID_REPRESENTATIVE", `Representative id too long: ${id}`, e);
  }
}

function safeDecodeId(raw: string): string {
  try {
    return decodeBytes32String(raw);
  } catch {
    // An id registered as raw bytes rather than an encoded string still has to
    // render as something stable, so fall back to the hex.
    return raw;
  }
}

/** Fail before spending gas when the representative is unknown or inactive. */
async function assertRepresentativeUsable(id: string): Promise<void> {
  let r: { active: boolean };
  try {
    r = (await reader.staking.representativeOf(id)) as { active: boolean };
  } catch (e) {
    // Only the contract's own answer means "does not exist". Any other failure
    // is the network, and used to send the user off to pick another node that
    // was just as unreachable (audit 6, L-15).
    if ((e as ProviderErrorish).revert?.name === "UnknownRepresentative") {
      const msg = "That representative does not exist.";
      throw withDetail(new AdapterError("INVALID_REPRESENTATIVE", msg, e), msg);
    }
    throw mapRead(e);
  }
  if (!r.active) {
    const msg = "That representative is no longer active.";
    throw withDetail(new AdapterError("INVALID_REPRESENTATIVE", msg), msg);
  }
}
