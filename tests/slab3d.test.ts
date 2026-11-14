import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, defaultLoad, defaultSlab, edgeFactor, generateBuilding, KG_M2, slabLineLoad, storeyWeights } from "../src/app3d/generator.ts";

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
// กริด X 3@5, Y 2@4.5, 4 ชั้น — พื้น t 0.12, SDL 100, LL 200 kg/m² (หลังคา 50/100)
const p = { ...defaultGrid, sdl: 0, ll: 0, sdlRoof: 0, llRoof: 0, slab: { ...defaultSlab, enabled: true } };
const wD = 24 * 0.12 + 100 * KG_M2, wL = 200 * KG_M2;

test("สัมประสิทธิ์แผ่นสองทาง: ด้านสั้น S/3, ด้านยาว S/3·(3−m²)/2", () => {
  near(edgeFactor(4.5, 5), 1.5);
  near(edgeFactor(5, 4.5), 1.5 * (3 - 0.81) / 2);
  near(edgeFactor(4, 4), 4 / 3);
  near(edgeFactor(8, 2), (2 / 3) * (3 - 1 / 16) / 2); // ทางเดียว → เกือบ S/2
});

test("น้ำหนักลงคาน: คานในรับสองแผ่น คานริมรับแผ่นเดียว หลังคาใช้ค่าหลังคา", () => {
  const kIn = 2 * 1.5 * (3 - 0.81) / 2; // BX แถวกลาง ด้านยาว 5 m สองข้าง
  near(slabLineLoad(p, "BX-B1-1").sdl, wD * kIn);
  near(slabLineLoad(p, "BX-B1-1").ll, wL * kIn);
  near(slabLineLoad(p, "BX-A1-1").sdl, wD * kIn / 2);
  near(slabLineLoad(p, "BY-A2-1").sdl, wD * 3.0);  // ด้านสั้น 4.5 m สองข้าง
  near(slabLineLoad(p, "BY-A1-1").sdl, wD * 1.5);
  const roofD = 24 * 0.12 + 50 * KG_M2;
  near(slabLineLoad(p, "BY-A2-4").sdl, roofD * 3.0);
  assert.deepEqual(slabLineLoad(p, "BX-A1-0"), { sdl: 0, ll: 0 }); // คานคอดินไม่รับพื้น
  assert.deepEqual(slabLineLoad(defaultGrid, "BX-B1-1"), { sdl: 0, ll: 0 }); // ปิดพื้น
  // น้ำหนักบนคาน (ผนัง) แยกจากน้ำหนักพื้น (พื้นคิดตามรูปจริงด้วย slabShape)
  near(defaultLoad({ ...p, sdl: 5 }, "BY-A1-1").sdl, 5, 1e-9);
});

test("น้ำหนักอาคาร: ใช้พื้นที่แผ่นจริง และโมเดลใช้น้ำหนักที่กระจายแล้ว", () => {
  const W0 = storeyWeights({ ...p, slab: { ...defaultSlab } }, [5, 5, 5], [4.5, 4.5], [4, 3.5, 3.5, 3.5], 0.25);
  const W1 = storeyWeights(p, [5, 5, 5], [4.5, 4.5], [4, 3.5, 3.5, 3.5], 0.25);
  near(W1[0] - W0[0], 135 * (24 * 0.12 + (100 + 0.25 * 200) * KG_M2));
  const { model } = generateBuilding(p);
  // BY-A2-1 ยาว 4.5 m มีแผ่น 5 m สองข้าง → สามเหลี่ยมสองรูปยอด 2.25 m: ผลรวม = 2 × ½·4.5·2.25 = 10.125 m² × wD
  const l = model.loadCases.find((c) => c.id === "DL")!.loads.find((x) => x.type === "dist" && x.member === "BY-A2-1");
  assert.ok(l && l.type === "dist");
  if (l.type === "dist") {
    const tot = l.pts.slice(1).reduce((a, [x, w], k) => a + ((w + l.pts[k][1]) / 2) * (x - l.pts[k][0]), 0);
    near(-tot, wD * 10.125, 1e-6);
    near(Math.min(...l.pts.map(([, w]) => w)), -wD * 4.5, 1e-9); // ยอดสามเหลี่ยมกลางคาน = 2 × 2.25
  }
  // ผลรวมน้ำหนักพื้นบนคานทุกตัว = พื้นที่แผ่น × w (อนุรักษ์น้ำหนัก — เดิมแบบเทียบเท่าโมเมนต์เกิน 25–33%)
  const sumDist = model.loadCases.find((c) => c.id === "DL")!.loads.filter((x) => x.type === "dist" && x.member.endsWith("-1"))
    .reduce((a, x) => a + (x.type === "dist" ? x.pts.slice(1).reduce((s, [xx, w], k) => s + ((w + x.pts[k][1]) / 2) * (xx - x.pts[k][0]), 0) : 0), 0);
  near(-sumDist, 135 * wD, 1e-6);
});
