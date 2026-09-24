// 감사 6 H-1 잔여, 첫 연결: 화면이 아직 어떤 계정도 보여 주지 않았을 때의 쓰기 (배포물에 포함하지 않음).
// test-h1-race.ts 와 모듈 상태가 섞이지 않도록 별도 프로세스로 돈다.
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

// 첫 연결 중, 잔액 조회가 느려 화면에 아직 계정이 없는 동안
let published: string | null = "unset";
SLOW_BALANCE_MS = 1500;
const connecting = chainAdapter.connectWallet("metamask");
await sleep(50);
let r = await code(chainAdapter.bond(1000));
ok(r === "ACCOUNT_CHANGED" && sent.length === 0, "a write before any account was shown is refused, nothing sent: " + r);
await connecting;
chainAdapter.subscribeWallet((s: any) => { published = s.address; });
SLOW_BALANCE_MS = 0;
await sleep(200);
ok(String(published).toLowerCase() === A, "fixture: A is now shown");
r = await code(chainAdapter.bond(1000));
ok(sent.length === 1 && sent[0] === A && r === "USER_REJECTED", "control: after A is shown, the write reaches the wallet: " + r);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
