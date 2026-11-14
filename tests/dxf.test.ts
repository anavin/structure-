import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDxf, DxfWriter, parseDxfGrid, spacingText } from "../src/app3d/dxf.ts";
import { defaultGrid, generateBuilding } from "../src/app3d/generator.ts";
import { runAll3 } from "../src/core3d/combos3d.ts";
import { defaultDesign3, design3d } from "../src/design/design3d.ts";

test("ข้อความไทยเป็น \\U+XXXX และไฟล์มีโครงสร้าง DXF ครบ", () => {
  assert.equal(DxfWriter.enc("คาน B-1"), "\\U+0E04\\U+0E32\\U+0E19 B-1");
  const { model } = generateBuilding(defaultGrid);
  const run = runAll3(model);
  const txt = buildDxf({ name: "test", model, design: design3d(model, run, defaultDesign3), footings: null, slabs: [], xs: [0, 5, 10, 15], ys: [0, 4.5, 9], zs: [0, 4, 7.5, 11, 14.5], openings: () => false, pileSize: 0.3 });
  assert.ok(txt.startsWith("0\r\nSECTION\r\n2\r\nHEADER"));
  assert.ok(txt.trimEnd().endsWith("EOF"));
  for (const l of ["GRID", "COLUMN", "BEAM", "REBAR"]) assert.ok(txt.includes(`\r\n8\r\n${l}\r\n`), l);
  assert.ok(/[^\x00-\x7f]/.test(txt) === false, "ไม่มีอักขระนอก ASCII");
  // จำนวนบรรทัดเป็นคู่ (รหัส/ค่า)
  assert.equal(txt.trimEnd().split("\r\n").length % 2, 0);
});

test("นำเข้ากริดจากเส้น LINE (mm) และ LWPOLYLINE บนเลเยอร์ AXIS", () => {
  const w = new DxfWriter();
  for (const x of [0, 4000, 8000, 12500]) w.line("A-GRID", x, -1000, x, 10000);
  for (const y of [0, 4500, 9000]) w.line("A-GRID", -1000, y, 13500, y);
  w.line("WALL", 100, 100, 3900, 100); // เส้นอื่นที่ไม่ใช่กริด
  const g = parseDxfGrid(w.toString());
  assert.equal(g.unit, "mm");
  assert.deepEqual(g.xs, [0, 4, 8, 12.5]);
  assert.deepEqual(g.ys, [0, 4.5, 9]);
  assert.equal(spacingText(g.xs), "2@4,4.5");
  assert.equal(spacingText(g.ys), "2@4.5");
  // LWPOLYLINE ในเลเยอร์ AXIS (หน่วย m)
  const lw = ["0", "SECTION", "2", "ENTITIES",
    ...[0, 6, 12].flatMap((x) => ["0", "LWPOLYLINE", "8", "AXIS", "90", "2", "10", `${x}`, "20", "-1", "10", `${x}`, "20", "9"]),
    ...[0, 8].flatMap((y) => ["0", "LWPOLYLINE", "8", "AXIS", "90", "2", "10", "-1", "20", `${y}`, "10", "13", "20", `${y}`]),
    "0", "ENDSEC", "0", "EOF"].join("\n");
  const g2 = parseDxfGrid(lw);
  assert.equal(g2.unit, "m");
  assert.deepEqual(g2.xs, [0, 6, 12]);
  assert.deepEqual(g2.ys, [0, 8]);
  assert.throws(() => parseDxfGrid("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF"));
});
