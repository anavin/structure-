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
