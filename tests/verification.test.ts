import { test } from "node:test";
import assert from "node:assert/strict";
import { relErr, runBenchmarks } from "../src/verify/benchmarks.ts";

test("ชุดตรวจความถูกต้องเทียบผลเฉลยปิด: ทุกรายการอยู่ในเกณฑ์", () => {
  const rows = runBenchmarks();
  assert.ok(rows.length >= 15);
  for (const r of rows) assert.ok(relErr(r) <= r.tol, `${r.group} — ${r.name}: ทฤษฎี ${r.theory} โปรแกรม ${r.program}`);
});
