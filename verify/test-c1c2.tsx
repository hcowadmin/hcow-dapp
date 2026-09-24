// C-1 / C-2 검증 (배포물에 포함하지 않음). npx tsx test-c1c2.tsx
import * as React from "react";
import { renderToString } from "react-dom/server";
import { EpochWaterfall } from "./src/components/EpochWaterfall";
(globalThis as any).React = React; // tsx 가 루트 파일을 classic JSX 로 변환할 때 대비
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  PASS  " + m); } else { fail++; console.log("  FAIL  " + m); } };
const base: any = {
  epoch: 7, settledAt: 1_900_000_000_000, txHash: "0x" + "ab".repeat(32), grossReceivedUsdt: 1000, revenue: [], costs: [], directCostsUsdt: 0,
  netRevenueUsdt: 1000, operatingCostsUsdt: 0, operatingCostsAboveCapUsdt: 0, distributableProfitUsdt: 1000,
  participantsUsdt: 500, gameStudioUsdt: 250, teamUsdt: 250, totalHcowDeducted: 0, snapshotBondedHcow: 1,
};
let html = "";
try { html = renderToString(<EpochWaterfall distribution={{ ...base, chainVerifiableRatio: null }} />); } catch (e) { html = "RENDER ERROR " + (e as Error).message; }
ok(!html.startsWith("RENDER ERROR"), "EpochWaterfall renders with chainVerifiableRatio null: " + html.slice(0, 80));
ok(html.includes("Measurement pending"), "null shows Measurement pending");
ok(!html.startsWith("RENDER ERROR") && !/0\.0\s*%/.test(html), "null does not show 0.0% (and it actually rendered)");
ok(!html.startsWith("RENDER ERROR") && !html.includes('role="progressbar"'), "null renders no progress bar (a bar would draw an empty 0%)");
let html2 = "";
try { html2 = renderToString(<EpochWaterfall distribution={{ ...base, chainVerifiableRatio: 0.25 }} />); } catch (e) { html2 = "RENDER ERROR " + (e as Error).message; }
ok(/25\.0\s*%/.test(html2) && !html2.includes("Measurement pending"), "a measured 0.25 still shows 25.0% and no pending label");
ok(html2.includes('role="progressbar"'), "a measured 0.25 still draws the progress bar");
let html3 = "";
try { html3 = renderToString(<EpochWaterfall distribution={{ ...base, chainVerifiableRatio: 0 }} />); } catch (e) { html3 = "RENDER ERROR " + (e as Error).message; }
ok(/0\.0\s*%/.test(html3), "a measured 0 is still shown as 0.0% (only null means pending)");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
