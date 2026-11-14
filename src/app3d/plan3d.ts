// แปลนฐานราก 3D (SVG) ใช้ทั้งในการ์ดหน้าจอและรายการคำนวณ: x (แกน X) ไปทางขวา, y (แกน Y) ขึ้น

import type { FootingResult3 } from "../design/footing3d.ts";

const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "-");

export function footingPlanSvg3(ft: FootingResult3, cx: number, cy: number, D: number, W = 230, H = 210): string {
  if (!ft.L) return "";
  const pad = 28;
  const s = Math.min((W - 2 * pad) / ft.L, (H - 2 * pad) / ft.B);
  const X = (x: number) => W / 2 + x * s, Y = (y: number) => H / 2 - y * s;
  const piles = (ft.piles?.coords ?? []).map((p) => `<rect class="pile" x="${X(p.x - D / 2)}" y="${Y(p.y + D / 2)}" width="${D * s}" height="${D * s}"/>`).join("");
  return `<svg class="plan" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">
    <rect class="ft" x="${X(-ft.L / 2)}" y="${Y(ft.B / 2)}" width="${ft.L * s}" height="${ft.B * s}"/>${piles}
    <rect class="col" x="${X(-cx / 2)}" y="${Y(cy / 2)}" width="${cx * s}" height="${cy * s}"/>
    <text class="t" x="${W / 2}" y="${Y(-ft.B / 2) + 16}" text-anchor="middle">L = ${f(ft.L)} m (แกน X)</text>
    <text class="t" x="${X(ft.L / 2) + 6}" y="${H / 2}" transform="rotate(90 ${X(ft.L / 2) + 6} ${H / 2})" text-anchor="middle">B = ${f(ft.B)} m (แกน Y)</text>
    <text class="t" x="${W / 2}" y="${Y(ft.B / 2) - 8}" text-anchor="middle">t = ${f(ft.t)} m</text></svg>`;
}
