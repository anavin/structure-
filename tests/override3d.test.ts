import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOverride, defaultGrid, effectiveLoad, effectiveSize, generateBuilding, membersInScope } from "../src/app3d/generator.ts";

const ids = generateBuilding(defaultGrid).model.members.map((m) => m.id); // 4×3 กริด 4 ชั้น

test("ขอบเขตการแก้: ชิ้น / ชั้น / แนว", () => {
  assert.deepEqual(membersInScope(ids, "BX-B1-2", "member"), ["BX-B1-2"]);
  const floor = membersInScope(ids, "BX-B1-2", "floor");
  assert.equal(floor.length, 3 * 3 + 4 * 2); // BX 3 แถว×3 ช่วง + BY 4 แนว×2 ช่วง
  assert.ok(floor.every((x) => x.endsWith("-2") && x.startsWith("B")));
  const line = membersInScope(ids, "BX-B1-2", "line");
  assert.equal(line.length, 3 * 4); // แถว B 3 ช่วง × 4 ชั้น
  assert.ok(line.every((x) => x.startsWith("BX-B")));
  assert.equal(membersInScope(ids, "BY-A2-1", "line").length, 2 * 4);
  assert.deepEqual(membersInScope(ids, "C-B2-0", "line"), ["C-B2-0", "C-B2-1", "C-B2-2", "C-B2-3"]);
  assert.equal(membersInScope(ids, "C-B2-0", "floor").length, 12);
});

test("ตั้ง/คืนค่าปรับ และโมเดลใช้ค่าปรับ", () => {
  let p = applyOverride(defaultGrid, ["C-B2-0", "C-B2-1"], { size: { b: 0.5, h: 0.6 } });
  p = applyOverride(p, ["BX-A1-4"], { load: { sdl: 20, ll: 0 } });
  assert.deepEqual(effectiveSize(p, "C-B2-0"), { b: 0.5, h: 0.6 });
  assert.deepEqual(effectiveLoad(p, "BX-A1-4"), { sdl: 20, ll: 0 });
  assert.deepEqual(effectiveLoad(p, "BX-A1-3"), { sdl: 15, ll: 8 });
  const m = generateBuilding(p).model;
  assert.equal(m.sections.find((s) => s.id === m.members.find((x) => x.id === "C-B2-1")!.section)!.h, 0.6);
  // คืนค่า / ค่าเท่าค่าทั้งอาคาร → ลบ
  p = applyOverride(p, ["C-B2-0"], { size: null });
  p = applyOverride(p, ["C-B2-1"], { size: { b: 0.4, h: 0.4 } });
  p = applyOverride(p, ["BX-A1-4"], { load: { sdl: 8, ll: 2 } });
  assert.equal(p.overrides, undefined);
});

import { growSizes } from "../src/design/autosize3d.ts";

test("ปรับขนาดอัตโนมัติ: ขยายเฉพาะชิ้นที่ไม่ผ่าน ปัด 5 cm และหยุดที่ขนาดสูงสุด", () => {
  const r = growSizes(defaultGrid, {
    "BX-A1-1": { kind: "beam", ok: false, ratio: 1.3 },   // h 0.5·√1.3·1.03 = 0.587 → 0.60
    "BX-A2-1": { kind: "beam", ok: true, ratio: 0.8 },
    "C-A1-0": { kind: "column", ok: false, ratio: 1.02 }, // ขั้นต่ำ +5 cm → 0.45
    "BY-A1-1": { kind: "beam", ok: false, ratio: 3.9 },   // h → 1.05, b → 0.35 (h/b ≤ 3)
  });
  assert.deepEqual(r.changed.sort(), ["BX-A1-1", "BY-A1-1", "C-A1-0"]);
  assert.deepEqual(effectiveSize(r.params, "BX-A1-1"), { b: 0.25, h: 0.6 });
  assert.deepEqual(effectiveSize(r.params, "C-A1-0"), { b: 0.45, h: 0.45 });
  assert.deepEqual(effectiveSize(r.params, "BY-A1-1"), { b: 0.35, h: 1.05 });
  assert.deepEqual(effectiveSize(r.params, "BX-A2-1"), { b: 0.25, h: 0.5 });
  const capped = growSizes(applyOverride(defaultGrid, ["C-A1-0"], { size: { b: 1.5, h: 1.5 } }), { "C-A1-0": { kind: "column", ok: false, ratio: 1.2 } });
  assert.deepEqual(capped.capped, ["C-A1-0"]);
});

test("ปรับขนาดอัตโนมัติ: คานที่เหล็กวางไม่พอเพิ่มความกว้าง ไม่เพิ่มความลึก", () => {
  const r = growSizes(defaultGrid, {
    "BX-A1-1": { kind: "beam", ok: false, ratio: Infinity, width: true },
    "BX-A2-1": { kind: "beam", ok: false, ratio: Infinity, width: true, depth: true },
    "BX-A3-1": { kind: "beam", ok: false, ratio: 0.9, torsion: true },
  });
  assert.deepEqual(effectiveSize(r.params, "BX-A1-1"), { b: 0.3, h: 0.5 });
  assert.deepEqual(effectiveSize(r.params, "BX-A2-1"), { b: 0.3, h: 0.65 });
  assert.deepEqual(effectiveSize(r.params, "BX-A3-1"), { b: 0.3, h: 0.5 });
});
