/**
 * HCOW dApp — Deployment Configuration
 *
 * SINGLE SOURCE OF TRUTH for chain id, RPC and contract addresses.
 * chain.ts reads only from here. Nothing else may hardcode an address.
 *
 * Values are set at build time with Vite env vars, so the same code builds for
 * BSC testnet or BSC mainnet (BNB Smart Chain only):
 *
 *   VITE_CHAIN_ID, VITE_RPC_URL, VITE_EXPLORER_BASE,
 *   VITE_HCOW_ADDRESS, VITE_USDT_ADDRESS,
 *   VITE_PROFIT_SHARE_ADDRESS, VITE_STAKING_ADDRESS, VITE_LEDGER_ADDRESS,
 *   VITE_INDEXER_URL, VITE_INDEXER_KEY, VITE_FAUCET_ADDRESS
 *
 * An empty value counts as unset and falls back to the default (see pick()).
 * The faucet is off on every chain but testnet, whatever the env says.
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

/**
 * Chains that get a test faucet. Audit 6, H-2: the faucet used to be gated on
 * its address alone, and pick() reads an empty string as "unset", so a mainnet
 * build could not switch it off. It is now off on every other chain, whatever
 * the env says. On a testnet build, VITE_FAUCET_ADDRESS=off turns it off.
 */
export const FAUCET_CHAIN_IDS: readonly number[] = [97];

export function faucetFor(chainId: number, configured: string): string {
  if (!FAUCET_CHAIN_IDS.includes(chainId)) return "";
  return configured.trim().toLowerCase() === "off" ? "" : configured;
}

const CHAIN_ID = Number(pick("VITE_CHAIN_ID", "97"));

export const DEPLOYMENT = {
  chainId: CHAIN_ID,
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
     * Testnet faucet. Empty on any chain outside FAUCET_CHAIN_IDS, which
     * includes mainnet: the adapter then omits the faucet entirely and the UI
     * shows no claim button. See faucetFor().
     */
    faucet: faucetFor(CHAIN_ID, pick("VITE_FAUCET_ADDRESS", "0xbfEfa53d4800A6Ed2026cb7b34d182A71cb0684b")),
  },

  // genesisMs (VITE_GENESIS_MS) removed with audit 6, H-3: the epoch start is
  // read from the contract (deployedAt, then lastSettledAt), not configured.

  /**
   * Event index. Supabase project URL and its anon key, which is a public
   * read-only key by design: the table it reaches holds public chain data and
   * RLS blocks every write from it.
   *
   * An empty env value does not switch the index off: pick() reads an empty
   * string as unset and falls back to the defaults below (audit 6, H-2). If the
   * index is unreachable the app still works; everything that needs history
   * reports "not indexed" rather than guessing.
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
