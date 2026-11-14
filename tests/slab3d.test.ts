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
  // รวมกับน้ำหนักบนคาน (ผนัง)
  near(defaultLoad({ ...p, sdl: 5 }, "BY-A1-1").sdl, 5 + wD * 1.5, 1e-3);
});

test("น้ำหนักอาคาร: ใช้พื้นที่แผ่นจริง และโมเดลใช้น้ำหนักที่กระจายแล้ว", () => {
  const W0 = storeyWeights({ ...p, slab: { ...defaultSlab } }, [5, 5, 5], [4.5, 4.5], [4, 3.5, 3.5, 3.5], 0.25);
  const W1 = storeyWeights(p, [5, 5, 5], [4.5, 4.5], [4, 3.5, 3.5, 3.5], 0.25);
  near(W1[0] - W0[0], 135 * (24 * 0.12 + (100 + 0.25 * 200) * KG_M2));
  const { model } = generateBuilding(p);
  const l = model.loadCases.find((c) => c.id === "DL")!.loads.find((x) => x.type === "udl" && x.member === "BY-A2-1");
  near(l && l.type === "udl" ? -l.w : 0, wD * 3.0, 1e-3);
});
