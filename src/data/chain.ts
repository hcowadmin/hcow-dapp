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
 * numbers, this adapter returns zero, null or an empty list for those, and
 * every such field is listed in CHAIN_ADAPTER_GAPS below so the UI, and
 * anyone reading a screenshot, can tell a real zero from a missing one.
 *
 * The remaining gaps are genuinely off-chain and need the indexer:
 *   revenue and cost line items, the rolling gross-received windows, burn
 *   windows, transaction history, every APR figure, and the settlement tx hash.
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
  revenueWindows,
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
  chainId: session.chainId,
  balances: session.address ? { ...session.balances } : { ...ZERO_BALANCES },
});

const publish = () => {
  const s = snapshot();
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

async function adoptAccounts(accounts: string[]): Promise<void> {
  const next = accounts.length > 0 ? (accounts[0] as Address) : null;
  session.address = next;
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
  CooldownActive: { code: "UNBOND_COOLDOWN_ACTIVE", msg: "The 7 day cooldown has not finished." },
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
  if (name && REVERT_MAP[name]) {
    const m = REVERT_MAP[name];
    return new AdapterError(m.code, m.msg, e, txHash);
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
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new AdapterError("TX_TIMEOUT", "Still pending. It may yet confirm.", null, hash)),
      PROTOCOL.TX_TIMEOUT_MS
    );
  });

  try {
    const receipt = await Promise.race([tx.wait(1), timeout]);
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
  }
}

/** Approve exactly `amount` if the current allowance is short. Never unlimited. */
async function ensureAllowance(signer: Signer, spender: string, amount: bigint): Promise<void> {
  const owner = await signer.getAddress();
  const current = (await reader.hcow.allowance(owner, spender)) as bigint;
  if (current >= amount) return;
  const token = new Contract(DEPLOYMENT.addresses.hcow, ERC20_ABI, signer);
  await submit(() => token.approve(spender, amount) as Promise<TransactionResponse>);
}

// ============================================================
// EPOCH CACHE
// ============================================================

interface EpochBase {
  current: number;
  startsAt: number;
  endsAt: number;
  fetchedAt: number;
}
let epochCache: EpochBase | null = null;
const EPOCH_CACHE_MS = 15_000;

async function epochBase(): Promise<EpochBase> {
  const now = Date.now();
  if (epochCache && now - epochCache.fetchedAt < EPOCH_CACHE_MS) return epochCache;

  const next = Number((await reader.profitShare.nextEpoch()) as bigint);
  let startsAt = DEPLOYMENT.genesisMs;
  if (next > 0) {
    const prev = await reader.profitShare.getSettlement(next - 1);
    const settledAt = Number(prev.settledAt as bigint);
    if (settledAt > 0) startsAt = secToMs(settledAt);
  }
  epochCache = { current: next, startsAt, endsAt: startsAt + PROTOCOL.EPOCH_MS, fetchedAt: now };
  return epochCache;
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
    try {
      const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
      const chainHex = (await eth.request({ method: "eth_chainId" })) as string;
      session.chainId = Number(chainHex);
      session.address = accounts.length > 0 ? (accounts[0] as Address) : null;
      if (session.address) await refreshBalances();
      else session.balances = { ...ZERO_BALANCES };
    } catch {
      // Leave whatever we had. Never throw out of this method.
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
    const onBlock = () => {
      if (session.address) void refreshBalances().then(publish, () => undefined);
    };

    eth?.on?.("accountsChanged", onAccounts);
    eth?.on?.("chainChanged", onChain);
    readProvider.on("block", onBlock);

    // Rule F: fire once immediately, with fresh state rather than the cached
    // snapshot, so a page reload does not show a stale account.
    void chainAdapter.getWalletState().then((s) => {
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
    // Rule G. Cached; the countdown below is computed, not fetched.
    const base = await epochBase();
    const snapshotInMs = base.endsAt - Date.now();
    return {
      current: base.current,
      startsAt: base.startsAt,
      endsAt: base.endsAt,
      snapshotInMs,
      settling: snapshotInMs <= 0,
    };
  },

  async getLastEpochDistribution(): Promise<EpochDistribution | null> {
    const next = Number((await reader.profitShare.nextEpoch()) as bigint);
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
      hcowDeducted: bigint;
      snapshotBondedHcow: bigint;
      settledAt: bigint;
    };
    try {
      s = await reader.profitShare.getSettlement(epoch);
    } catch (e) {
      throw mapError(e);
    }
    if (Number(s.settledAt) === 0) return null;

    const gross = toAmount(s.grossReceivedUsdt);
    const direct = toAmount(s.directCostsUsdt);
    const opex = toAmount(s.operatingCostsUsdt);
    const profit = toAmount(s.distributableProfitUsdt);
    const participants = toAmount(s.participantsUsdt);

    // The contract splits the two 25% legs itself and rounds the remainder to
    // the team leg, so recomputing here would disagree by dust. Derive the
    // studio leg from the published bps and give the remainder to the other.
    const studio = (profit * PROTOCOL.DISTRIBUTION.GAME_STUDIO_PCT) / 100;
    const team = profit - participants - studio;

    const indexed = await settlementForEpoch(epoch);
    const txHash = (indexed?.[0]?.tx_hash ?? "") as Hex;

    return {
      epoch,
      settledAt: secToMs(s.settledAt),
      // From the EpochSettled event. Empty when the index is not configured
      // or has not caught up; the UI renders no link rather than a dead one.
      txHash,

      // Indexer gap. The contract stores the totals, not the line items.
      revenue: [],
      grossReceivedUsdt: gross,

      costs: [],
      directCostsUsdt: direct,
      netRevenueUsdt: gross - direct,

      operatingCostsUsdt: opex,
      // Structurally always zero: settleEpoch reverts above the cap, so an
      // over-cap epoch can never be recorded in the first place.
      operatingCostsAboveCapUsdt: 0,

      distributableProfitUsdt: profit,
      participantsUsdt: participants,
      gameStudioUsdt: studio,
      // NOTE: the interface calls this leg "foundation". The confirmed policy
      // is that it pays the project team. Renaming the field is a UI copy task.
      foundationUsdt: team,

      totalHcowDeducted: toAmount(s.hcowDeducted),
      snapshotBondedHcow: toAmount(s.snapshotBondedHcow),
      // Indexer gap. Requires the revenue lines to classify. Reported as 0
      // rather than 1 so an unproven epoch never looks fully verified.
      chainVerifiableRatio: 0,
    };
  },

  async getPoolStats(): Promise<PoolStats> {
    const [totalBonded, distributed, participants, windows] = await Promise.all([
      reader.profitShare.totalBondedHcow() as Promise<bigint>,
      reader.profitShare.totalUsdtDistributed() as Promise<bigint>,
      reader.profitShare.participantCount() as Promise<bigint>,
      revenueWindows(),
    ]);
    const w = windows?.[0] ?? null;

    return {
      totalBondedHcow: toAmount(totalBonded),
      // Accounts holding shares. A pending unbond is not counted, matching
      // the contract: money on its way out is not participating.
      participants: Number(participants),
      // Null by policy until the APR methodology is confirmed. The UI renders
      // a dash. Do not replace this with a computed guess.
      estimatedAprPct: null,
      // Rolling windows over EpochSettled. Receipt basis: an epoch's gross
      // lands in the window its settlement did, which is the same basis the
      // policy uses. Zero when the index is unavailable.
      grossReceivedUsdtToday: w ? toAmount(BigInt(w.gross_24h)) : 0,
      grossReceivedUsdt7d: w ? toAmount(BigInt(w.gross_7d)) : 0,
      grossReceivedUsdt30d: w ? toAmount(BigInt(w.gross_30d)) : 0,
      // Falls back to the lifetime total from the contract when there is no
      // index. Over the first 30 days those are the same number anyway.
      distributedToParticipantsUsdt30d: w
        ? toAmount(BigInt(w.participants_30d))
        : toAmount(distributed),
      revenue30dByOrigin: [],
      chainVerifiableRatio30d: 0,
      lastUpdatedAt: Date.now(),
    };
  },

  async getNetworkStats(): Promise<NetworkStats> {
    const [counts, block] = await Promise.all([
      reader.staking.representativeCount() as Promise<[bigint, bigint]>,
      readProvider.getBlock("latest"),
    ]);
    const total = Number(counts[0]);
    const active = Number(counts[1]);
    return {
      activeRepresentatives: active,
      totalRepresentatives: total,
      // Deliberately crude: this reflects registry state, not validator uptime,
      // because nothing here runs validators. Real health needs monitoring.
      networkStatus: active === 0 ? "down" : active < total ? "degraded" : "healthy",
      lastBlockAt: block ? secToMs(block.timestamp) : Date.now(),
    };
  },

  async getBurnStats(): Promise<BurnStats> {
    const [supply, deducted, windows] = await Promise.all([
      reader.hcow.totalSupply() as Promise<bigint>,
      reader.profitShare.totalHcowDeducted() as Promise<bigint>,
      revenueWindows(),
    ]);
    const w = windows?.[0] ?? null;
    const circulating = toAmount(supply);
    // HCOW is fixed supply with no mint, so anything missing from totalSupply
    // was burned. This holds for the profit-share deduction burn and for any
    // other burn path, which is why it is derived rather than read from a
    // per-path counter.
    const burned = Math.max(0, PROTOCOL.TOKEN_TOTAL_SUPPLY - circulating);

    return {
      totalBurnedHcow: burned,
      burnedToday: w ? toAmount(BigInt(w.burned_24h)) : 0,
      // Deduction happens at settlement, so the in-flight epoch has burned
      // nothing yet by construction. This is a real zero, not a missing one.
      burnedThisEpoch: 0,
      percentOfSupply: (burned / PROTOCOL.TOKEN_TOTAL_SUPPLY) * 100,
      // No transaction-fee burn path exists on this token. Structurally zero.
      last30dTxFeeBurn: 0,
      last30dGamePaymentBurn: w ? toAmount(BigInt(w.burned_30d)) : toAmount(deducted),
    };
  },

  async getBondedPosition(): Promise<BondedPosition> {
    if (!session.address) {
      throw new AdapterError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
    }
    const addr = session.address;
    const [account, claimable, totalBonded, lifetime] = await Promise.all([
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
    ]);

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
      estimatedEpochUsdt: 0,
      pendingUnbondAmount: pending > 0 ? pending : null,
      // Rule H. Chain value, never Date.now() + cooldown.
      pendingUnbondReadyAt: readyAt > 0 ? secToMs(readyAt) : null,
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
    const d = (await reader.staking.delegationOf(session.address)) as {
      repId: string;
      stakedAmount: bigint;
      pendingUnstake: bigint;
      unstakeReadyAt: bigint;
      pendingReward: bigint;
      lifetimeClaimed: bigint;
    };

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
      pendingUnstakeReadyAt: readyAt > 0 ? secToMs(readyAt) : null,
      pendingRewardHcow: toAmount(d.pendingReward),
      lifetimeRewardHcow: toAmount(d.lifetimeClaimed),
    };
  },

  async getRepresentatives(): Promise<Representative[]> {
    const ids = (await reader.staking.representativeIds()) as string[];
    const rows = await Promise.all(
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
    );
    return rows;
  },

  async getTxHistory(filter: TxFilter = "all"): Promise<Transaction[]> {
    // Deliberately not done with eth_getLogs from the browser: an unbounded
    // multi-topic scan over a growing range is rate limited into failure on
    // public BSC RPCs. The worker walks the chain once; this reads a table.
    if (!session.address || !indexerConfigured()) return [];

    const rows = await eventsForAccount(session.address, 100);
    if (!rows) return [];

    const out: Transaction[] = [];
    for (const row of rows) {
      const type = EVENT_TO_TX[row.event];
      if (!type) continue;               // protocol events with no user lane
      if (!matchesFilter(type, filter)) continue;
      out.push(toTransaction(row, type));
    }
    return out;
  },

  // ---------------------------------------------------------- write: profit share

  async bond(amount: Amount): Promise<TxResult> {
    const signer = await requireSigner();
    const wei = toWei(amount);
    await ensureAllowance(signer, DEPLOYMENT.addresses.profitShare, wei);

    const c = new Contract(DEPLOYMENT.addresses.profitShare, PROFIT_SHARE_ABI, signer);
    const result = await submit(() => c.bond(wei) as Promise<TransactionResponse>);

    epochCache = null;
    const next = Number((await reader.profitShare.nextEpoch()) as bigint);
    return { ...result, effectiveEpoch: next };
  },

  async topUpBond(amount: Amount): Promise<TxResult> {
    // Same contract call. Split only so the UI can use different copy.
    return chainAdapter.bond(amount);
  },

  async requestUnbond(amount: Amount): Promise<TxResult> {
    const signer = await requireSigner();
    const c = new Contract(DEPLOYMENT.addresses.profitShare, PROFIT_SHARE_ABI, signer);
    return submit(() => c.requestUnbond(toWei(amount)) as Promise<TransactionResponse>);
  },

  async cancelUnbond(): Promise<TxResult> {
    const signer = await requireSigner();
    const c = new Contract(DEPLOYMENT.addresses.profitShare, PROFIT_SHARE_ABI, signer);
    return submit(() => c.cancelUnbond() as Promise<TransactionResponse>);
  },

  async withdrawUnbonded(): Promise<TxResult> {
    if (!session.address) throw new AdapterError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
    // Re-verify against chain state before spending gas on a certain revert.
    const account = (await reader.profitShare.accountOf(session.address)) as { unbondReadyAt: bigint };
    const readyAt = Number(account.unbondReadyAt);
    if (readyAt === 0) {
      throw new AdapterError("TX_REVERTED", "No unbond is pending.");
    }
    if (secToMs(readyAt) > Date.now()) {
      throw new AdapterError("UNBOND_COOLDOWN_ACTIVE", "The 7 day cooldown has not finished.");
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
    await assertRepresentativeUsable(id);

    const wei = toWei(amount);
    await ensureAllowance(signer, DEPLOYMENT.addresses.staking, wei);

    const c = new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, signer);
    return submit(() => c.stake(wei, id) as Promise<TransactionResponse>);
  },

  async redelegate(toRepresentativeId: string): Promise<TxResult> {
    const signer = await requireSigner();
    const id = encodeId(toRepresentativeId);
    await assertRepresentativeUsable(id);
    const c = new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, signer);
    return submit(() => c.redelegate(id) as Promise<TransactionResponse>);
  },

  async requestUnstake(amount: Amount): Promise<TxResult> {
    const signer = await requireSigner();
    const c = new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, signer);
    return submit(() => c.requestUnstake(toWei(amount)) as Promise<TransactionResponse>);
  },

  async cancelUnstake(): Promise<TxResult> {
    const signer = await requireSigner();
    const c = new Contract(DEPLOYMENT.addresses.staking, STAKING_ABI, signer);
    return submit(() => c.cancelUnstake() as Promise<TransactionResponse>);
  },

  async withdrawUnstaked(): Promise<TxResult> {
    if (!session.address) throw new AdapterError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
    const d = (await reader.staking.delegationOf(session.address)) as { unstakeReadyAt: bigint };
    const readyAt = Number(d.unstakeReadyAt);
    if (readyAt === 0) throw new AdapterError("TX_REVERTED", "No unstake is pending.");
    if (secToMs(readyAt) > Date.now()) {
      throw new AdapterError("UNBOND_COOLDOWN_ACTIVE", "The 7 day cooldown has not finished.");
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
          const s = (await faucetReader.status(who)) as [
            bigint, bigint, bigint, bigint, bigint, bigint,
          ];
          const readyAt = Number(s[4]);
          return {
            hcowPerClaim: toAmount(s[0]),
            usdtPerClaim: toAmount(s[1]),
            hcowRemaining: toAmount(s[2]),
            usdtRemaining: toAmount(s[3]),
            readyAt: readyAt > 0 ? secToMs(readyAt) : null,
            claimsLeft: Number(s[5]),
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
function toTransaction(row: ChainEventRow, type: TxType): Transaction {
  const raw = row.args.hcowAmount ?? row.args.amount ?? null;
  return {
    hash: row.tx_hash as Hex,
    type,
    status: "confirmed",
    timestamp: new Date(row.block_time).getTime(),
    blockNumber: row.block_number,
    amount: raw === null ? null : toAmount(BigInt(raw)),
    // Only epoch_settlement rows carry a separate reward, and those are not
    // produced here yet. See CHAIN_ADAPTER_GAPS.
    rewardAmount: null,
    meta: {
      fromRepresentative: row.args.fromRep ? safeDecodeId(row.args.fromRep) : undefined,
      toRepresentative: row.args.toRep
        ? safeDecodeId(row.args.toRep)
        : row.args.repId
        ? safeDecodeId(row.args.repId)
        : undefined,
    },
  };
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
  } catch {
    throw new AdapterError("INVALID_REPRESENTATIVE", "That representative does not exist.");
  }
  if (!r.active) {
    throw new AdapterError("INVALID_REPRESENTATIVE", "That representative is no longer active.");
  }
}
