// 감사 6 H-1 잔여: 지갑이 계정을 바꾼 직후, 화면이 아직 이전 계정을 보여 주는 동안의 쓰기 (배포물에 포함하지 않음).
// 실제 chain.ts 에 가짜 RPC(잔액 조회를 느리게)와 가짜 지갑을 붙인다. 네트워크를 쓰지 않는다.  npx tsx test-h1-race.ts
import { FetchRequest } from "ethers";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let SLOW_BALANCE_MS = 0;
FetchRequest.registerGetUrl(async (req) => {
  const body = JSON.parse(new TextDecoder().decode(req.body!));
  const one = async (m: any) => {
    let result: any = null;
    if (m.method === "eth_chainId") result = "0x61";
    else if (m.method === "eth_blockNumber") result = "0x1";
    else if (m.method === "eth_getBalance") { await sleep(SLOW_BALANCE_MS); result = "0x0"; }
    else if (m.method === "eth_call") result = "0x" + "0".repeat(64);
    return { jsonrpc: "2.0", id: m.id, result };
  };
  const out = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
  return { statusCode: 200, statusMessage: "OK", headers: { "content-type": "application/json" }, body: new TextEncoder().encode(JSON.stringify(out)) };
});

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
let selected = A;
const listeners: Record<string, ((...a: any[]) => void)[]> = {};
const sent: string[] = [];
(globalThis as any).ethereum = {
  async request({ method, params }: any) {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [selected];
    if (method === "eth_chainId") return "0x61";
    if (method === "eth_blockNumber") return "0x1";
    if (method === "eth_getBalance") return "0x0";
    if (method === "eth_call") return "0x" + "0".repeat(64);
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_sendTransaction") { sent.push(String(params[0].from).toLowerCase()); throw Object.assign(new Error("user rejected"), { code: 4001 }); }
    return null;
  },
  on(ev: string, h: any) { (listeners[ev] ??= []).push(h); },
  removeListener() {},
};

const { chainAdapter } = await import("./src/data/chain");
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  PASS  " + m); } else { fail++; console.log("  FAIL  " + m); } };
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: any) => String(e?.code));

// 1. 새로고침 경로: 이미 연결된 지갑. 구독 즉시 전달된 계정으로는 서명할 수 있어야 한다
let published: string | null = null;
chainAdapter.subscribeWallet((s: any) => { published = s.address; });
await sleep(300);
ok(published?.toLowerCase() === A, "fixture: the page was shown account A on load");
let r = await code(chainAdapter.bond(1000));
ok(sent.length === 1 && sent[0] === A && r === "USER_REJECTED", "control: a write for the shown account reaches the wallet (then declined): " + r);

// 2. 계정 전환 직후, 잔액 조회가 느린 동안
SLOW_BALANCE_MS = 1500;
selected = B;
listeners["accountsChanged"].forEach((h) => h([B]));
await sleep(50);
ok(published?.toLowerCase() === A, "fixture: 50ms after the switch the page still shows A");
sent.length = 0;
r = await code(chainAdapter.bond(1000));
ok(r === "ACCOUNT_CHANGED", "H-1 residual: a write in that gap is refused with ACCOUNT_CHANGED: " + r);
ok(sent.length === 0, "H-1 residual: nothing reaches the wallet for B before the page has shown B");
r = await code(chainAdapter.claimUsdt());
ok(r === "ACCOUNT_CHANGED" && sent.length === 0, "the same holds for other writes (claimUsdt): " + r);

// 3. 화면이 B 를 보여 준 뒤에는 정상
await sleep(1700);
ok(published?.toLowerCase() === B, "fixture: the page now shows B");
SLOW_BALANCE_MS = 0;
r = await code(chainAdapter.bond(1000));
ok(sent.length === 1 && sent[0] === B && r === "USER_REJECTED", "after B is shown, a write for B reaches the wallet: " + r);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
