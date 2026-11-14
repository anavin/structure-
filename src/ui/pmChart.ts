// แผนภาพ P–M ของเสาแบบ SVG (ใช้ทั้งในแผงขวาและรายการคำนวณ)

import type { ColumnDesignResult } from "../design/rcColumn.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function niceStep(range: number, target: number) {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function pmChartSvg(d: ColumnDesignResult, W = 260, H = 240, cls = "pm"): string {
  if (!d.diagram.length) return "";
  const pad = { l: 46, r: 10, t: 12, b: 30 };
  const nominal = d.diagram.filter((p) => Number.isFinite(p.c)).map((p) => ({ M: p.Mn, P: p.Pn }));
  const demands = d.checks.filter((c) => Number.isFinite(c.Mc));
  const maxM = Math.max(...nominal.map((p) => p.M), ...demands.map((c) => c.Mc), 1) * 1.08;
  const maxP = Math.max(...d.diagram.map((p) => p.Pn), ...demands.map((c) => c.Pu)) * 1.05;
  const minP = Math.min(...d.diagram.map((p) => p.Pn), ...demands.map((c) => c.Pu), 0) * 1.1;
  const x = (m: number) => pad.l + (m / maxM) * (W - pad.l - pad.r);
  const y = (p: number) => pad.t + ((maxP - p) / (maxP - minP)) * (H - pad.t - pad.b);
  const parts: string[] = [];
  const sx = niceStep(maxM, 4), sy = niceStep(maxP - minP, 5);
  for (let m = 0; m <= maxM; m += sx) parts.push(`<line class="g" x1="${x(m)}" y1="${pad.t}" x2="${x(m)}" y2="${H - pad.b}"/><text class="t" x="${x(m)}" y="${H - pad.b + 12}" text-anchor="middle">${+m.toFixed(1)}</text>`);
  for (let p = Math.ceil(minP / sy) * sy; p <= maxP; p += sy) parts.push(`<line class="g" x1="${pad.l}" y1="${y(p)}" x2="${W - pad.r}" y2="${y(p)}"/><text class="t" x="${pad.l - 4}" y="${y(p) + 3}" text-anchor="end">${+p.toFixed(0)}</text>`);
  parts.push(`<line class="ax" x1="${pad.l}" y1="${y(0)}" x2="${W - pad.r}" y2="${y(0)}"/><line class="ax" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}"/>`);
  const nomPts = [...nominal].sort((a, b) => b.P - a.P);
  parts.push(`<polyline class="nom" points="${[{ M: 0, P: Math.max(...nomPts.map((p) => p.P)) }, ...nomPts, { M: 0, P: Math.min(...nomPts.map((p) => p.P)) }].map((p) => `${x(p.M)},${y(p.P)}`).join(" ")}"/>`);
  parts.push(`<polyline class="des" points="${d.diagram.map((p) => `${x(p.phiMn)},${y(p.phiPn)}`).join(" ")}"/>`);
  for (const c of demands) {
    parts.push(`<circle class="dem ${c.ratio <= 1 ? "ok" : "bad"}" cx="${x(c.Mc)}" cy="${y(c.Pu)}" r="3.5"><title>${esc(c.combo)}: Pu=${c.Pu.toFixed(1)} kN, Mc=${c.Mc.toFixed(1)} kN·m, อัตราส่วน ${c.ratio.toFixed(2)}</title></circle>`);
  }
  parts.push(`<text class="t" x="${(W + pad.l) / 2}" y="${H - 4}" text-anchor="middle">M (kN·m)</text><text class="t" x="10" y="${pad.t + 4}">P (kN)</text>`);
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${parts.join("")}</svg>`;
}
