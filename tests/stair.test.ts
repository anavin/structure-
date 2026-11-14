import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultStair, designStair } from "../src/design/stair.ts";

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test("บันได: ขั้น ความชัน น้ำหนัก และ Mu = wu·Ln²/8 (เทียบมือ)", () => {
  const s = { ...defaultStair, enabled: true, Ln: 3.6, H: 1.75, tread: 0.25, t: 0.18 };
  const r = designStair(s, 240, 4000, "EIT");
  assert.equal(r.n, 10);
  near(r.R, 0.175);
  const cos = 0.25 / Math.hypot(0.25, 0.175);
  near(r.cos, cos);
  const wD = 24 * (0.18 / cos + 0.175 / 2) + 100 * 0.00980665, wL = 300 * 0.00980665;
  near(r.wD, wD);
  near(r.Mu, (1.4 * wD + 1.7 * wL) * 3.6 * 3.6 / 8);
  assert.ok(r.ok);
  assert.ok(r.main.As >= r.main.AsReq);
  near(r.reaction, (wD + wL) * 3.6 / 2);
});

test("บันไดบาง/ช่วงยาวไม่ผ่าน · ต่อเนื่องใช้ /10", () => {
  assert.equal(designStair({ ...defaultStair, Ln: 4.5, t: 0.12 }, 240, 4000, "EIT").ok, false);
  const a = designStair({ ...defaultStair }, 240, 4000, "EIT"), b = designStair({ ...defaultStair, support: "continuous" }, 240, 4000, "EIT");
  near(b.Mu, a.Mu * 8 / 10);
});
