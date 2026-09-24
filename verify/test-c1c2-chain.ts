// C-1 / C-2 검증: chainAdapter 가 "측정 안 됨" 을 null 로 돌려주는지 (배포물에 포함하지 않음).
// RPC 와 인덱서를 프로세스 안에서 가짜로 답한다. 네트워크를 쓰지 않는다.  npx tsx test-c1c2-chain.ts
import { FetchRequest, FetchResponse, AbiCoder } from "ethers";
const coder = AbiCoder.defaultAbiCoder();
const U = (n: bigint) => coder.encode(["uint256"], [n]);
const SETTLEMENT = coder.encode(
  ["tuple(uint128,uint128,uint128,uint128,uint128,uint128,uint128,uint64)"],
  [[10n ** 21n, 0n, 0n, 10n ** 21n, 5n * 10n ** 20n, 0n, 10n ** 18n, 1_900_000_000n]],
);
const SEL_SETTLEMENT = "0x" + (await import("ethers")).id("getSettlement(uint64)").slice(2, 10);
FetchRequest.registerGetUrl(async (req) => {
  const body = JSON.parse(new TextDecoder().decode(req.body!));
  const one = (m: any) => {
    if (m.method === "eth_chainId") return { jsonrpc: "2.0", id: m.id, result: "0x61" };
    if (m.method === "eth_call") {
      const data: string = m.params[0].data;
      return { jsonrpc: "2.0", id: m.id, result: data.startsWith(SEL_SETTLEMENT) ? SETTLEMENT : U(7n * 10n ** 18n) };
    }
    return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "fake rpc: " + m.method } };
  };
  const out = Array.isArray(body) ? body.map(one) : one(body);
  return { statusCode: 200, statusMessage: "OK", headers: { "content-type": "application/json" }, body: new TextEncoder().encode(JSON.stringify(out)) };
});
// 인덱서: 30일 창에 수입이 있는 상태 (C-1 의 원래 모순 조건: gross > 0 인데 "아무것도 안 들어왔다")
(globalThis as any).fetch = async (url: string) => {
  const u = String(url);
  const rows = u.includes("window") || u.includes("revenue")
    ? [{ gross_24h: "0", gross_7d: "0", gross_30d: String(10n ** 21n), participants_30d: "0" }]
    : [];
  return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
};
void FetchResponse;

const { chainAdapter } = await import("./src/data/chain");
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  PASS  " + m); } else { fail++; console.log("  FAIL  " + m); } };

const pool = await chainAdapter.getPoolStats();
ok(pool.grossReceivedUsdt30d > 0, "fixture: the 30d window really has gross > 0 (" + pool.grossReceivedUsdt30d + ")");
ok(pool.revenue30dByOrigin === null, "C-1: revenue30dByOrigin is null (not measured), not [] (\"nothing arrived\")");
ok(pool.chainVerifiableRatio30d === null, "C-2: chainVerifiableRatio30d is null, not 0");
const d = await chainAdapter.getEpochDistribution(3);
ok(d !== null, "fixture: epoch 3 is settled");
ok(d !== null && d.chainVerifiableRatio === null, "C-2: EpochDistribution.chainVerifiableRatio is null, not 0");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
