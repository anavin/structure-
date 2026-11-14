// ส่วนแสดงผลฐานราก: แปลน, การ์ดในแผงขวา, ตั้งค่า

import type { FootingResult } from "../design/footing.ts";
import { app, foundationSettings, modelChanged } from "./state.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "-");

export function columnDims(nodeId: string): { c1: number; c2: number } | null {
  const m = app.model;
  const col = m.members.find((x) => x.kind === "column" && (x.i === nodeId || x.j === nodeId));
  const sec = col && m.sections.find((s) => s.id === col.section);
  return sec ? { c1: sec.h, c2: sec.b } : null;
}

/** แปลนฐานราก (มองจากด้านบน: x ตามระนาบโครง) */
export function footingPlanSvg(fr: FootingResult, nodeId: string, W = 220, H = 200): string {
  if (!fr.L) return "";
  const cd = columnDims(nodeId) ?? { c1: 0.3, c2: 0.3 };
  const pad = 26;
  const s = Math.min((W - 2 * pad) / fr.L, (H - 2 * pad) / fr.B);
  const cx = W / 2, cy = H / 2;
  const X = (x: number) => cx + x * s, Y = (y: number) => cy - y * s;
  const parts: string[] = [];
  parts.push(`<rect class="ft" x="${X(-fr.L / 2)}" y="${Y(fr.B / 2)}" width="${fr.L * s}" height="${fr.B * s}"/>`);
  if (fr.piles) {
    const D = foundationSettings().pileSize;
    for (const p of fr.piles.coords) parts.push(`<rect class="pile" x="${X(p.x - D / 2)}" y="${Y(p.y + D / 2)}" width="${D * s}" height="${D * s}"/>`);
  }
  parts.push(`<rect class="col" x="${X(-cd.c1 / 2)}" y="${Y(cd.c2 / 2)}" width="${cd.c1 * s}" height="${cd.c2 * s}"/>`);
  parts.push(`<line class="dim" x1="${X(-fr.L / 2)}" y1="${Y(-fr.B / 2) + 12}" x2="${X(fr.L / 2)}" y2="${Y(-fr.B / 2) + 12}"/>`);
  parts.push(`<text class="t" x="${cx}" y="${Y(-fr.B / 2) + 23}" text-anchor="middle">L = ${f(fr.L)} m (ระนาบโครง)</text>`);
  parts.push(`<text class="t" x="${X(fr.L / 2) + 6}" y="${cy}" text-anchor="start" transform="rotate(90 ${X(fr.L / 2) + 6} ${cy})">B = ${f(fr.B)} m</text>`);
  parts.push(`<text class="t" x="${cx}" y="${Y(fr.B / 2) - 8}" text-anchor="middle">t = ${f(fr.t)} m</text>`);
  return `<svg class="plan" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${parts.join("")}</svg>`;
}

export function foundationSettingsHtml(): string {
  const st = foundationSettings();
  return `<div class="card"><div class="card-h">ตั้งค่าฐานราก</div><div class="form">
    <label>ชนิด<select id="fd-type"><option value="spread" ${st.type === "spread" ? "selected" : ""}>ฐานแผ่บนดิน</option><option value="pile" ${st.type === "pile" ? "selected" : ""}>ฐานเสาเข็ม</option></select></label>
    <label title="ระดับท้องฐานจากผิวดิน">Df (m)<input id="fd-df" type="number" step="0.1" value="${st.Df}"/></label>
    ${st.type === "spread"
      ? `<label title="หน่วยแรงแบกทานยอมให้ (gross)">qa (t/m²)<input id="fd-qa" type="number" step="0.5" value="${st.qaTon}"/></label>
         <label title="อัตราส่วน L/B (L ตามระนาบโครง)">L/B<input id="fd-ratio" type="number" step="0.1" min="0.5" max="3" value="${st.ratio}"/></label>`
      : `<label title="น้ำหนักบรรทุกปลอดภัยต่อต้น">Ra (ตัน/ต้น)<input id="fd-pile" type="number" step="1" value="${st.pileTon}"/></label>
         <label>ขนาดเข็ม (m)<input id="fd-psize" type="number" step="0.01" value="${st.pileSize}"/></label>
         <label title="ระยะห่างเข็ม = k × ขนาดเข็ม">ระยะห่าง (×D)<input id="fd-psp" type="number" step="0.5" min="2.5" value="${st.pileSpacingFactor}"/></label>`}
    <label title="หน่วยน้ำหนักดินถม">γดิน (kN/m³)<input id="fd-gs" type="number" step="0.5" value="${st.gammaSoil}"/></label>
    <label title="เพิ่มค่ายอมให้ 33% สำหรับกรณีที่มีแรงลม"><span><input id="fd-wind" type="checkbox" ${st.windIncrease ? "checked" : ""}/> ลม ×1.33</span></label>
  </div></div>`;
}

export function bindFoundationSettings(root: HTMLElement) {
  const set = (patch: Partial<ReturnType<typeof foundationSettings>>) => {
    app.model.foundation = { ...foundationSettings(), ...patch };
    modelChanged();
  };
  const num = (id: string, key: keyof ReturnType<typeof foundationSettings>, min = 0) => {
    const el = root.querySelector<HTMLInputElement>(`#${id}`);
    if (el) el.onchange = () => { const v = parseFloat(el.value); if (Number.isFinite(v) && v > min) set({ [key]: v } as never); };
  };
  const type = root.querySelector<HTMLSelectElement>("#fd-type");
  if (type) type.onchange = () => set({ type: type.value as "spread" | "pile" });
  num("fd-df", "Df"); num("fd-qa", "qaTon"); num("fd-ratio", "ratio"); num("fd-pile", "pileTon");
  num("fd-psize", "pileSize"); num("fd-psp", "pileSpacingFactor", 2); num("fd-gs", "gammaSoil");
  const w = root.querySelector<HTMLInputElement>("#fd-wind");
  if (w) w.onchange = () => set({ windIncrease: w.checked });
}

export function footingCardHtml(nodeId: string): string {
  const fr = app.footings[nodeId];
  if (!fr) return "";
  const worst = fr.service.reduce((a, s) => (s.qmax / s.allow > a.qmax / a.allow ? s : a), fr.service[0]);
  const unit = fr.type === "pile" ? "kN/ต้น" : "kN/m²";
  return `<div class="card ${fr.ok ? "ok" : "bad"}"><div class="card-h">ฐานราก ${fr.type === "pile" ? "เสาเข็ม" : "แผ่"} <span class="tag ${fr.ok ? "ok" : "bad"}">${fr.ok ? "ผ่าน" : "ไม่ผ่าน"}</span></div>
    <div class="pm-wrap">${footingPlanSvg(fr, nodeId)}</div>
    <table class="mini"><tbody>
      <tr><td>ขนาด L×B×t</td><td>${f(fr.L)} × ${f(fr.B)} × ${f(fr.t)} m</td></tr>
      ${fr.piles ? `<tr><td>เสาเข็ม</td><td>${fr.piles.coords.length} ต้น (${fr.piles.nx}×${fr.piles.ny}) @ ${f(fr.piles.s)} m</td></tr>` : ""}
      ${worst ? `<tr><td>${fr.type === "pile" ? "แรงเข็มสูงสุด" : "qmax"}</td><td>${f(worst.qmax)} / ${f(worst.allow)} ${unit} <small>(${esc(worst.name)})</small></td></tr>` : ""}
      <tr><td>เฉือนทะลุ / ทางเดียว</td><td>${f(fr.crit.punch, 2)} / ${f(Math.max(fr.crit.oneWayX, fr.crit.oneWayY), 2)}</td></tr>
      <tr><td>เหล็กแนว x</td><td>${esc(fr.barsX)}</td></tr>
      <tr><td>เหล็กแนว y</td><td>${esc(fr.barsY)}</td></tr>
    </tbody></table>
    ${fr.ok ? "" : `<p class="warn">${esc(fr.message)}</p>`}
    <button id="btn-footing-report" class="primary wide">รายการคำนวณฐานรากนี้</button></div>`;
}

export function footingSummaryHtml(): string {
  const rows = Object.entries(app.footings);
  if (!rows.length) return app.footingError ? `<div class="card bad"><p class="warn">ฐานราก: ${esc(app.footingError)}</p></div>` : "";
  return `<div class="card"><div class="card-h">สรุปฐานราก</div><table class="mini summary"><thead><tr><th>จุด</th><th>L×B×t (m)</th><th>${foundationSettings().type === "pile" ? "เข็ม" : "qmax"}</th><th></th></tr></thead><tbody>
    ${rows.map(([id, fr]) => {
      const w = fr.service.reduce((a, s) => (s.qmax / s.allow > a.qmax / a.allow ? s : a), fr.service[0]);
      return `<tr data-node="${esc(id)}" class="${app.selection?.kind === "node" && app.selection.id === id ? "selected" : ""}"><td>${esc(id)}</td><td>${f(fr.L)}×${f(fr.B)}×${f(fr.t)}</td><td>${fr.piles ? `${fr.piles.coords.length} ต้น` : w ? f(w.qmax, 0) : "-"}</td><td>${fr.ok ? "✓" : "✗"}</td></tr>`;
    }).join("")}
  </tbody></table></div>`;
}
