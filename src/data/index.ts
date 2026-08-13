/**
 * HCOW dApp — Data Layer Entry Point
 *
 * THE SWAP POINT. The UI imports `adapter` from here and from nowhere else.
 * Verified: no file outside src/data imports mock.ts or chain.ts directly.
 *
 * To go live, comment the first line and uncomment the second. That is all.
 */

import type { IHcowAdapter } from "./adapter";
// import { mockAdapter } from "./mock";
import { chainAdapter } from "./chain";

// LIVE. Reads and writes the contracts configured in src/config/deployment.ts,
// which currently point at the BSC testnet deployment. Swap the two lines back
// to run the app against mock data with no wallet and no network.
// export const adapter: IHcowAdapter = mockAdapter;
export const adapter: IHcowAdapter = chainAdapter;

export * from "./adapter";
