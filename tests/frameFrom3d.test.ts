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
  const col = m.sections.find((s) => s.id === m.members.find((x) => x.kind === "column")!.section)!;
  assert.equal(col.b, 0.5); assert.equal(col.h, 0.3);
  assert.equal(m.wind?.spacing, 2.5); // แนวริม: ครึ่งช่วง 5 m
  const ex = m.loadCases.find((c) => c.id === "EX");
  assert.ok(ex && ex.lateral);
  assert.equal(m.combos.length, 9);
});

import { generateBuilding } from "../src/app3d/generator.ts";
import { overridesFrom2D } from "../src/shared/frameFrom3d.ts";

test("2D → 3D: แก้หน้าตัดและน้ำหนักคานในโครง → ค่าปรับรายชิ้นของ 3D (เฉพาะชิ้นในโครง)", () => {
  const p = { ...defaultGrid };
  const m = frameFrom3D(p, { dir: "Y", line: 0 });
  // เพิ่มหน้าตัดใหม่ให้คาน BY-A1-1 และเปลี่ยนน้ำหนัก DL บนคานนั้น
  m.sections.push({ id: "NEW", name: "คาน 30×70", material: "CONC", b: 0.3, h: 0.7 });
  m.members.find((x) => x.id === "BY-A1-1")!.section = "NEW";
  // เสาในโครงแนว Y: b ในโครง = h ของ 3D
  m.sections.push({ id: "CNEW", name: "เสา", material: "CONC", b: 0.6, h: 0.4 });
  m.members.find((x) => x.id === "C-A1-0")!.section = "CNEW";
  const dl = m.loadCases.find((c) => c.id === "DL")!;
  for (const l of dl.loads) if (l.type === "udl" && l.member === "BY-A1-1") l.w = -22;
  const ov = overridesFrom2D(p, m);
  assert.deepEqual(ov.size, { "BY-A1-1": { b: 0.3, h: 0.7 }, "C-A1-0": { b: 0.4, h: 0.6 } });
  assert.deepEqual(ov.load, { "BY-A1-1": { sdl: 22, ll: 8 } });
  // 3D ใช้ค่าปรับ
  const { model } = generateBuilding({ ...p, overrides: ov });
  const sec = (id: string) => model.sections.find((s) => s.id === model.members.find((x) => x.id === id)!.section)!;
  assert.equal(sec("BY-A1-1").h, 0.7);
  assert.equal(sec("C-A1-0").h, 0.6);
  assert.equal(sec("BY-A2-1").h, 0.5); // ชิ้นอื่นไม่เปลี่ยน
  const l = model.loadCases.find((c) => c.id === "DL")!.loads.find((x) => x.type === "udl" && x.member === "BY-A1-1");
  assert.equal(l && l.type === "udl" ? l.w : 0, -22);
  // 3D → 2D: โครงที่สร้างใหม่จากค่าปรับ แล้วดึงกลับได้ค่าปรับเดิม (ไม่วนเปลี่ยน)
  const m2 = frameFrom3D({ ...p, overrides: ov }, { dir: "Y", line: 0 });
  assert.equal(m2.sections.find((s) => s.id === m2.members.find((x) => x.id === "C-A1-0")!.section)!.b, 0.6);
  assert.deepEqual(overridesFrom2D({ ...p, overrides: ov }, m2), ov);
  // กลับเป็นค่าเดิม → ลบค่าปรับ
  assert.deepEqual(overridesFrom2D({ ...p, overrides: ov }, frameFrom3D(p, { dir: "Y", line: 0 })), {});
});

test("3D → 2D: เปลี่ยนช่วงเสา/จำนวนชั้นใน 3D ได้โครงใหม่ตาม", () => {
  const a = frameFrom3D(defaultGrid, { dir: "X", line: 0 });
  const b = frameFrom3D({ ...defaultGrid, xSpacing: "4@5", storeys: "4,4@3.5" }, { dir: "X", line: 0 });
  assert.equal(a.nodes.length, 4 * 5);
  assert.equal(b.nodes.length, 5 * 6);
  assert.throws(() => frameFrom3D({ ...defaultGrid, ySpacing: "4.5" }, { dir: "X", line: 2 }));
});
