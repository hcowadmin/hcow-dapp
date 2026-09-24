// 감사 6 M-5 · L-8 · L-16 · 30일 폴백: chainAdapter 가 "측정 안 됨" 을 null 로 돌려주는지 (배포물에 포함하지 않음).
// RPC · 인덱서 · 지갑을 프로세스 안에서 가짜로 답한다. 네트워크를 쓰지 않는다.  npx tsx test-m5-chain.ts
import { FetchRequest, AbiCoder, id } from "ethers";
const coder = AbiCoder.defaultAbiCoder();
const sel = (sig: string) => id(sig).slice(0, 10);
const E18 = 10n ** 18n;
const LIFETIME_DISTRIBUTED = 777n * E18; // 옛 폴백이 쓰던 누적값. 화면에 나오면 안 된다
const CALLS: Record<string, string> = {
  [sel("getSettlement(uint64)")]: coder.encode(
    ["tuple(uint128,uint128,uint128,uint128,uint128,uint128,uint128,uint64)"],
    [[1000n * E18, 120n * E18, 80n * E18, 800n * E18, 400n * E18, 0n, E18, 1_900_000_000n]]),
  [sel("accountOf(address)")]: coder.encode(["uint256", "uint256", "uint256", "uint64"], [5000n * E18, 5000n * E18, 0n, 0n]),
  [sel("lifetimeOf(address)")]: coder.encode(["uint256", "uint256"], [0n, 0n]),
  [sel("totalUsdtDistributed()")]: coder.encode(["uint256"], [LIFETIME_DISTRIBUTED]),
};
FetchRequest.registerGetUrl(async (req) => {
  const body = JSON.parse(new TextDecoder().decode(req.body!));
  const one = (m: any) => {
    if (m.method === "eth_chainId") return { jsonrpc: "2.0", id: m.id, result: "0x61" };
    if (m.method === "eth_getBalance") return { jsonrpc: "2.0", id: m.id, result: "0x0" };
    if (m.method === "eth_call") {
      const data: string = m.params[0].data;
      return { jsonrpc: "2.0", id: m.id, result: CALLS[data.slice(0, 10)] ?? coder.encode(["uint256"], [7n * E18]) };
    }
    return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "fake rpc: " + m.method } };
  };
  const out = Array.isArray(body) ? body.map(one) : one(body);
  return { statusCode: 200, statusMessage: "OK", headers: { "content-type": "application/json" }, body: new TextEncoder().encode(JSON.stringify(out)) };
});
const ADDR = "0x1111111111111111111111111111111111111111";
(globalThis as any).ethereum = {
  request: async ({ method }: { method: string }) =>
    method === "eth_accounts" || method === "eth_requestAccounts" ? [ADDR] : method === "eth_chainId" ? "0x61" : null,
};
// 인덱서: INDEX="up" 이면 정상 응답, "down" 이면 503
let INDEX: "up" | "down" = "up";
let indexHits = 0;
(globalThis as any).fetch = async (url: string) => {
  indexHits++;
  if (INDEX === "down") return new Response("unavailable", { status: 503 });
  const u = String(url);
  const rows = u.includes("revenue_windows")
    ? [{ gross_24h: "0", gross_7d: String(50n * E18), gross_30d: String(1000n * E18), participants_30d: String(400n * E18), burned_24h: "0", burned_30d: "0" }]
    : []; // chain_events: 읽었고 비어 있음
  return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
};

const { chainAdapter } = await import("./src/data/chain");
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  PASS  " + m); } else { fail++; console.log("  FAIL  " + m); } };

const ws = await chainAdapter.getWalletState();
ok(ws.address?.toLowerCase() === ADDR, "fixture: fake wallet is connected");

// M-5
const pos = await chainAdapter.getBondedPosition();
ok(pos.bondedAmount === 5000, "fixture: bonded position read from the fake chain");
ok(pos.estimatedEpochUsdt === null, "M-5: estimatedEpochUsdt is null (not forecast), not 0");

// L-16
const d = await chainAdapter.getEpochDistribution(3);
ok(d !== null && d.directCostsUsdt === 120, "fixture: epoch 3 settled with non-zero direct costs");
ok(d !== null && d.revenue === null, "L-16: revenue line items are null (not published), not []");
ok(d !== null && d.costs === null, "L-16: cost line items are null (not published), not []");

// 인덱서 정상: 측정값은 그대로, 0 도 그대로
INDEX = "up"; indexHits = 0;
const up = await chainAdapter.getPoolStats();
ok(indexHits > 0, "fixture: the fake index was actually read");
ok(up.grossReceivedUsdt30d === 1000 && up.grossReceivedUsdt7d === 50, "index up: gross windows come from the index");
ok(up.grossReceivedUsdtToday === 0, "index up: a measured 0 stays 0 (not null)");
ok(up.distributedToParticipantsUsdt30d === 400, "index up: paid 30d comes from the index");
const hUp = await chainAdapter.getTxHistory();
ok(Array.isArray(hUp) && hUp.length === 0, "L-8: index read and empty gives [] (really no transactions)");

// 인덱서 장애: 0 이나 누적값이 아니라 null
INDEX = "down";
const down = await chainAdapter.getPoolStats();
ok(down.grossReceivedUsdtToday === null && down.grossReceivedUsdt7d === null && down.grossReceivedUsdt30d === null,
  "index down: gross windows are null, not 0");
ok(down.distributedToParticipantsUsdt30d === null, "index down: paid 30d is null");
ok(down.distributedToParticipantsUsdt30d !== 777, "index down: the lifetime total is not shown under the 30d label");
const hDown = await chainAdapter.getTxHistory();
ok(hDown === null, "L-8: index down gives null (unavailable), not [] (\"No transactions yet\")");

// 인덱서 미설정: 같은 규칙 (DEPLOYMENT 는 평범한 객체라 테스트에서 비울 수 있다)
const { DEPLOYMENT } = await import("./src/config/deployment");
const savedUrl = DEPLOYMENT.indexerUrl;
(DEPLOYMENT as any).indexerUrl = "";
INDEX = "up"; indexHits = 0;
const hOff = await chainAdapter.getTxHistory();
const poolOff = await chainAdapter.getPoolStats();
(DEPLOYMENT as any).indexerUrl = savedUrl;
ok(indexHits === 0, "fixture: with the index unconfigured nothing is fetched");
ok(hOff === null, "L-8: index not configured gives null, not []");
ok(poolOff.grossReceivedUsdt30d === null && poolOff.distributedToParticipantsUsdt30d === null, "index not configured: 30d figures are null");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
