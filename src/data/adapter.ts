/**
 * HCOW dApp — Data Adapter Interface  v0.4
 *
 * SINGLE SOURCE OF TRUTH for the boundary between the frontend and every
 * data source (BSC contracts, indexer, backend API, VegasLedger bridge).
 *
 * Frontend code MUST go through this interface. It must never call a wallet,
 * a contract, or an HTTP endpoint directly.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED IN v0.3 AND v0.4  (supersedes the v0.4 code package and Data Spec v0.2)
 * ---------------------------------------------------------------------------
 *  1. AdapterErrorCode unified to the 12 spec names. WRONG_CHAIN -> WRONG_NETWORK,
 *     UNKNOWN -> UNKNOWN_ERROR, COOLDOWN_ACTIVE -> UNBOND_COOLDOWN_ACTIVE.
 *     Removed AMOUNT_OUT_OF_RANGE (client-side validation) and NOT_IN_COOLDOWN
 *     and INSUFFICIENT_USDT_IN_POOL (both surface as TX_REVERTED with a reason).
 *  2. cancelUnstake() added. Staking lane is now symmetric with the Profit Share lane.
 *  3. shareOfPool is a RATIO 0..1, never a percentage. See the field comment.
 *  4. TxType is 13 values. cancel_unbond / cancel_unstake / withdraw_unstaked
 *     added. The pseudo-type "failed" removed; failure lives in status.
 *  5. LaneStatus split into BondedStatus and StakedStatus.
 *  6. Representative.status is active | warning | inactive, plus estimatedAprPct.
 *  7. WalletState.address is string | null (never undefined, never stale).
 *     balances is required and must be zeroed when disconnected.
 *  8. Read methods no longer take an address. The adapter owns the current account.
 *  9. getNetworkStats() and getLastEpochDistribution() added.
 * 10. BurnStats split by burn source.
 * 11. TxResult.blockNumber required on confirm. AdapterError carries cause.
 * 12. EpochInfo -> Epoch, TxHistoryItem -> Transaction.
 * 13. v0.4: distribution is NET PROFIT, not revenue. Product renamed to
 *     Profit Share. The full epoch waterfall is published via
 *     EpochDistribution. The opex cap, the closed cost list, and the
 *     no-distribution-no-deduction rule are now part of the contract.
 * 14. v0.4.1 (audit 6, C-1 and C-2): three fields can now say "not measured".
 *     EpochDistribution.chainVerifiableRatio, PoolStats.chainVerifiableRatio30d
 *     and PoolStats.revenue30dByOrigin are nullable. null means the data source
 *     does not exist yet (the revenue index); it is NOT zero and must never be
 *     rendered as 0% or as "nothing was received". An empty revenue30dByOrigin
 *     array still means "measured, and nothing arrived". Same pattern as
 *     estimatedAprPct. The interface could not express "unknown" before, so the
 *     chain adapter reported 0 and [] and the UI turned those into statements
 *     of fact. This edit is the interface owner's decision of 2026-09-22.
 *
 * 15. v0.4.2 (audit 6, M-5, L-8, L-16 and the 30d fallbacks): the same rule
 *     for the remaining gaps. null means "not measured", never zero or none:
 *     BondedPosition.estimatedEpochUsdt (no forecast backend yet),
 *     EpochDistribution.revenue and .costs (line items are off-chain records,
 *     not events), PoolStats.grossReceivedUsdtToday / 7d / 30d and
 *     distributedToParticipantsUsdt30d (need the event index; the last one
 *     used to fall back to the lifetime total under a "30d" label), and
 *     getTxHistory() when the index is not configured or cannot be read.
 *     [] and 0 keep their meaning: measured, and nothing there.
 *
 * 16. v0.4.3 (audit 6, H-1 residual): new AdapterErrorCode ACCOUNT_CHANGED.
 *     A write MUST NOT be signed by an account the UI has not been shown yet.
 *     The chain adapter adopts a new account before it can publish it (it
 *     reads the balances first), and in that window a confirm pressed on a
 *     screen still showing the previous account would be signed by the new
 *     one, skipping that account's first-bond acknowledgement. Writes now
 *     refuse with ACCOUNT_CHANGED in that window, before anything is sent.
 *
 * 17. v0.4.4 (audit 6, H-3): Epoch loses endsAt, snapshotInMs and settling.
 *     They described a schedule the contract does not have: endsAt was
 *     startsAt + 7 days computed in the browser, and once it passed the UI
 *     said "Settling..." indefinitely while nothing happened on chain. The
 *     epoch now carries only chain facts: startsAt (lastSettledAt, or
 *     deployedAt before the first settlement) and earliestSettlementAt
 *     (lastSettledAt + MIN_EPOCH_INTERVAL, read from the contract), plus
 *     stallDeadlineAt (epochStallDeadline()), after which anyone may close the
 *     epoch with no payout.
 *
 * 18. v0.4.5 (audit 6, H-4, H-6, M-7, M-8, faucet): additions only, nothing
 *     removed.
 *     - AdapterError.approvalHash: set when a bond or stake confirmed its
 *       approval transaction and the step after it then failed. The approval
 *       stays on chain, so the UI must not say "Nothing was sent".
 *     - Read methods throw AdapterError. A failure to reach or read the chain
 *       is RPC_ERROR, not a raw provider error (it rendered as "Something went
 *       wrong" at the most common failure point, page load).
 *     - pendingUnbondAmount is what the pending unbond would pay out now
 *       (pendingUnbondOf), which can be below the amount requested: a
 *       pending unbond is charged for at most one settlement.
 *     - pendingUnbondReadyAt and pendingUnstakeReadyAt are the chain's time
 *       carried onto this browser's clock when that clock runs ahead, so a
 *       countdown computed with Date.now() cannot finish before the chain's.
 *     - AdapterError.detail: the specific reason, for the UI to show.
 *     - FaucetStatus.hcowNow / usdtNow: what a claim would pay right now;
 *       windowClaimsLeft / windowResetsAt: the shared per-window limit.
 *     - bond, stake, requestUnbond and requestUnstake sign the exact on-chain
 *       balance when the amount is that balance as displayed (a JS number can
 *       read a few wei above it), and refuse any other amount above it before
 *       anything is sent.
 *     - getWalletState returns disconnected, never the previous address, when
 *       the wallet cannot be read; chainId is null whenever connected is false.
 *
 * 19. v0.4.6 (audit 6, H-8, M-3, M-4): BurnStats describes the burn that exists
 *     (see the type). bond() refuses, before anything is sent, when the
 *     deduction limits the page states differ from the contract's, because
 *     those numbers are what the first-bond acknowledgement asks a user to
 *     accept.
 *
 * ---------------------------------------------------------------------------
 * DISTRIBUTION POLICY  v0.4   (read before implementing any money field)
 * ---------------------------------------------------------------------------
 *  WHAT IS DISTRIBUTED
 *    Net profit, not revenue. The product name is Profit Share.
 *    Nothing in the UI may be labelled "Revenue Share".
 *
 *  THE WATERFALL, in order. Every step is a field on EpochDistribution so the
 *  whole thing can be published each epoch.
 *
 *      grossReceivedUsdt       money actually received into the vault
 *    - directCostsUsdt         platform fees, payment processing, FX and
 *                              stablecoin conversion, transaction-level taxes
 *    = netRevenueUsdt
 *    - operatingCostsUsdt      the CLOSED list in CostCategory, capped at
 *                              OPEX_CAP_PCT of netRevenueUsdt
 *    = distributableProfitUsdt
 *      split 50 participants / 25 game studio / 25 project team
 *
 *  FOUR RULES THAT MAKE A NET-PROFIT SPLIT DEFENSIBLE. All load-bearing.
 *
 *   1. OPERATING COSTS ARE CAPPED. Deductible opex may not exceed
 *      OPEX_CAP_PCT of netRevenueUsdt. Anything above the cap is absorbed by
 *      the studio and team shares, never by the participant share.
 *      This converts an unbounded discretionary deduction into a bounded one.
 *
 *   2. THE COST LIST IS CLOSED. Only CostCategory values may be deducted.
 *      An open list makes the cap meaningless.
 *
 *   3. CAPITAL AND FINANCING ITEMS ARE NEVER OPERATING COSTS. Exchange
 *      listing fees, liquidity provision, token buybacks, fundraising legal
 *      fees, M&A, and related-party compensation above a stated cap are
 *      excluded by definition. This is where this model actually gets abused,
 *      so it is stated rather than implied.
 *
 *   4. NO DISTRIBUTION, NO DEDUCTION. Bonded principal is deducted in
 *      proportion to RNG and VRF usage. If an epoch produces
 *      distributableProfitUsdt <= 0, deduction MUST NOT run for that epoch.
 *      When profit is positive, deduction scales with the actual distribution.
 *      Without this rule a user loses principal and receives nothing, which is
 *      the default outcome in the first months of operation.
 *      Enforce at the contract level, not in the UI.
 *
 *  RECEIPT BASIS, NOT ACCRUAL BASIS. Only USDT actually received during an
 *  epoch is distributed in that epoch. Apple and Google settle monthly, 30 to
 *  45 days after month end, so store revenue earned in epoch N lands in epoch
 *  N+4 or later. Do not pre-fund from treasury to smooth this.
 *
 *  PROVABILITY. Two classes. The UI must separate them visually.
 *    onchain_native    HCOW spent in game, settled on BSC. Fully verifiable.
 *                      50 percent of it is burned.
 *    offchain_settled  Everything received off chain: table game fees, Apple App
 *                      Store, Google Play, ad networks. NOT verifiable on
 *                      chain. Attested by a published payout statement paired
 *                      with the on-chain deposit tx that carried it in.
 *
 *  HYPERLEDGER FABRIC IS THE RNG AND VRF VERIFICATION LEDGER ONLY. It holds
 *  no revenue records. It is the input to DEDUCTION metering, not to
 *  distribution. There is no Fabric to BSC revenue bridge.
 * ---------------------------------------------------------------------------
 */

// ============================================================
// SHARED PRIMITIVES
// ============================================================

/** 0x-prefixed EVM address, checksummed. */
export type Address = string;

/** 0x-prefixed hex string. */
export type Hex = string;

/**
 * Human-readable token amount, NOT wei.
 * The adapter is the only place allowed to convert to and from 10^18 base units.
 * Never do arithmetic on these values that must be exact; they are for display
 * and for passing back into adapter methods only.
 */
export type Amount = number;

/** Unix milliseconds. */
export type Timestamp = number;

/** A fraction in the range 0..1. 0.196 means 19.6 percent. */
export type Ratio = number;

/** A percentage in the range 0..100. 19.6 means 19.6 percent. */
export type Percent = number;

export type WalletProvider = "metamask" | "walletconnect";

// ============================================================
// WALLET
// ============================================================

export interface WalletBalances {
  hcow: Amount;
  bnb: Amount;
  usdt: Amount;
}

export interface WalletState {
  connected: boolean;
  /** MUST be null when connected is false. Never return a stale address. */
  address: Address | null;
  /** MUST be null when connected is false. */
  chainId: number | null;
  /** Required. Zero-filled when disconnected. Never undefined. */
  balances: WalletBalances;
}

// ============================================================
// EPOCH
// ============================================================

/**
 * v0.4.4 (audit 6, H-3). HCOWProfitShare counts epochs but does not schedule
 * them: an epoch ends when the settler submits a settlement, and the contract
 * only enforces a minimum interval (MIN_EPOCH_INTERVAL) since the last one.
 * There is no end time to count down to and nothing is "settling" on chain
 * between settlements, so this type no longer claims either.
 */
export interface Epoch {
  current: number;
  /** When this epoch opened: the last settlement's time, or the contract's deployment. Chain values. */
  startsAt: Timestamp;
  /**
   * Earliest time the contract accepts the next settlement
   * (lastSettledAt + MIN_EPOCH_INTERVAL). null before the first settlement,
   * when the contract accepts one at any time. A lower bound, never a
   * deadline: the payout snapshot is taken when the settlement is submitted.
   */
  earliestSettlementAt: Timestamp | null;
  /**
   * From this time anyone may close the open epoch with every figure at zero
   * (closeStalledEpoch): no revenue, no payout, no deduction. The contract's
   * epochStallDeadline(). Shown so a missed settlement is visible in advance.
   */
  stallDeadlineAt: Timestamp;
}

/* EpochSettlement removed in v0.4. Superseded by EpochDistribution, which
   carries the full published waterfall rather than only the totals. */

// ============================================================
// MONEY: SOURCES, COSTS, AND THE EPOCH WATERFALL
// ============================================================

/** Governance constant. Deductible opex ceiling as a share of net revenue. */
export const OPEX_CAP_PCT = 40;

export type RevenueClass = "onchain_native" | "offchain_settled";

export type RevenueOrigin =
  | "in_game_hcow"
  | "table_game_fees"
  | "apple_app_store"
  | "google_play"
  | "ad_network"
  | "b2b_licensing"
  | "other";

export interface RevenueLine {
  origin: RevenueOrigin;
  cls: RevenueClass;
  /** Gross received, in USDT terms, before any deduction. */
  grossUsdt: Amount;
  /** True only for onchain_native. Drives the UI trust badge. */
  chainVerifiable: boolean;
  /** Published payout statement. Required when chainVerifiable is false. */
  attestationUrl: string | null;
  /** On-chain deposit that carried this money into the vault. */
  depositTxHash: Hex | null;
}

/**
 * Closed list. Anything not here may not be deducted.
 * The first four are direct costs and are NOT subject to the opex cap.
 * The rest are operating costs and ARE subject to it.
 */
export type CostCategory =
  | "platform_fee"          // Apple, Google, ad network take rate
  | "payment_processing"
  | "fx_and_conversion"     // fiat to USDT, including slippage
  | "transaction_tax"       // VAT, GST, withholding attributable to the revenue
  | "infrastructure"        // servers, RPC, storage, third-party services
  | "personnel"
  | "marketing"
  | "game_content"          // art, audio, external production for live titles
  | "support_and_ops";

export interface CostLine {
  category: CostCategory;
  amountUsdt: Amount;
  /** True for the four direct-cost categories. */
  isDirect: boolean;
  note: string | null;
}

/**
 * The full published waterfall for one epoch. Every field is rendered.
 * Publishing this in full each epoch is what keeps the discretion visible.
 */
export interface EpochDistribution {
  epoch: number;
  settledAt: Timestamp;
  txHash: Hex;

  /** Line items. null when not published yet (v0.4.2); the totals below still come from the chain. */
  revenue: RevenueLine[] | null;
  grossReceivedUsdt: Amount;

  /** Line items. null when not published yet (v0.4.2). */
  costs: CostLine[] | null;
  directCostsUsdt: Amount;
  netRevenueUsdt: Amount;

  /** After the cap has been applied. */
  operatingCostsUsdt: Amount;
  /** Opex incurred above the cap. Absorbed by studio and project team. */
  operatingCostsAboveCapUsdt: Amount;

  distributableProfitUsdt: Amount;

  participantsUsdt: Amount;   // 50
  gameStudioUsdt: Amount;     // 25
  /** The contract calls this leg `team`. It pays the project team, not a foundation. */
  teamUsdt: Amount;           // 25

  /**
   * Total HCOW deducted from bonded principal this epoch.
   * MUST be 0 when distributableProfitUsdt <= 0. See rule 4.
   */
  totalHcowDeducted: Amount;
  /** Denominator for every participant share this epoch. */
  snapshotBondedHcow: Amount;
  /**
   * Share of grossReceivedUsdt that was chain verifiable. Ratio 0..1.
   * null when not measured (v0.4.1). The UI renders a dash and
   * "Measurement pending", never 0%.
   */
  chainVerifiableRatio: Ratio | null;
}

// ============================================================
// PROFIT SHARE  (BONDED DEPOSIT)
// ============================================================

export type BondedStatus = "first_time" | "active" | "cooldown" | "exhausted";

export interface BondedPosition {
  status: BondedStatus;
  bondedAmount: Amount;
  /** Ratio 0..1. Multiply by 100 for display. Floor tiny values at "< 0.01%". */
  shareOfPool: Ratio;
  /**
   * Forecast for the in-flight epoch. Backend-computed, not a contract read.
   * null until that backend exists (v0.4.2). Never render null as 0.
   */
  estimatedEpochUsdt: Amount | null;
  /**
   * null when no unbond is pending. Never undefined. What the pending unbond
   * would pay out now (pendingUnbondOf), after the deduction it has sat
   * through: at most one settlement's, so it can be below the amount
   * requested (v0.4.5).
   */
  pendingUnbondAmount: Amount | null;
  /**
   * Chain-authoritative: unbondReadyAt from the contract, never Date.now() +
   * cooldown. Carried onto this browser's clock when the clock runs ahead of
   * the chain, so a local countdown cannot reach zero early (v0.4.5, M-8).
   */
  pendingUnbondReadyAt: Timestamp | null;
  pendingClaimUsdt: Amount;
  lifetimeDeductedHcow: Amount;
  lifetimeClaimedUsdt: Amount;
}

export interface PoolStats {
  totalBondedHcow: Amount;
  participants: number;
  /**
   * Null until the APR methodology is confirmed. The UI renders a dash, never
   * a fabricated number. Whenever this is non-null the UI must render the
   * "Based on last epoch. Not guaranteed." disclaimer beside it.
   */
  estimatedAprPct: Percent | null;
  /**
   * Gross received. Rolling 24h, not calendar day. Summed from the
   * contract's settlement records (2026-09-24; previously the event index).
   * null when those reads fail (v0.4.2). 0 means measured, and nothing arrived.
   */
  grossReceivedUsdtToday: Amount | null;
  grossReceivedUsdt7d: Amount | null;
  grossReceivedUsdt30d: Amount | null;
  /**
   * Allocated to participants by settlements in the last 30 days, from the
   * contract's settlement records. null when those reads fail (v0.4.2).
   * Never substitute the lifetime total under this label.
   */
  distributedToParticipantsUsdt30d: Amount | null;
  /**
   * Breakdown of grossReceivedUsdt30d by origin. Must sum to it.
   * null when not measured (v0.4.1); [] only when measured and nothing arrived.
   */
  revenue30dByOrigin: RevenueLine[] | null;
  /**
   * Share of the last 30d gross that was chain verifiable. Ratio 0..1.
   * null when not measured (v0.4.1). Never render null as 0%.
   */
  chainVerifiableRatio30d: Ratio | null;
  /** Data freshness signal for the rollups above. */
  lastUpdatedAt: Timestamp;
}

// ============================================================
// NETWORK STAKING  (DPoS)
// ============================================================

export type StakedStatus = "first_time" | "active" | "cooldown";

export type RepresentativeStatus = "active" | "warning" | "inactive";

export interface Representative {
  id: string;
  name: string;
  address: Address;
  isFoundation: boolean;
  /** 0..100. Contract-level cap is 10. */
  commissionPct: Percent;
  totalDelegatedHcow: Amount;
  delegatorCount: number;
  status: RepresentativeStatus;
  /** Null until APR methodology is confirmed. */
  estimatedAprPct: Percent | null;
  uptimeLast30dPct: Percent | null;
}

export interface StakedPosition {
  status: StakedStatus;
  stakedAmount: Amount;
  /** Representative id. null when nothing is delegated. */
  delegatedTo: string | null;
  estimatedAprPct: Percent | null;
  pendingUnstakeAmount: Amount | null;
  /** As pendingUnbondReadyAt: chain value, carried onto this browser's clock when it runs ahead. */
  pendingUnstakeReadyAt: Timestamp | null;
  pendingRewardHcow: Amount;
  lifetimeRewardHcow: Amount;
}

export interface NetworkStats {
  activeRepresentatives: number;
  totalRepresentatives: number;
  networkStatus: "healthy" | "degraded" | "down";
  lastBlockAt: Timestamp;
}

// ============================================================
// TRANSACTIONS
// ============================================================

export type TxType =
  // Profit Share lane
  | "bond"
  | "topup"
  | "request_unbond"
  | "cancel_unbond"
  | "withdraw_unbonded"
  | "claim_usdt"
  // Network Staking lane
  | "stake"
  | "redelegate"
  | "request_unstake"
  | "cancel_unstake"
  | "withdraw_unstaked"
  | "claim_hcow"
  // Protocol event, not user-initiated
  | "epoch_settlement";

export type TxStatus = "pending" | "confirmed" | "failed" | "auto";

/** "profit_share" replaces the old "revenue_share" id. */
export type TxFilter = "all" | "profit_share" | "network_staking" | "claim";

export interface Transaction {
  hash: Hex;
  type: TxType;
  status: TxStatus;
  timestamp: Timestamp;
  blockNumber: number | null;
  /** For epoch_settlement this is the HCOW deducted from this user. */
  amount: Amount | null;
  /** For epoch_settlement this is the USDT received by this user. */
  rewardAmount: Amount | null;
  meta: {
    fromRepresentative?: string;
    toRepresentative?: string;
    failureReason?: string;
    /** For epoch_settlement rows. Denominator used for this user's share. */
    snapshotBondedHcow?: Amount;
    effectiveEpoch?: number;
  };
}

export interface TxResult {
  hash: Hex;
  confirmed: boolean;
  /** Required once confirmed is true. */
  blockNumber: number | null;
  failureReason: string | null;
  /** For bond and topup: the epoch the position takes effect in. */
  effectiveEpoch: number | null;
}

// ============================================================
// BURN  (supply level, never a user balance)
// ============================================================

/**
 * v0.4.6 (audit 6, M-3 and M-4). The only burn in the system is HCOW sent to
 * the burn address by HCOWProfitShare: deductions at settlement, and HCOW
 * forfeited by a pending position when it leaves. HCOWToken says so in its
 * published source and says the 20% fee burn and 50% native payment burn of
 * older documents are not implemented anywhere. (A holder can still burn
 * their own HCOW with ERC20Burnable.burn(); that is counted too.) The fields that described
 * them (last30dTxFeeBurn, last30dGamePaymentBurn under a "50%" label,
 * burnedThisEpoch) are removed rather than reported as zero.
 */
export interface BurnStats {
  /**
   * balanceOf(BURN_ADDRESS), plus INITIAL_SUPPLY minus totalSupply() when the
   * token publishes INITIAL_SUPPLY. The protocol burns by transfer to 0x...dEaD,
   * which does not reduce totalSupply(), so the old 200,000,000 minus
   * totalSupply() read 0 after any number of deductions (M-3). HCOWToken is
   * also ERC20Burnable, and a holder's own burn() does reduce totalSupply();
   * the second term counts that (review F5).
   */
  totalBurnedHcow: Amount;
  /**
   * The supply percentOfSupply is taken of: the token's INITIAL_SUPPLY when it
   * publishes one (HCOWToken does), otherwise totalSupply() as read. Never a
   * hardcoded 200,000,000.
   */
  supplyBaseHcow: Amount;
  /**
   * Whether totalBurnedHcow includes holders' own burn() calls. False on a
   * token without INITIAL_SUPPLY (the testnet stand-in), where only the burn
   * address can be counted.
   */
  countsHolderBurns: boolean;
  /** totalBurnedHcow / supplyBaseHcow * 100. */
  percentOfSupply: Percent;
  /**
   * HCOW deducted by settlements recorded in the last 24 hours / 30 days,
   * summed from the contract's settlement records. null when those reads
   * fail: never the lifetime total under a 30-day label (M-4).
   */
  deductedAtSettlement24h: Amount | null;
  deductedAtSettlement30d: Amount | null;
}

// ============================================================
// THE ADAPTER
// ============================================================

/**
 * Test faucet state. Testnet only. See IHcowAdapter.faucet.
 */
export interface FaucetStatus {
  /** Amount handed out per claim. */
  hcowPerClaim: Amount;
  usdtPerClaim: Amount;
  /** What the faucet still holds. */
  hcowRemaining: Amount;
  usdtRemaining: Amount;
  /** null when the account may claim now. */
  readyAt: Timestamp | null;
  /** How many more claims the faucet can serve before it runs dry. */
  claimsLeft: number;
  /**
   * What a claim would actually pay this account right now, per token (v0.4.5).
   * The two sides are paid independently, so claimsLeft can read 0 while a
   * claim would still pay one of them. 0 while readyAt is set.
   */
  hcowNow: Amount;
  usdtNow: Amount;
  /**
   * Claims left in the faucet's shared window, for everyone. At 0 the contract
   * reports hcowNow and usdtNow as 0 while it still holds tokens; claims
   * reopen at windowResetsAt (null when no window is running).
   */
  windowClaimsLeft: number;
  windowResetsAt: Timestamp | null;
}

export interface IHcowAdapter {
  // ---- WALLET ----
  getWalletState(): Promise<WalletState>;
  connectWallet(provider: WalletProvider): Promise<WalletState>;
  disconnectWallet(): Promise<void>;
  /**
   * Event-based subscription. MUST fire once immediately on subscribe, then on
   * every account change, chain change and balance change.
   * Returns the unsubscribe function.
   * This replaces polling. The UI must not poll wallet state on an interval.
   */
  subscribeWallet(cb: (state: WalletState) => void): () => void;

  // ---- READ ----
  /** Called on a 1s cadence for the countdown. MUST be cached, no RPC per call. */
  getEpoch(): Promise<Epoch>;
  getLastEpochDistribution(): Promise<EpochDistribution | null>;
  getEpochDistribution(epoch: number): Promise<EpochDistribution | null>;
  getPoolStats(): Promise<PoolStats>;
  getNetworkStats(): Promise<NetworkStats>;
  getBurnStats(): Promise<BurnStats>;
  /** Uses the currently connected account. Throws WALLET_NOT_CONNECTED if none. */
  getBondedPosition(): Promise<BondedPosition>;
  getStakedPosition(): Promise<StakedPosition>;
  getRepresentatives(): Promise<Representative[]>;
  /**
   * null when the event index is not configured or cannot be read (v0.4.2):
   * "history unavailable", not "no transactions". [] means read and empty,
   * or no wallet connected.
   */
  getTxHistory(filter?: TxFilter): Promise<Transaction[] | null>;

  // ---- WRITE: PROFIT SHARE ----
  bond(amount: Amount): Promise<TxResult>;
  topUpBond(amount: Amount): Promise<TxResult>;
  requestUnbond(amount: Amount): Promise<TxResult>;
  cancelUnbond(): Promise<TxResult>;
  withdrawUnbonded(): Promise<TxResult>;
  claimUsdt(): Promise<TxResult>;

  // ---- WRITE: NETWORK STAKING ----
  stake(amount: Amount, representativeId: string): Promise<TxResult>;
  redelegate(toRepresentativeId: string): Promise<TxResult>;
  requestUnstake(amount: Amount): Promise<TxResult>;
  cancelUnstake(): Promise<TxResult>;
  withdrawUnstaked(): Promise<TxResult>;
  claimHcow(): Promise<TxResult>;

  // ---- TESTNET ONLY ----
  /**
   * Present only on a build pointed at a test deployment with a faucet
   * configured. Absent on mainnet, and the UI must treat absence as "there is
   * no faucet" rather than as an error. Nothing else in the app may depend on
   * it existing.
   */
  faucet?: {
    getStatus(): Promise<FaucetStatus>;
    claim(): Promise<TxResult>;
  };
}

// ============================================================
// ERRORS
// ============================================================

/**
 * Exactly 12 codes. The UI renders a distinct message for each one.
 * A miscategorised error becomes a generic "Something went wrong" toast that
 * tells the user nothing, so classification accuracy is a UX requirement.
 *
 * Cases deliberately NOT given their own code:
 *   amount out of range   -> validate client-side before submitting
 *   not yet withdrawable  -> TX_REVERTED with failureReason
 *   pool has no USDT      -> TX_REVERTED with failureReason
 */
export type AdapterErrorCode =
  | "USER_REJECTED"           // user declined the signature. Info tone, keep modal open.
  | "WALLET_NOT_CONNECTED"
  | "WRONG_NETWORK"           // offer a switch-network action
  | "INSUFFICIENT_BNB"        // not enough gas
  | "INSUFFICIENT_HCOW"
  | "DEDUCTION_CAP_EXCEEDED"
  | "UNBOND_COOLDOWN_ACTIVE"
  | "INVALID_REPRESENTATIVE"  // node inactive or unknown. Prompt to pick another.
  | "TX_REVERTED"
  | "TX_TIMEOUT"              // 60s cutoff. Keep watching in the background.
  | "RPC_ERROR"
  | "ACCOUNT_CHANGED"         // v0.4.3. The wallet switched account before the UI showed it. Nothing sent.
  | "UNKNOWN_ERROR";

export class AdapterError extends Error {
  code: AdapterErrorCode;
  cause?: unknown;
  /** Present on TX_TIMEOUT so the UI can link to BscScan while it waits. */
  txHash?: Hex;
  /**
   * v0.4.5. Set when this call confirmed an approval transaction and a later
   * step then failed. The allowance stays on chain, so "Nothing was sent" is
   * false (audit 6, H-4).
   */
  approvalHash?: Hex;
  /**
   * v0.4.5. A sentence written for the user, safe to show as is: the named
   * contract error behind a revert, or a pre-flight check. The UI used to
   * discard the message and show only the code's generic text, so a revert
   * the adapter had identified exactly still read as "The network rejected
   * this transaction" (audit 6, L-14).
   */
  detail?: string;

  constructor(code: AdapterErrorCode, message: string, cause?: unknown, txHash?: Hex) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    this.cause = cause;
    this.txHash = txHash;
  }
}

export function isAdapterError(e: unknown): e is AdapterError {
  return e instanceof AdapterError;
}
