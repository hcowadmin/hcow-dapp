// 감사 6 H-1: 계정 전환으로 첫 본딩의 리스크 동의 체크박스를 건너뛸 수 있는가 (배포물에 포함하지 않음).
// jsdom 에서 실제 App 을 띄우고 지갑 계정을 바꾼다. 필요: npm i --no-save jsdom
// src 임시 사본에서 adapter 만 테스트용으로 바꾼다. 원본 src 는 건드리지 않는다.  npx tsx test-h1.tsx
import { JSDOM } from "jsdom";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost/" });
const g = globalThis as any;
for (const k of Object.getOwnPropertyNames(dom.window)) if (!(k in g)) { try { g[k] = (dom.window as any)[k]; } catch { /* read-only */ } }
g.window = dom.window; g.document = dom.window.document;
Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true });
g.IS_REACT_ACT_ENVIRONMENT = false;
g.window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const tmp = mkdtempSync(join(process.cwd(), ".h1-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
cpSync(join(process.cwd(), "src"), join(tmp, "src"), { recursive: true });
{
  const idx = join(tmp, "src/data/index.ts");
  const src = readFileSync(idx, "utf8");
  const line = "export const adapter: IHcowAdapter = chainAdapter;";
  if (src.split(line).length !== 2) throw new Error("test: adapter export line not found");
  writeFileSync(idx, src.replace(line, "export const adapter: IHcowAdapter = new Proxy({} as IHcowAdapter, { get: (_t, k) => (globalThis as any).__TEST_ADAPTER[k] });"));
}
for (const f of ["src/main.tsx", "src/App.tsx"]) {           // CSS import 는 노드에서 못 읽는다
  const p = join(tmp, f); try { writeFileSync(p, readFileSync(p, "utf8").replace(/^import ["'][^"']+\.css["'];?$/m, "")); } catch { /* 없음 */ }
}

const React = await import("react");
g.React = React; // 임시 사본은 tsconfig 밖이라 classic JSX 로 변환된다
const { createRoot } = await import("react-dom/client");
const { mockAdapter } = await import(join(tmp, "src/data/mock.ts"));
const { PROTOCOL } = await import(join(tmp, "src/config/constants.ts"));
const { default: App } = await import(join(tmp, "src/App.tsx"));
const { ProfitShareScreen } = await import(join(tmp, "src/screens/ProfitShareScreen.tsx"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await mockAdapter.connectWallet("metamask"); // mock 의 스테이킹 조회가 연결을 요구한다

// ---- 테스트 adapter: A 는 이미 본딩한 계정, B 는 한 번도 본딩하지 않은 계정
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const basePos = { status: "active", bondedAmount: 5000, shareOfPool: 0.01, estimatedEpochUsdt: null, pendingUnbondAmount: null,
  pendingUnbondReadyAt: null, pendingClaimUsdt: 0, lifetimeDeductedHcow: 0, lifetimeClaimedUsdt: 0 };
const POS: Record<string, any> = { [A]: { ...basePos }, [B]: { ...basePos, status: "first_time", bondedAmount: 0, shareOfPool: 0 } };
let DELAY_B = 20;
let current: any = { connected: false, address: null, chainId: null, balances: { hcow: 0, usdt: 0, bnb: 0 } };
const subs = new Set<(s: any) => void>();
const calls: { fn: string; account: string | null; amount: number }[] = [];
const emit = (address: string | null, hcow: number) => {
  current = address
    ? { connected: true, address, chainId: PROTOCOL.CHAIN_ID, balances: { hcow, usdt: 0, bnb: 1 } }
    : { connected: false, address: null, chainId: null, balances: { hcow: 0, usdt: 0, bnb: 0 } };
  subs.forEach((cb) => cb(current));
};
g.__TEST_ADAPTER = Object.assign(Object.create(mockAdapter), {
  faucet: undefined,
  subscribeWallet(cb: (s: any) => void) { subs.add(cb); cb(current); return () => { subs.delete(cb); }; },
  async getWalletState() { return current; },
  async getBondedPosition() { const who = current.address; await sleep(who === B ? DELAY_B : 20); return { ...POS[who] }; },
  async getStakedPosition() { return mockAdapter.getStakedPosition(); },
  async bond(amount: number) { calls.push({ fn: "bond", account: current.address, amount }); return { hash: "0x" + "1".repeat(64) }; },
  async topUpBond(amount: number) { calls.push({ fn: "topUpBond", account: current.address, amount }); return { hash: "0x" + "2".repeat(64) }; },
});

async function until(pred: () => boolean, ms = 3000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) return false; await sleep(20); } return true; }
const byText = (sel: string, re: RegExp) => [...document.querySelectorAll(sel)].find((e) => re.test((e.textContent ?? "").trim())) as HTMLElement | undefined;
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
const confirmBtn = () => dialog() ? ([...dialog()!.querySelectorAll("button")].find((b) => /^(Top up|Bond)\b/.test(b.textContent ?? "") && !/Cancel/.test(b.textContent ?? "")) as HTMLButtonElement | undefined) : undefined;

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  PASS  " + m); } else { fail++; console.log("  FAIL  " + m); } };

// ================= 1. 실제 App: 감사 6 H-1 재현 경로
const root = createRoot(document.getElementById("root")!);
root.render(React.createElement(App));
emit(A, 10_000);
await until(() => !!byText('[role="tab"]', /^Profit Share$/));
byText('[role="tab"]', /^Profit Share$/)!.click();
ok(await until(() => !!byText("button", /^Top up$/)), "fixture: account A (already bonded) sees Top up");
byText("button", /^Top up$/)!.click();
ok(await until(() => !!dialog()), "fixture: the Top up modal is open for A");

emit(B, 1_000);                                            // 모달이 열린 채 B 로 전환
await sleep(400);
ok(dialog() === null, "H-1: switching account closes the open modal");
const inputAfter = document.getElementById("bond-amount") as HTMLInputElement | null;
if (inputAfter && confirmBtn()) {                          // 수정 전 코드라면 여기서 우회가 성립한다
  typeInto(inputAfter, "1000"); await sleep(50);
  if (!confirmBtn()!.disabled) { confirmBtn()!.click(); await sleep(100); }
}
ok(!calls.some((c) => c.account === B), "H-1: no deposit is sent for B from the modal opened under A");

// 정상 경로는 그대로: B 는 Bond HCOW → 체크박스 없이는 확인 불가 → 체크 후 1회 전송
ok(await until(() => !!byText("button", /^Bond HCOW$/)), "B sees Bond HCOW after the switch");
byText("button", /^Bond HCOW$/)!.click();
await until(() => !!dialog());
typeInto(document.getElementById("bond-amount") as HTMLInputElement, "1000"); await sleep(50);
ok(!!document.getElementById("bond-ack"), "B's first bond shows the risk checkbox");
ok(!!confirmBtn() && confirmBtn()!.disabled, "confirm is disabled until the box is ticked");
(document.getElementById("bond-ack") as HTMLInputElement).click(); await sleep(50);
ok(!!confirmBtn() && !confirmBtn()!.disabled, "ticking the box enables confirm");
confirmBtn()!.click(); await sleep(150);
ok(calls.length === 1 && calls[0].fn === "bond" && calls[0].account === B && calls[0].amount === 1000, "exactly one bond for B, after the acknowledgement");

// Network Staking 도 같은 규칙: 계정이 바뀌면 열린 모달은 닫힌다
await until(() => dialog() === null);
emit(A, 10_000);
byText('[role="tab"]', /^Network Staking$/)!.click();
ok(await until(() => !!byText("button", /^(Start staking|Stake more)$/)), "fixture: staking screen loaded for A");
byText("button", /^(Start staking|Stake more)$/)!.click();
ok(await until(() => !!dialog()), "fixture: a staking modal is open for A");
emit(B, 1_000);
await sleep(300);
ok(dialog() === null, "H-1 (staking): switching account closes the open staking modal");
root.unmount();

// ================= 2. 두 번째 방어선: key 없이 화면을 같은 인스턴스로 재사용해도 체크박스가 요구되는가
calls.length = 0;
emit(A, 10_000);
const host = document.createElement("div"); document.body.appendChild(host);
const r2 = createRoot(host);
const props = (wk: string) => ({ wallet: current, walletKey: wk, canRead: true, pushToast: () => {}, onNavigate: () => {}, onConnect: () => {} });
r2.render(React.createElement(ProfitShareScreen, props(`${A}:${PROTOCOL.CHAIN_ID}`)));
await until(() => !!byText("button", /^Top up$/));
byText("button", /^Top up$/)!.click();
await until(() => !!dialog());
DELAY_B = 600;                                              // B 의 포지션 조회가 느린 동안
emit(B, 1_000);
r2.render(React.createElement(ProfitShareScreen, props(`${B}:${PROTOCOL.CHAIN_ID}`)));   // 같은 인스턴스, walletKey 만 바뀜
await sleep(100);
const inpEarly = document.getElementById("bond-amount") as HTMLInputElement | null;
if (inpEarly) { typeInto(inpEarly, "1000"); await sleep(30); }
ok(!!dialog() && !!confirmBtn() && confirmBtn()!.disabled, "defense 3: while B's position is still loading, confirm is disabled (A's stale position is not trusted)");
if (confirmBtn() && !confirmBtn()!.disabled) { confirmBtn()!.click(); await sleep(50); }
await sleep(700);
DELAY_B = 20;
const inp = document.getElementById("bond-amount") as HTMLInputElement | null;
ok(!!dialog() && !!inp, "fixture (no key): the modal survives the switch, as in the original bug");
if (inp) { typeInto(inp, "1000"); await sleep(50); }
ok(!!document.getElementById("bond-ack"), "defense 2: the position now says first bond, so the checkbox appears even in a Top up modal");
if (confirmBtn() && !confirmBtn()!.disabled) { confirmBtn()!.click(); await sleep(100); }
ok(calls.length === 0, "defense 2: nothing is sent without the acknowledgement");
r2.unmount();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
