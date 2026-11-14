import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, defaultSlab, generateBuilding, storeyWeights } from "../src/app3d/generator.ts";
import { runAll3, storeyDrifts } from "../src/core3d/combos3d.ts";
import { defaultDesign3, design3d } from "../src/design/design3d.ts";
import { boq3d } from "../src/design/boq3d.ts";
import { frameFrom3D } from "../src/shared/frameFrom3d.ts";

const walls = [{ dir: "Y" as const, line: 0, span: 0, t: 0.2 }, { dir: "X" as const, line: 2, span: 1, t: 0.25 }];
const p = { ...defaultGrid, slab: { ...defaultSlab, enabled: true }, layout: { walls } };

test("ผนัง: ชิ้นผนังทุกชั้น แขนแข็ง จุดรองรับ แทนคาน และแขนแข็งรับน้ำหนักพื้น", () => {
  const { model } = generateBuilding(p);
  assert.equal(model.members.filter((m) => m.kind === "wall").length, 2 * 4);
  assert.equal(model.members.filter((m) => m.kind === "link").length, 2 * 2 * 4);
  assert.ok(!model.members.some((m) => m.id === "BY-A1-2") && !model.members.some((m) => m.id === "BX-C2-3"));
  assert.ok(model.supports.some((s) => s.node === "A1-0-wY" && s.rx && s.ry));
  const sec = model.sections.find((s) => s.id === model.members.find((m) => m.id === "WY-A1-0")!.section)!;
  assert.deepEqual([sec.b, sec.h], [4.5, 0.2]); // ผนังแนว Y: b = Lw
  const dl = model.loadCases.find((c) => c.id === "DL")!.loads.filter((l) => l.type === "udl" && l.member.startsWith("LY-A1-2"));
  assert.equal(dl.length, 2);
  assert.ok(dl.every((l) => l.type === "udl" && l.w < 0));
  assert.equal(model.materials.find((m) => m.id === "RIGIDMAT")!.gamma, 0);
  const W0 = storeyWeights({ ...p, layout: {} }, [5, 5, 5], [4.5, 4.5], [4, 3.5, 3.5, 3.5], 0.25);
  const W1 = storeyWeights(p, [5, 5, 5], [4.5, 4.5], [4, 3.5, 3.5, 3.5], 0.25);
  assert.ok(W1[1] > W0[1]);
});

test("ผนังเพิ่มความแข็งด้านข้าง ออกแบบผนังได้ และเข้า BOQ", () => {
  const a = generateBuilding({ ...p, layout: {} }).model, b = generateBuilding(p).model;
  const ra = runAll3(a), rb = runAll3(b);
  const top = (m: typeof a, r: typeof ra) => { const d = storeyDrifts(m, r.results["case:WY"]); return Math.abs(d[d.length - 1].uy); };
  assert.ok(top(b, rb) < 0.5 * top(a, ra));
  const ds = design3d(b, rb, defaultDesign3);
  const w = ds["WY-A1-0"];
  assert.ok(w && w.kind === "wall");
  if (w.kind === "wall") { assert.ok(w.result.vertical && w.result.horizontal); assert.equal(w.Lw, 4500); assert.equal(w.t, 200); }
  assert.ok(!Object.keys(ds).some((id) => id.startsWith("L")));
  const bq = boq3d(b, ds, null, { cover: 40 });
  const row = bq.rows.find((r) => r.group === "ผนัง")!;
  assert.ok(Math.abs(row.conc - (4 * 0.2 * 4.5 * 3.625 + 4 * 0.25 * 5 * 3.625)) < 1e-6);
  assert.ok(Object.values(row.steel).reduce((s, v) => s + v, 0) > 0);
  // โครง 2D ยังสร้างได้ (ผนังไม่แสดงในโครง 2D)
  assert.ok(frameFrom3D(p, { dir: "Y", line: 0 }).members.length > 0);
});

import { designFoundations3 } from "../src/design/foundation3d.ts";
import { defaultFoundation } from "../src/design/footing.ts";

test("ฐานรากใต้ผนัง: ออกแบบให้ทุกผนัง เป็นฐานแถบยาวตามแนวผนัง (แผ่และเข็ม)", () => {
  const { model } = generateBuilding(p);
  const run = runAll3(model);
  const sp = designFoundations3(model, run, defaultFoundation, "EIT").footings;
  const fy = sp["A1-0-wY"], fx = sp["C2-0-wX"];
  assert.ok(fy && fx);
  assert.ok(fy.B > fy.L, `ผนังแนว Y: B ${fy.B} > L ${fy.L}`); // ยาวตามแกน Y
  assert.ok(fx.L > fx.B);
  assert.ok(fy.B >= 4.5 && fx.L >= 5);
  const pile = designFoundations3(model, run, { ...defaultFoundation, type: "pile", pileTon: 30 }, "EIT").footings["A1-0-wY"];
  assert.ok(pile && pile.piles && pile.piles.coords.length >= 2);
});
