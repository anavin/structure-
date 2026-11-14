// ภาพตัดคาน/เสา ค.ส.ล. (SVG ตามมาตราส่วน) สำหรับรายการคำนวณและตารางหน้าตัด
// แสดง: คอนกรีต, เหล็กปลอก (มีขอเกี่ยว), เหล็กยืน/เหล็กบน-ล่าง, เส้นบอกขนาด, ป้ายเหล็ก, ระยะหุ้ม

export interface BarSet { n: number; dia: number }

const barName = (dia: number) => (dia <= 9 ? `RB${dia}` : `DB${dia}`);

interface Frame { W: number; H: number; s: number; x0: number; y0: number }

/** กรอบวาด: ย่อขยายให้หน้าตัด w × h (mm) อยู่ในพื้นที่ วางที่กึ่งกลาง เว้นขอบสำหรับเส้นบอกขนาด/ป้าย */
function frame(wMm: number, hMm: number, W: number, H: number, padL: number, padR: number, padT: number, padB: number): Frame {
  const s = Math.min((W - padL - padR) / wMm, (H - padT - padB) / hMm);
  const x0 = padL + (W - padL - padR - wMm * s) / 2;
  const y0 = padT + (H - padT - padB - hMm * s) / 2;
  return { W, H, s, x0, y0 };
}

function dimH(x1: number, x2: number, y: number, text: string) {
  return `<g class="sx-dim"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line x1="${x1}" y1="${y - 4}" x2="${x1}" y2="${y + 4}"/><line x1="${x2}" y1="${y - 4}" x2="${x2}" y2="${y + 4}"/>
    <text x="${(x1 + x2) / 2}" y="${y + 13}" text-anchor="middle">${text}</text></g>`;
}
function dimV(y1: number, y2: number, x: number, text: string) {
  return `<g class="sx-dim"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line x1="${x - 4}" y1="${y1}" x2="${x + 4}" y2="${y1}"/><line x1="${x - 4}" y1="${y2}" x2="${x + 4}" y2="${y2}"/>
    <text x="${x - 6}" y="${(y1 + y2) / 2}" text-anchor="middle" transform="rotate(-90 ${x - 6} ${(y1 + y2) / 2})">${text}</text></g>`;
}

/** เหล็กปลอกรูปสี่เหลี่ยมมุมมน + ขอเกี่ยว 135° ที่มุมบนซ้าย */
function stirrup(x: number, y: number, w: number, h: number, r: number, sw: number) {
  const hook = Math.max(6, r * 2.4);
  return `<g class="sx-tie" stroke-width="${sw}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}"/>
    <path d="M${x + r * 0.6},${y + r * 0.6} l${hook},${hook}"/><path d="M${x + r * 0.6},${y + r * 0.6} l${hook * 0.15},${hook * 1.05}"/></g>`;
}

/** ภาพตัดคาน: เหล็กล่าง/บน, ปลอก, ขนาด b × h */
export function beamSectionSvg(o: {
  b: number; h: number; cover: number; tieDia: number;
  bottom: BarSet | null; top: BarSet | null; tieLabel: string; title?: string;
}, W = 230, H = 250): string {
  const f = frame(o.b, o.h, W, H, 34, 70, o.title ? 30 : 14, 40);
  const { s, x0, y0 } = f;
  const bw = o.b * s, hh = o.h * s;
  const c = o.cover * s, td = Math.max(1.2, o.tieDia * s);
  const parts: string[] = [];
  if (o.title) parts.push(`<text class="sx-title" x="${W / 2}" y="16" text-anchor="middle">${o.title}</text>`);
  parts.push(`<rect class="sx-conc" x="${x0}" y="${y0}" width="${bw}" height="${hh}"/>`);
  parts.push(stirrup(x0 + c + td / 2, y0 + c + td / 2, bw - 2 * c - td, hh - 2 * c - td, Math.max(2, 2 * td), td));
  const row = (set: BarSet, yc: number) => {
    const r = Math.max(2.2, (set.dia * s) / 2);
    const inset = c + td + r;
    const xs = set.n === 1 ? [x0 + bw / 2] : Array.from({ length: set.n }, (_, k) => x0 + inset + ((bw - 2 * inset) * k) / (set.n - 1));
    return { r, svg: xs.map((x) => `<circle class="sx-bar" cx="${x}" cy="${yc}" r="${r}"/>`).join(""), xLast: xs[xs.length - 1] };
  };
  const labels: string[] = [];
  if (o.top) {
    const r0 = Math.max(2.2, (o.top.dia * s) / 2);
    const yc = y0 + c + td + r0;
    const t = row(o.top, yc);
    parts.push(t.svg);
    labels.push(`<g class="sx-lead"><line x1="${t.xLast + t.r}" y1="${yc}" x2="${x0 + bw + 12}" y2="${yc}"/><text x="${x0 + bw + 14}" y="${yc + 3.5}">${o.top.n}-${barName(o.top.dia)}</text></g>`);
  }
  if (o.bottom) {
    const r0 = Math.max(2.2, (o.bottom.dia * s) / 2);
    const yc = y0 + hh - c - td - r0;
    const t = row(o.bottom, yc);
    parts.push(t.svg);
    labels.push(`<g class="sx-lead"><line x1="${t.xLast + t.r}" y1="${yc}" x2="${x0 + bw + 12}" y2="${yc}"/><text x="${x0 + bw + 14}" y="${yc + 3.5}">${o.bottom.n}-${barName(o.bottom.dia)}</text></g>`);
  }
  const ym = y0 + hh / 2;
  labels.push(`<g class="sx-lead"><line x1="${x0 + bw - c - td / 2}" y1="${ym}" x2="${x0 + bw + 12}" y2="${ym}"/><text x="${x0 + bw + 14}" y="${ym + 3.5}">${o.tieLabel}</text></g>`);
  parts.push(...labels);
  parts.push(dimH(x0, x0 + bw, y0 + hh + 9, `${o.b}`));
  parts.push(dimV(y0, y0 + hh, x0 - 12, `${o.h}`));
  parts.push(`<text class="sx-note" x="${x0 + bw / 2}" y="${y0 + hh + 36}" text-anchor="middle">หุ้ม ${o.cover} mm</text>`);
  return `<svg class="sx" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join("")}</svg>`;
}

/** ภาพตัดเสา: เหล็กยืนตามพิกัด (u ตามแนวนอน = ด้าน h, w ตามแนวตั้ง = ด้าน b) */
export function columnSectionSvg(o: {
  b: number; h: number; cover: number; tieDia: number;
  bars: { u: number; w: number }[]; dia: number; tieLabel: string; title?: string;
}, W = 230, H = 250): string {
  const f = frame(o.h, o.b, W, H, 30, 30, o.title ? 30 : 14, 56);
  const { s, x0, y0 } = f;
  const ww = o.h * s, hh = o.b * s;
  const c = o.cover * s, td = Math.max(1.2, o.tieDia * s);
  const r = Math.max(2.2, (o.dia * s) / 2);
  const parts: string[] = [];
  if (o.title) parts.push(`<text class="sx-title" x="${W / 2}" y="16" text-anchor="middle">${o.title}</text>`);
  parts.push(`<rect class="sx-conc" x="${x0}" y="${y0}" width="${ww}" height="${hh}"/>`);
  parts.push(stirrup(x0 + c + td / 2, y0 + c + td / 2, ww - 2 * c - td, hh - 2 * c - td, Math.max(2, 2 * td), td));
  for (const p of o.bars) parts.push(`<circle class="sx-bar" cx="${x0 + ww / 2 + p.u * s}" cy="${y0 + hh / 2 - p.w * s}" r="${r}"/>`);
  parts.push(dimH(x0, x0 + ww, y0 + hh + 9, `${o.h}`));
  parts.push(dimV(y0, y0 + hh, x0 - 10, `${o.b}`));
  parts.push(`<text class="sx-lbl" x="${W / 2}" y="${y0 + hh + 36}" text-anchor="middle">${o.bars.length}-${barName(o.dia)}</text>`);
  parts.push(`<text class="sx-lbl2" x="${W / 2}" y="${y0 + hh + 50}" text-anchor="middle">ปลอก ${o.tieLabel} · หุ้ม ${o.cover} mm</text>`);
  return `<svg class="sx" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join("")}</svg>`;
}

/** สไตล์ภาพตัด (ฝังในหน้ารายการคำนวณซึ่งเป็นพื้นขาวเสมอ) */
export const SECTION_CSS = `
.sx .sx-conc { fill: #eef0f3; stroke: #1d2430; stroke-width: 1.4; }
.sx .sx-tie rect, .sx .sx-tie path { fill: none; stroke: #3b4452; }
.sx .sx-bar { fill: #1d2430; }
.sx .sx-dim line { stroke: #667; stroke-width: .8; }
.sx .sx-dim text { font-size: 9.5px; fill: #445; font-family: "IBM Plex Mono", monospace; }
.sx .sx-lead line { stroke: #556; stroke-width: .8; }
.sx .sx-lead text { font-size: 10px; fill: #1d2430; font-weight: 600; font-family: "IBM Plex Mono", monospace; }
.sx .sx-title { font-size: 12px; font-weight: 700; fill: #1f3b66; }
.sx .sx-lbl { font-size: 11px; font-weight: 700; fill: #1d2430; font-family: "IBM Plex Mono", monospace; }
.sx .sx-lbl2 { font-size: 9.5px; fill: #445; }
.sx .sx-note { font-size: 9px; fill: #667; }
.sec-row { display: flex; gap: 16px; align-items: flex-start; }
.sec-row .sx { flex: 0 0 auto; }
.sched { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sched .sc-item { border: 1px solid #c9ced6; border-radius: 4px; padding: 4px 6px 6px; text-align: center; break-inside: avoid; }
.sched .sc-item .sx { width: 100%; height: auto; }
.sched .sc-ids { font-size: 9.5px; color: #445; text-align: left; line-height: 1.35; word-break: break-word; }
`;

/** ตารางหน้าตัด: รวมชิ้นที่ออกแบบเหมือนกัน (key เดียวกัน) เป็นแบบเดียว ตั้งชื่อ B-1, B-2 … เรียงตามจำนวนชิ้น */
export function scheduleHtml(prefix: string, items: { id: string; key: string; svg: (title: string) => string }[], esc: (s: string) => string): string {
  const groups = new Map<string, { ids: string[]; svg: (t: string) => string }>();
  for (const it of items) {
    const g = groups.get(it.key);
    if (g) g.ids.push(it.id); else groups.set(it.key, { ids: [it.id], svg: it.svg });
  }
  const list = [...groups.values()].sort((a, b) => b.ids.length - a.ids.length);
  return `<div class="sched">${list.map((g, i) => {
    const mark = `${prefix}-${i + 1}`;
    const ids = g.ids.length > 24 ? `${g.ids.slice(0, 24).join(", ")} … (+${g.ids.length - 24})` : g.ids.join(", ");
    return `<div class="sc-item">${g.svg(`${mark} (${g.ids.length} ตัว)`)}<div class="sc-ids">${esc(ids)}</div></div>`;
  }).join("")}</div>`;
}

export const tieShort = (dia: number, spacingMm: number | null) => `${barName(dia)}@${spacingMm ? (spacingMm / 1000).toFixed(2) : "-"}`;
