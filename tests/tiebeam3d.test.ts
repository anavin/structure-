import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOverride, defaultGrid, effectiveSize, generateBuilding, isTieBeam } from "../src/app3d/generator.ts";
import { runAll3 } from "../src/core3d/combos3d.ts";
import { frameFrom3D, overridesFrom2D } from "../src/shared/frameFrom3d.ts";

const p = { ...defaultGrid, tieBeam: { enabled: true, b: 0.25, h: 0.45, sdl: 6 } };

test("คานคอดิน: สร้างที่ระดับ 0 ฐานหมุนได้ น้ำหนักผนัง ไม่มี LL", () => {
  const { model } = generateBuilding(p);
  const ties = model.members.filter((m) => isTieBeam(m.id));
  assert.equal(ties.length, 3 * 3 + 4 * 2); // เท่ากับคานหนึ่งชั้น
  assert.ok(ties.every((m) => m.section === "TIE"));
  assert.ok(model.supports.every((s) => s.ux && s.uy && s.uz && !s.rx && !s.ry && s.rz));
  const dl = model.loadCases.find((c) => c.id === "DL")!.loads.find((l) => l.type === "udl" && l.member === "BX-A1-0");
  assert.equal(dl && dl.type === "udl" ? dl.w : 0, -6);
  assert.ok(!model.loadCases.find((c) => c.id === "LL")!.loads.some((l) => l.type === "udl" && isTieBeam(l.member)));
  assert.equal(model.diaphragms?.length, 4); // ไม่มีพื้นแข็งที่ระดับฐาน
  assert.deepEqual(effectiveSize(p, "BY-B2-0"), { b: 0.25, h: 0.45 });
  // ไม่มีคานคอดิน → ฐานยึดแน่น
  assert.ok(generateBuilding(defaultGrid).model.supports.every((s) => s.rx && s.ry));
});

test("คานคอดินรับโมเมนต์ที่ฐาน: แรงปฏิกิริยาโมเมนต์เป็นศูนย์ และคานคอดินมีโมเมนต์จากแรงลม", () => {
  const { model } = generateBuilding(p);
  const run = runAll3(model);
  const r = run.results["case:WX"];
  for (const re of Object.values(r.reactions)) { assert.ok(Math.abs(re.mx) < 1e-6 && Math.abs(re.my) < 1e-6); }
  const tie = r.members["BX-A1-0"];
  assert.ok(tie.maxAbs.Mz > 1, `M ของคานคอดิน ${tie.maxAbs.Mz}`);
});

test("คานคอดินในโครง 2D และค่าปรับรายชิ้นของคานคอดิน", () => {
  const m = frameFrom3D(p, { dir: "X", line: 0 });
  assert.ok(m.members.some((x) => x.id === "BX-A1-0"));
  assert.ok(m.supports.every((s) => !s.rz));
  assert.deepEqual(overridesFrom2D(p, m), {}); // โครงที่ไม่แก้ → ไม่มีค่าปรับ
  const p2 = applyOverride(p, ["BX-A1-0"], { size: { b: 0.3, h: 0.6 }, load: { sdl: 10, ll: 0 } });
  const sec = (mm: typeof m, id: string) => mm.sections.find((s) => s.id === mm.members.find((x) => x.id === id)!.section)!;
  assert.equal(sec(frameFrom3D(p2, { dir: "X", line: 0 }), "BX-A1-0").h, 0.6);
  assert.deepEqual(applyOverride(p2, ["BX-A1-0"], { size: { b: 0.25, h: 0.45 }, load: { sdl: 6, ll: 0 } }).overrides, undefined);
});
