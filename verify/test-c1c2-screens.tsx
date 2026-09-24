// C-1 / C-2 검증: 실제 화면(Profit Share · Home)이 null 을 "측정 대기" 로 그리는지 (배포물에 포함하지 않음).
// SSR 은 useEffect 를 돌리지 않으므로, src 를 임시 사본으로 복사하고 그 사본의 useAsync 만
// 미리 넣은 값을 돌려주는 버전으로 바꾼다. 원본 src 는 건드리지 않는다.  npx tsx test-c1c2-screens.tsx
import * as React from "react";
import { renderToString } from "react-dom/server";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
(globalThis as any).React = React;

const tmp = mkdtempSync(join(process.cwd(), ".c1c2-screens-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
cpSync(join(process.cwd(), "src"), join(tmp, "src"), { recursive: true });
writeFileSync(join(tmp, "src/hooks/useAsync.ts"), `
// 두 단계: collect 는 화면의 실제 fetch 함수를 부르고 약속을 모은다. serve 는 그 결과를 순서대로 돌려준다.
export interface AsyncState<T> { data: T | null; loading: boolean; error: unknown; reload: () => void }
export function useAsync<T>(fn: () => Promise<T>, _deps: unknown[], enabled = true): AsyncState<T> {
  const st = (globalThis as any).__ASYNC;
  if (!enabled) return { data: null, loading: false, error: null, reload: () => {} };
  if (st.mode === "collect") { st.pending.push(fn()); return { data: null, loading: true, error: null, reload: () => {} }; }
  if (st.served.length === 0) throw new Error("test: nothing to serve");
  return { data: st.served.shift() as T, loading: false, error: null, reload: () => {} };
}`);
// 화면이 부르는 adapter 를 테스트가 넣는 것으로 바꾼다 (원래는 chainAdapter).
{
  const idx = join(tmp, "src/data/index.ts");
  const src = readFileSync(idx, "utf8");
  const line = "export const adapter: IHcowAdapter = chainAdapter;";
  if (src.split(line).length !== 2) throw new Error("test: adapter export line not found");
  writeFileSync(idx, src.replace(line, "export const adapter: IHcowAdapter = new Proxy({} as IHcowAdapter, { get: (_t, k) => (globalThis as any).__TEST_ADAPTER[k] });"));
}

const { mockAdapter } = await import(join(tmp, "src/data/mock.ts"));
(globalThis as any).__TEST_ADAPTER = mockAdapter;
const { ProfitShareScreen } = await import(join(tmp, "src/screens/ProfitShareScreen.tsx"));
const { HomeScreen } = await import(join(tmp, "src/screens/HomeScreen.tsx"));

let pass = 0, fail = 0;
const okR = (h: string, c: boolean, m: string) => ok(!h.startsWith("RENDER ERROR") && c, m);
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  PASS  " + m); } else { fail++; console.log("  FAIL  " + m); } };
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const wallet = { connected: false, address: null, chainId: null, balances: { hcow: 0, usdt: 0, bnb: 0 } };
const props = { wallet, walletKey: "", canRead: false, pushToast: () => {}, onNavigate: () => {}, onConnect: () => {} };

const epoch = await mockAdapter.getEpoch();
const basePool = await mockAdapter.getPoolStats();
const burn = await mockAdapter.getBurnStats();
const network = await mockAdapter.getNetworkStats();
const distribution = await mockAdapter.getLastEpochDistribution();
ok(basePool.grossReceivedUsdt30d > 0, "fixture: 30d gross > 0 (C-1 조건)");

async function render(el: () => any, pool: any) {
  (globalThis as any).__TEST_ADAPTER = Object.assign(Object.create(mockAdapter), { getPoolStats: async () => pool });
  const st = ((globalThis as any).__ASYNC = { mode: "collect", pending: [] as Promise<unknown>[], served: [] as unknown[] });
  try {
    renderToString(el());
    st.served = await Promise.all(st.pending);
    st.mode = "serve";
    return text(renderToString(el()));
  } catch (e) { return "RENDER ERROR " + (e as Error).message; }
}
const renderPS = (pool: any) => render(() => <ProfitShareScreen {...(props as any)} />, pool);
const renderHome = (pool: any) => render(() => <HomeScreen {...(props as any)} />, pool);

// Profit Share (C-1)
const psNull = await renderPS({ ...basePool, revenue30dByOrigin: null, chainVerifiableRatio30d: null });
ok(!psNull.startsWith("RENDER ERROR"), "ProfitShare renders with null fields " + psNull.slice(0, 60));
ok(psNull.includes("Measurement pending"), "C-1: null breakdown shows Measurement pending");
okR(psNull, !psNull.includes("No money has been received"), "C-1: null breakdown does not say no money was received");
okR(psNull, !psNull.includes("No revenue recorded"), "C-1: null breakdown does not say no revenue recorded");
okR(psNull, !/\d+\.\d%\s*chain verifiable/.test(psNull), "C-2: ProfitShare title has no percentage when null");
const psEmpty = await renderPS({ ...basePool, revenue30dByOrigin: [], chainVerifiableRatio30d: 0 });
ok(psEmpty.includes("No revenue recorded") && !psEmpty.includes("Measurement pending"), "measured [] still says No revenue recorded");
const psReal = await renderPS(basePool);
ok(!psReal.includes("Measurement pending") && /\d+\.\d%\s*chain verifiable/.test(psReal), "measured data still shows the % and the lines");

// Home (C-2)
const hNull = await renderHome({ ...basePool, revenue30dByOrigin: null, chainVerifiableRatio30d: null });
ok(!hNull.startsWith("RENDER ERROR"), "Home renders with null fields " + hNull.slice(0, 60));
ok(hNull.includes("Chain verifiable share of gross received") && hNull.includes("Measurement pending"), "C-2: Home card shows Measurement pending");
okR(hNull, !/\d+\.\d%\s*of gross received was chain verifiable/.test(hNull), "C-2: Home card has no percentage when null");
okR(hNull, !hNull.includes("The rest arrived off chain"), "C-2: 'The rest' sentence hidden when the share is not measured");
const hZero = await renderHome({ ...basePool, chainVerifiableRatio30d: 0 });
ok(/0\.0%\s*of gross received was chain verifiable/.test(hZero) && hZero.includes("The rest arrived off chain"), "a measured 0 still shows 0.0% and the explanation");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
