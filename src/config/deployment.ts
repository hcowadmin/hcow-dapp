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
 * The defaults below are the BSC TESTNET deployment of 2026-09-02, which
 * replaced the 2026-08-13 one. The HCOW and USDT entries are stand-in test
 * tokens with no value; the real HCOW token contract does not exist yet.
 *
 * The 2026-08-13 addresses are superseded and must not be used. That
 * deployment was made from a pre-audit revision with a single wallet holding
 * every role, which is the shape the mainnet deploy script refuses. This one
 * was deployed from the audited commit with all six roles separated.
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
    hcow: pick("VITE_HCOW_ADDRESS", "0xD4518f417bDcA9fB325A29bFf6D3ad78a7886852"),
    usdt: pick("VITE_USDT_ADDRESS", "0x65d36196a9C0893c44dbCbf54e5f6Dc4Ae5eeDD5"),
    profitShare: pick("VITE_PROFIT_SHARE_ADDRESS", "0x795177074654B0Bb4b2B5A4405B6069e79D01f73"),
    staking: pick("VITE_STAKING_ADDRESS", "0x01C2d87eD3047eB02BD968c1eb8e6B5055bb6345"),
    ledger: pick("VITE_LEDGER_ADDRESS", "0xF62d0322dDf5f2913ed1751d0104d9f0D3B3EC19"),
    /**
     * Testnet faucet. Empty string means no faucet, which is the correct
     * mainnet configuration: the adapter then omits the faucet entirely and
     * the UI shows no claim button.
     */
    faucet: pick("VITE_FAUCET_ADDRESS", "0xbfEfa53d4800A6Ed2026cb7b34d182A71cb0684b"),
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
  genesisMs: Number(pick("VITE_GENESIS_MS", "1788353400000")),

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
