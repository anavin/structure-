import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, defaultSlab, generateBuilding, panelExists, parseOpenings, slabLineLoad, storeyWeights } from "../src/app3d/generator.ts";
import { runAll3 } from "../src/core3d/combos3d.ts";
import { designBuildingSlabs } from "../src/design/slab3d.ts";
import { frameFrom3D } from "../src/shared/frameFrom3d.ts";
import { runAll } from "../src/core/combos.ts";

// กริด X 3@5 (A1..A4), Y 2@4.5 (A,B,C), 4 ชั้น
const slab = { ...defaultSlab, enabled: true };

test("ลบเสาชั้นล่าง: ตัดจุดรองรับ แต่จุดต่อชั้นบนยังมี และวิเคราะห์ได้", () => {
  const p = { ...defaultGrid, layout: { removed: ["C-B2-0"] } };
  const { model } = generateBuilding(p);
  assert.ok(!model.members.some((m) => m.id === "C-B2-0"));
  assert.ok(!model.supports.some((s) => s.node === "B2-0"));
  assert.ok(!model.nodes.some((n) => n.id === "B2-0"));
  assert.ok(model.nodes.some((n) => n.id === "B2-1"));
  const run = runAll3(model);
  assert.ok(Math.abs(run.results["combo:U1"].disp["B2-1"].uz) > Math.abs(run.results["combo:U1"].disp["B3-1"].uz)); // จุดที่ไม่มีเสาแอ่นมากกว่า
});

test("ช่องเปิดพื้น: แผ่นหายไป คานรอบช่องรับน้ำหนักข้างเดียว และน้ำหนักอาคารลดลง", () => {
  assert.deepEqual(parseOpenings("*:b2, 3:A1 ,x:1, 2:C"), ["*:B2", "3:A1"]);
  const p = { ...defaultGrid, slab, layout: { openings: ["*:A2"] } };
  assert.equal(panelExists(p, 1, 1, 0), false);
  assert.equal(panelExists(p, 1, 0, 0), true);
  // BY-A2-1 = ขอบระหว่างช่อง A1 กับ A2 → เหลือแผ่น A1 ด้านเดียว
  const full = slabLineLoad({ ...defaultGrid, slab }, "BY-A2-1").sdl, half = slabLineLoad(p, "BY-A2-1").sdl;
  assert.ok(Math.abs(half - full / 2) < 1e-9);
  const W0 = storeyWeights({ ...defaultGrid, slab }, [5, 5, 5], [4.5, 4.5], [4, 3.5, 3.5, 3.5], 0.25);
  const W1 = storeyWeights(p, [5, 5, 5], [4.5, 4.5], [4, 3.5, 3.5, 3.5], 0.25);
  assert.ok(W1[0] < W0[0]);
  const types = designBuildingSlabs(p, "EIT");
  assert.equal(types.reduce((a, t) => a + t.panels.length, 0), 4 * 5);
  // ลบคานขอบ → แผ่นนั้นไม่มี
  assert.equal(panelExists({ ...p, layout: { removed: ["BX-B1-2"] } }, 2, 0, 0), false);
});

test("คานยื่น: สร้างทุกแนวกริดของด้านนั้น รับพื้นยื่น และอยู่ในโครง 2D", () => {
  const p = { ...defaultGrid, slab, layout: { cantilevers: [{ side: "y0" as const, length: 1.5, fromLevel: 2 }] } };
  const { model } = generateBuilding(p);
  const k = model.members.filter((m) => m.id.startsWith("KY-"));
  assert.equal(k.length, 4 * 3); // 4 แนว × ชั้น 2–4
  const tip = model.nodes.find((n) => n.id === "A1-2-y0")!;
  assert.equal(tip.y, -1.5);
  assert.ok(slabLineLoad(p, "KY-A2-2").sdl > 0);
  const run = runAll3(model);
  assert.ok(run.results["combo:U1"].disp["A1-2-y0"].uz < 0);
  const fr = frameFrom3D(p, { dir: "Y", line: 0 });
  assert.ok(fr.members.some((m) => m.id === "KY-A1-2"));
  assert.ok(runAll(fr).combos.U1);
  assert.ok(!frameFrom3D(p, { dir: "X", line: 0 }).members.some((m) => m.id.startsWith("K")));
});
