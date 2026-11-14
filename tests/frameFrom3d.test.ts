import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid } from "../src/app3d/generator.ts";
import { frameFrom3D, frameOfMember } from "../src/shared/frameFrom3d.ts";
import { runAll } from "../src/core/combos.ts";
import { defaultSeismic } from "../src/loads/seismicTH.ts";

test("หาแนวโครงจากชื่อชิ้นส่วน 3D", () => {
  assert.deepEqual(frameOfMember("BX-B2-1"), { dir: "X", line: 1 });
  assert.deepEqual(frameOfMember("BY-A3-2"), { dir: "Y", line: 2 });
  assert.deepEqual(frameOfMember("C-C1-0", "Y"), { dir: "Y", line: 0 });
  assert.equal(frameOfMember("XYZ"), null);
});

test("ตัดโครงแนว X: ชื่อเดิมของ 3D, หน้าตัด, ลมใช้ความกว้างรับลม, วิเคราะห์ได้", () => {
  // defaultGrid: X = 3@5, Y = 2@4.5, 4 ชั้น
  const m = frameFrom3D(defaultGrid, { dir: "X", line: 1 });
  assert.equal(m.nodes.length, 4 * 5);
  assert.equal(m.members.filter((x) => x.kind === "column").length, 16);
  assert.equal(m.members.filter((x) => x.kind === "beam").length, 12);
  assert.ok(m.members.some((x) => x.id === "BX-B2-1"));
  assert.ok(m.members.some((x) => x.id === "C-B1-0"));
  assert.equal(m.wind?.spacing, 4.5); // แนวกลาง: ครึ่งช่วงสองข้าง
  assert.ok(m.loadCases.some((c) => c.id === "WX") && m.loadCases.some((c) => c.id === "WXN"));
  const run = runAll(m);
  assert.ok(run.combos.U1);
});

test("โครงแนว Y สลับด้านเสา และส่วนแบ่งแรงแผ่นดินไหว", () => {
  const p = { ...defaultGrid, col: { b: 0.3, h: 0.5 }, seismic: { ...defaultSeismic, enabled: true } };
  const m = frameFrom3D(p, { dir: "Y", line: 0 });
  const col = m.sections.find((s) => s.id === "COL")!;
  assert.equal(col.b, 0.5); assert.equal(col.h, 0.3);
  assert.equal(m.wind?.spacing, 2.5); // แนวริม: ครึ่งช่วง 5 m
  const ex = m.loadCases.find((c) => c.id === "EX");
  assert.ok(ex && ex.lateral);
  assert.equal(m.combos.length, 9);
});
