/**
 * HCOW dApp — Deployment Configuration
 *
 * SINGLE SOURCE OF TRUTH for chain id, RPC and contract addresses.
 * chain.ts reads only from here. Nothing else may hardcode an address.
 *
 * Every value can be overridden at build time with a Vite env var, so the same
 * bundle can point at testnet or mainnet without a code change:
 *
 *   VITE_CHAIN_ID, VITE_RPC_URL, VITE_EXPLORER_BASE,
 *   VITE_HCOW_ADDRESS, VITE_USDT_ADDRESS,
 *   VITE_PROFIT_SHARE_ADDRESS, VITE_STAKING_ADDRESS, VITE_LEDGER_ADDRESS,
 *   VITE_INDEXER_URL, VITE_INDEXER_KEY
 *
 * The defaults below are the BSC TESTNET deployment of 2026-08-13. The HCOW
 * and USDT entries there are stand-in test tokens with no value. The real HCOW
 * token contract does not exist yet.
 */

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const pick = (key: string, fallback: string): string => {
  const v = env[key];
  return v && v.length > 0 ? v : fallback;
};

export const DEPLOYMENT = {
  chainId: Number(pick("VITE_CHAIN_ID", "97")),
  chainName: pick("VITE_CHAIN_NAME", "BNB Smart Chain Testnet"),
  rpcUrl: pick("VITE_RPC_URL", "https://data-seed-prebsc-1-s1.bnbchain.org:8545"),
  explorerBase: pick("VITE_EXPLORER_BASE", "https://testnet.bscscan.com"),
  nativeSymbol: pick("VITE_NATIVE_SYMBOL", "tBNB"),

  addresses: {
    hcow: pick("VITE_HCOW_ADDRESS", "0x3c726E2C04ad4FbD81F52506218f2D296506007d"),
    usdt: pick("VITE_USDT_ADDRESS", "0x453738c62aD35Bb81F4204C3545F4b9832F5D2Dd"),
    profitShare: pick("VITE_PROFIT_SHARE_ADDRESS", "0xc49176f8D0F26c9D07ca7E6E12d0bc4aC16e613B"),
    staking: pick("VITE_STAKING_ADDRESS", "0xBa2d31854Cc85759094Cf12e4b3867F76c42096A"),
    ledger: pick("VITE_LEDGER_ADDRESS", "0x038b3E21fF62c9490787Cf3C27eBBB9a772B409e"),
    /**
     * Testnet faucet. Empty string means no faucet, which is the correct
     * mainnet configuration: the adapter then omits the faucet entirely and
     * the UI shows no claim button.
     */
    faucet: pick("VITE_FAUCET_ADDRESS", "0x701253AC9E6164d3a2DAb181d6348C306F109358"),
  },

  /**
   * Epoch 0 start, unix ms. HCOWProfitShare counts epochs but does not
   * schedule them: an epoch begins when the previous one is settled. Before
   * the first settlement there is nothing on chain to count from, so the
   * countdown needs this anchor. Set it to the deployment time.
   *
   * After the first settlement this value is no longer used. The countdown
   * runs from the last settlement's on-chain settledAt.
   */
  genesisMs: Number(pick("VITE_GENESIS_MS", "1786634000000")),

  /**
   * Event index. Supabase project URL and its anon key, which is a public
   * read-only key by design: the table it reaches holds public chain data and
   * RLS blocks every write from it.
   *
   * Leave empty and the app still works. Everything that needs history simply
   * reports empty rather than guessing, which is the same behaviour as before
   * the indexer existed.
   */
  indexerUrl: pick("VITE_INDEXER_URL", "https://nkmsgvgwleyaognxqfnb.supabase.co").replace(/\/$/, ""),
  indexerKey: pick(
    "VITE_INDEXER_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbXNndmd3bGV5YW9nbnhxZm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MzM5OTMsImV4cCI6MjEwMjIwOTk5M30.7PKuNsng2WLmbZ4S0jVYOoE9a7rNhWPgAioXhChB2Fc"
  ),

  /** True while the deployment uses stand-in tokens. The UI can warn on it. */
  isTestDeployment: pick("VITE_IS_TEST_DEPLOYMENT", "true") === "true",
} as const;

export const explorerTxUrl = (hash: string) => `${DEPLOYMENT.explorerBase}/tx/${hash}`;
export const explorerAddressUrl = (addr: string) => `${DEPLOYMENT.explorerBase}/address/${addr}`;
