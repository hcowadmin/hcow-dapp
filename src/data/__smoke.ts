/**
 * Read-path smoke test for chain.ts. Not shipped in the app bundle.
 *
 * Runs every read method of the chain adapter against a real node and prints
 * what comes back, so the ABI fragments, the decoding and the shape of every
 * returned object are exercised outside a browser. A wrong tuple field or a
 * mis-typed getter shows up here rather than as a blank panel in the UI.
 *
 * Build and run:
 *   VITE_CHAIN_ID=97 VITE_RPC_URL=... VITE_*_ADDRESS=... \
 *     npx vite build --ssr src/data/__smoke.ts --outDir dist-node
 *   node dist-node/__smoke.js 0x<accountToInspect>
 *
 * The wallet is faked with a minimal EIP-1193 stub, which also exercises
 * getWalletState and the account-dependent reads.
 */

import { chainAdapter, CHAIN_ADAPTER_GAPS } from "./chain";

const account = process.argv[2];

// Minimal injected-provider stub. Enough for eth_accounts and eth_chainId,
// which is all the read path touches.
(globalThis as unknown as { ethereum: unknown }).ethereum = {
  request: async ({ method }: { method: string }) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") {
      return account ? [account] : [];
    }
    if (method === "eth_chainId") {
      return "0x" + Number(process.env.SMOKE_CHAIN_ID ?? "97").toString(16);
    }
    throw new Error(`stub provider: unexpected ${method}`);
  },
};

const show = (label: string, value: unknown) => {
  console.log(`\n--- ${label}`);
  console.log(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)
  );
};

async function main() {
  let failures = 0;
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      show(label, await fn());
    } catch (e) {
      failures++;
      console.log(`\n--- ${label}\nFAILED: ${(e as Error).message}`);
    }
  };

  await step("getWalletState", () => chainAdapter.getWalletState());
  await step("getEpoch", () => chainAdapter.getEpoch());
  await step("getLastEpochDistribution", () => chainAdapter.getLastEpochDistribution());
  await step("getPoolStats", () => chainAdapter.getPoolStats());
  await step("getNetworkStats", () => chainAdapter.getNetworkStats());
  await step("getBurnStats", () => chainAdapter.getBurnStats());
  await step("getRepresentatives", () => chainAdapter.getRepresentatives());
  await step("getTxHistory", () => chainAdapter.getTxHistory());
  if (account) {
    await step("getBondedPosition", () => chainAdapter.getBondedPosition());
    await step("getStakedPosition", () => chainAdapter.getStakedPosition());
  }

  show("declared gaps", CHAIN_ADAPTER_GAPS);
  console.log(`\n${failures} read method(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
