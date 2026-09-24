// 감사 6 M-5 · L-8 · L-16 · 30일 폴백: 실제 화면이 null 을 "측정 대기" 로 그리는지 (배포물에 포함하지 않음).
// test-c1c2-screens.tsx 와 같은 방식: src 임시 사본에서 useAsync 를 두 단계(수집·제공)로 바꾸고,
// 화면의 실제 fetch 함수가 테스트 adapter 를 부르게 한다. 원본 src 는 건드리지 않는다.  npx tsx test-m5-screens.tsx
import * as React from "react";
import { renderToString } from "react-dom/server";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
(globalThis as any).React = React;

const tmp = mkdtempSync(join(process.cwd(), ".m5-screens-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
cpSync(join(process.cwd(), "src"), join(tmp, "src"), { recursive: true });
writeFileSync(join(tmp, "src/hooks/useAsync.ts"), `
export interface AsyncState<T> { data: T | null; loading: boolean; error: unknown; reload: () => void }
export function useAsync<T>(fn: () => Promise<T>, _deps: unknown[], enabled = true): AsyncState<T> {
  const st = (globalThis as any).__ASYNC;
  if (!enabled) return { data: null, loading: false, error: null, reload: () => {} };
  // "idle": the frame useAsync really produces when canRead turns true, before its effect runs
  if (st.mode === "idle") return { data: null, loading: false, error: null, reload: () => {} };
  if (st.mode === "collect") { st.pending.push(fn()); return { data: null, loading: true, error: null, reload: () => {} }; }
  if (st.served.length === 0) throw new Error("test: nothing to serve");
  const r = st.served.shift();
  return r.status === "fulfilled"
    ? { data: r.value as T, loading: false, error: null, reload: () => {} }
    : { data: null, loading: false, error: r.reason, reload: () => {} };
}`);
{
  const idx = join(tmp, "src/data/index.ts");
  const src = readFileSync(idx, "utf8");
  const line = "export const adapter: IHcowAdapter = chainAdapter;";
  if (src.split(line).length !== 2) throw new Error("test: adapter export line not found");
  writeFileSync(idx, src.replace(line, "export const adapter: IHcowAdapter = new Proxy({} as IHcowAdapter, { get: (_t, k) => (globalThis as any).__TEST_ADAPTER[k] });"));
}

const { mockAdapter } = await import(join(tmp, "src/data/mock.ts"));
const { ProfitShareScreen } = await import(join(tmp, "src/screens/ProfitShareScreen.tsx"));
const { HomeScreen } = await import(join(tmp, "src/screens/HomeScreen.tsx"));
const { PortfolioScreen } = await import(join(tmp, "src/screens/PortfolioScreen.tsx"));
const { EpochWaterfall } = await import(join(tmp, "src/components/EpochWaterfall.tsx"));

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  PASS  " + m); } else { fail++; console.log("  FAIL  " + m); } };
const okR = (h: string, c: boolean, m: string) => ok(!h.startsWith("RENDER ERROR") && c, m);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const count = (h: string, s: string) => h.split(s).length - 1;

const w = await mockAdapter.connectWallet("metamask");
const wallet = { ...w, connected: true };
const props = { wallet, walletKey: String(w.address), canRead: true, pushToast: () => {}, onNavigate: () => {}, onConnect: () => {} };
const basePool = await mockAdapter.getPoolStats();
const basePos = await mockAdapter.getBondedPosition();
const NULL_POOL = { ...basePool, grossReceivedUsdtToday: null, grossReceivedUsdt7d: null, grossReceivedUsdt30d: null, distributedToParticipantsUsdt30d: null };

async function render(el: () => any, over: Record<string, unknown>) {
  (globalThis as any).__TEST_ADAPTER = Object.assign(Object.create(mockAdapter), over);
  const st = ((globalThis as any).__ASYNC = { mode: "collect", pending: [] as Promise<unknown>[], served: [] as unknown[] });
  try {
    renderToString(el());
    st.served = await Promise.allSettled(st.pending); // 실패한 읽기는 useAsync 처럼 error 로 전달
    st.mode = "serve";
    return text(renderToString(el()));
  } catch (e) { return "RENDER ERROR " + (e as Error).message; }
}

// ---- Profit Share: M-5 forecast, 30d metrics
const ps = await render(() => <ProfitShareScreen {...(props as any)} />, {
  getPoolStats: async () => NULL_POOL,
  getBondedPosition: async () => ({ ...basePos, estimatedEpochUsdt: null }),
});
ok(!ps.startsWith("RENDER ERROR"), "ProfitShare renders " + ps.slice(0, 50));
okR(ps, ps.includes("Forecast for this epoch") && ps.includes("Forecast pending"), "M-5: null forecast shows Forecast pending");
okR(ps, !/Forecast for this epoch\s+0\.00/.test(ps), "M-5: null forecast is not 0.00");
okR(ps, !/Gross received · 30d\s+0\.00/.test(ps) && /Gross received · 30d\s+— Measurement pending/.test(ps), "30d gross null shows Measurement pending, not 0.00");
okR(ps, /Paid to participants · 30d\s+— Measurement pending/.test(ps), "30d paid null shows Measurement pending");
okR(ps, !/Measurement pending\s*USDT/.test(ps), "ProfitShare: no USDT unit next to a pending value");
const psReal = await render(() => <ProfitShareScreen {...(props as any)} />, { getBondedPosition: async () => ({ ...basePos, estimatedEpochUsdt: 0 }) });
okR(psReal, /Forecast for this epoch\s+0\.00/.test(psReal) && !psReal.includes("Forecast pending"), "a real 0 forecast still shows 0.00");
okR(psReal, !/Gross received · 30d\s+— Measurement pending/.test(psReal), "measured 30d gross still shows a number");

// ---- Home: 24h, 7d, paid 30d
const home = await render(() => <HomeScreen {...(props as any)} />, { getPoolStats: async () => NULL_POOL });
ok(!home.startsWith("RENDER ERROR"), "Home renders " + home.slice(0, 50));
okR(home, /Gross received · 24h\s+— Measurement pending/.test(home), "24h gross null shows Measurement pending");
okR(home, /Gross received · 7d\s+— Measurement pending/.test(home), "7d gross null shows Measurement pending");
okR(home, /Paid to participants · 30d\s+— Measurement pending/.test(home), "30d paid null shows Measurement pending");
okR(home, !/Measurement pending\s*USDT/.test(home), "Home: no USDT unit next to a pending value");
const homeZero = await render(() => <HomeScreen {...(props as any)} />, { getPoolStats: async () => ({ ...basePool, grossReceivedUsdtToday: 0 }) });
okR(homeZero, /Gross received · 24h\s+0\.00/.test(homeZero), "a measured 0 for 24h still shows 0.00");

// ---- Portfolio: L-8
const pfNull = await render(() => <PortfolioScreen {...(props as any)} />, { getTxHistory: async () => null });
ok(!pfNull.startsWith("RENDER ERROR"), "Portfolio renders " + pfNull.slice(0, 50));
okR(pfNull, pfNull.includes("History unavailable") && !pfNull.includes("No transactions yet"), "L-8: null history shows History unavailable, not No transactions yet");
okR(pfNull, !pfNull.includes("Loading transaction history"), "L-8: null history is not an endless loading block");
(globalThis as any).__TEST_ADAPTER = Object.assign(Object.create(mockAdapter), { getTxHistory: async () => null });
(globalThis as any).__ASYNC = { mode: "idle", pending: [], served: [] };
const pfIdle = (() => { try { return text(renderToString(<PortfolioScreen {...(props as any)} />)); } catch (e) { return "RENDER ERROR " + (e as Error).message; } })();
okR(pfIdle, pfIdle.includes("Loading transaction history") && !pfIdle.includes("History unavailable"), "L-8: the not-yet-fetched frame shows loading, not History unavailable");
const pfEmpty = await render(() => <PortfolioScreen {...(props as any)} />, { getTxHistory: async () => [] });
okR(pfEmpty, pfEmpty.includes("No transactions yet") && !pfEmpty.includes("History unavailable"), "[] history still says No transactions yet");
const pfErr = await render(() => <PortfolioScreen {...(props as any)} />, { getTxHistory: async () => { throw new Error("boom"); } });
okR(pfErr, pfErr.includes("History unavailable"), "a failed history read also shows History unavailable");

// ---- Epoch waterfall: L-16
const dist = (await mockAdapter.getLastEpochDistribution())!;
const wfNull = (() => { try { return text(renderToString(<EpochWaterfall distribution={{ ...dist, revenue: null, costs: null, directCostsUsdt: 120, operatingCostsUsdt: 80 }} />)); } catch (e) { return "RENDER ERROR " + (e as Error).message; } })();
ok(!wfNull.startsWith("RENDER ERROR"), "Waterfall renders with null line items");
okR(wfNull, count(wfNull, "Line items pending") === 3, "L-16: revenue, direct and operating sections each say Line items pending");
okR(wfNull, !wfNull.includes("No direct costs recorded") && !wfNull.includes("No operating costs recorded"), "L-16: null costs do not say No costs recorded");
okR(wfNull, /Direct costs\s+− ?120\.00/.test(wfNull) || /Direct costs\s+-?\s*120\.00/.test(wfNull), "L-16: the contract total for direct costs is still shown");
const wfEmpty = text(renderToString(<EpochWaterfall distribution={{ ...dist, costs: [], directCostsUsdt: 0, operatingCostsUsdt: 0 }} />));
okR(wfEmpty, wfEmpty.includes("No direct costs recorded") && !wfEmpty.includes("Line items pending"), "measured [] costs still say No direct costs recorded");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
