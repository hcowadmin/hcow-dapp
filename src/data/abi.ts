/**
 * HCOW dApp — Contract ABIs
 *
 * Human-readable fragments, only the members chain.ts actually calls.
 * Keeping these minimal is deliberate: a trimmed ABI cannot accidentally
 * expose an admin function to the UI.
 *
 * These must stay in sync with contracts/HCOWProfitShare.sol and
 * contracts/HCOWStaking.sol in the hcow-contracts package.
 */

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

export const PROFIT_SHARE_ABI = [
  // constants
  "function OPEX_CAP_BPS() view returns (uint16)",
  "function PARTICIPANT_BPS() view returns (uint16)",
  "function GAME_COMPANY_BPS() view returns (uint16)",
  "function TEAM_BPS() view returns (uint16)",
  "function UNBOND_COOLDOWN() view returns (uint256)",
  // pool state
  "function totalBondedHcow() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function totalPendingUnbond() view returns (uint256)",
  "function totalUsdtDistributed() view returns (uint256)",
  "function totalHcowDeducted() view returns (uint256)",
  "function participantCount() view returns (uint256)",
  "function accDeductedPerShare() view returns (uint256)",
  "function nextEpoch() view returns (uint64)",
  "function gameCompany() view returns (address)",
  "function team() view returns (address)",
  // account state
  "function bondedOf(address) view returns (uint256)",
  "function claimableOf(address) view returns (uint256)",
  "function accountOf(address) view returns (uint256 bondedHcow, uint256 shares, uint256 pendingUnbond, uint64 unbondReadyAt)",
  "function lifetimeOf(address) view returns (uint256 deductedHcow, uint256 claimedUsdt)",
  // settlements
  "function getSettlement(uint64 epoch) view returns (tuple(uint128 grossReceivedUsdt, uint128 directCostsUsdt, uint128 operatingCostsUsdt, uint128 distributableProfitUsdt, uint128 participantsUsdt, uint128 hcowDeducted, uint128 snapshotBondedHcow, uint64 settledAt))",
  // writes
  "function bond(uint256 hcowAmount)",
  "function requestUnbond(uint256 hcowAmount)",
  "function cancelUnbond()",
  "function withdrawUnbonded()",
  "function claimUsdt()",
  // errors, so a revert decodes to a name instead of raw data
  "error ZeroAmount()",
  "error NothingToClaim()",
  "error NoPendingUnbond()",
  "error CooldownActive(uint64 readyAt)",
  "error UnbondAlreadyPending()",
  "error InsufficientBonded(uint256 requested, uint256 available)",
  "error NothingBonded()",
  "error NotSettler()",
  "error NotOwner()",
] as const;

export const STAKING_ABI = [
  "function MAX_COMMISSION_BPS() view returns (uint16)",
  "function UNSTAKE_COOLDOWN() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function totalPendingUnstake() view returns (uint256)",
  "function totalRewardsOwed() view returns (uint256)",
  "function totalRewardsFunded() view returns (uint256)",
  "function pendingRewardOf(address) view returns (uint256)",
  "function delegationOf(address) view returns (bytes32 repId, uint256 stakedAmount, uint256 pendingUnstake, uint64 unstakeReadyAt, uint256 pendingReward, uint256 lifetimeClaimed)",
  "function representativeOf(bytes32 id) view returns (string name, address payout, uint16 commissionBps, bool active, bool isFoundation, uint256 totalDelegated, uint256 delegatorCount, uint256 commissionAccrued)",
  "function representativeIds() view returns (bytes32[])",
  "function representativeCount() view returns (uint256 total, uint256 active)",
  "function stake(uint256 amount, bytes32 repId)",
  "function redelegate(bytes32 toRepId)",
  "function requestUnstake(uint256 amount)",
  "function cancelUnstake()",
  "function withdrawUnstaked()",
  "function claimHcow()",
  "error UnknownRepresentative(bytes32 id)",
  "error RepresentativeInactive(bytes32 id)",
  "error AlreadyDelegatedElsewhere(bytes32 current)",
  "error NoPendingUnstake()",
  "error CooldownActive(uint64 readyAt)",
  "error UnstakeAlreadyPending()",
  "error ZeroAmount()",
  "error NothingToClaim()",
  "error NothingStaked()",
  "error InsufficientStake(uint256 requested, uint256 available)",
  "error SameRepresentative()",
] as const;

export const LEDGER_ABI = [
  "function nextEpoch() view returns (uint64)",
  "function totalRecords() view returns (uint256)",
  "function getEpoch(uint64 epoch) view returns (tuple(bytes32 root, uint64 recordCount, uint64 anchoredAt))",
] as const;
