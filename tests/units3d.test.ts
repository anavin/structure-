import { test } from "node:test";
import assert from "node:assert/strict";
import { convertText } from "../src/app3d/units.ts";

test("แปลงข้อความ kN → ตัน: ตัวเลขหลายตัวคั่น /, คงจำนวนทศนิยม, หน่วยรวม", () => {
  assert.equal(convertText("Pu = 98.07 kN"), "Pu = 10.00 tf");
  assert.equal(convertText("21.84 / -35.78 kN·m"), "2.23 / -3.65 tf·m");
  assert.equal(convertText("qmax 147.10 kN/m²"), "qmax 15.00 t/m²");
  assert.equal(convertText("w = 9.807 kN/m"), "w = 1.000 tf/m");
  assert.equal(convertText("1,961.33 kN"), "200.00 tf");
  assert.equal(convertText("ไม่มีหน่วย 12.5"), "ไม่มีหน่วย 12.5");
});
