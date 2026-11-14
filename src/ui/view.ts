// มุมมองโมเดล 2D (SVG) — วาดโมเดล แรง ผลวิเคราะห์ และรับการคลิก/วาด

import type { Member, Model } from "../core/model.ts";
import type { AnalysisResult } from "../core/frame2d.ts";
import { app, currentResult, modelChanged, nextId, viewChanged } from "./state.ts";

const NS = "http://www.w3.org/2000/svg";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmt = (v: number, dp = 2) => (Math.abs(v) < 1e-9 ? "0" : v.toFixed(dp));

export class View {
  private svg: SVGSVGElement;
  private zoom = 60; // px ต่อ m
  private ox = 80;
  private oy = 500;
  private drawFrom: { x: number; y: number } | null = null;
  private cursor: { x: number; y: number } | null = null;
  private panning: { sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    svg.addEventListener("pointerdown", (e) => this.onDown(e));
    svg.addEventListener("pointermove", (e) => this.onMove(e));
    svg.addEventListener("pointerup", (e) => this.onUp(e));
    svg.addEventListener("pointerleave", () => { this.cursor = null; this.render(); });
    window.addEventListener("keydown", (e) => this.onKey(e));
    new ResizeObserver(() => this.render()).observe(svg);
  }

  private sx(x: number) { return this.ox + x * this.zoom; }
  private sy(y: number) { return this.oy - y * this.zoom; }
  private toWorld(px: number, py: number) { return { x: (px - this.ox) / this.zoom, y: (this.oy - py) / this.zoom }; }

  fit() {
    const r = this.svg.getBoundingClientRect();
    const ns = app.model.nodes;
    if (!ns.length || r.width === 0) return;
    const rl = app.model.roof2d?.lines ?? [];
    const px = [...ns.map((n) => n.x), ...rl.flatMap((l) => [l[0], l[2]])], py = [...ns.map((n) => n.y), ...rl.flatMap((l) => [l[1], l[3]])];
    const minX = Math.min(...px), maxX = Math.max(...px);
    const minY = Math.min(...py), maxY = Math.max(...py);
    const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    this.zoom = Math.min((r.width - 160) / w, (r.height - 160) / h);
    this.ox = (r.width - w * this.zoom) / 2 - minX * this.zoom;
    this.oy = (r.height + h * this.zoom) / 2 + minY * this.zoom;
    this.render();
  }

  cancelDraw() { this.drawFrom = null; this.render(); }

  // ---------- การวาด ----------
  render() {
    const m = app.model;
    const r = this.svg.getBoundingClientRect();
    const res = currentResult();
    const parts: string[] = [];
    parts.push(this.gridSvg(r.width, r.height));

    const showResults = app.display !== "model" && res;
    // หลังคาจากอาคาร 3D (แสดงอย่างเดียว)
    if (m.roof2d) {
      for (const [x1, y1, x2, y2] of m.roof2d.lines) parts.push(`<line class="roof2d" x1="${this.sx(x1)}" y1="${this.sy(y1)}" x2="${this.sx(x2)}" y2="${this.sy(y2)}"/>`);
      const top = Math.max(...m.roof2d.lines.flatMap((l) => [l[1], l[3]])), xs = m.roof2d.lines.flatMap((l) => [l[0], l[2]]);
      parts.push(`<text class="label roof2d-label" x="${this.sx((Math.min(...xs) + Math.max(...xs)) / 2)}" y="${this.sy(top) - 8}" text-anchor="middle">${esc(m.roof2d.note)}</text>`);
    }
    // ชิ้นส่วน
    for (const mem of m.members) {
      const ni = m.nodes.find((n) => n.id === mem.i), nj = m.nodes.find((n) => n.id === mem.j);
      if (!ni || !nj) continue;
      const sel = app.selection?.kind === "member" && app.selection.id === mem.id;
      const design = app.designs[mem.id] ?? app.colDesigns[mem.id];
      const cls = ["member", mem.kind, sel ? "selected" : "", showResults ? "dim" : "", design && !design.ok ? "fail" : ""].join(" ");
      parts.push(`<line class="${cls}" x1="${this.sx(ni.x)}" y1="${this.sy(ni.y)}" x2="${this.sx(nj.x)}" y2="${this.sy(nj.y)}"/>`);
      parts.push(`<line class="hit" data-kind="member" data-id="${esc(mem.id)}" x1="${this.sx(ni.x)}" y1="${this.sy(ni.y)}" x2="${this.sx(nj.x)}" y2="${this.sy(nj.y)}"/>`);
      if (mem.releaseI || mem.releaseJ) {
        const L = Math.hypot(nj.x - ni.x, nj.y - ni.y) * this.zoom;
        const ux = (this.sx(nj.x) - this.sx(ni.x)) / L, uy = (this.sy(nj.y) - this.sy(ni.y)) / L;
        const off = Math.min(12, L / 4);
        if (mem.releaseI) parts.push(`<circle class="hinge" cx="${this.sx(ni.x) + ux * off}" cy="${this.sy(ni.y) + uy * off}" r="4"/>`);
        if (mem.releaseJ) parts.push(`<circle class="hinge" cx="${this.sx(nj.x) - ux * off}" cy="${this.sy(nj.y) - uy * off}" r="4"/>`);
      }
      if (app.showLabels) {
        const mx = this.sx((ni.x + nj.x) / 2), my = this.sy((ni.y + nj.y) / 2);
        parts.push(`<text class="label mlabel" x="${mx + 4}" y="${my - 5}">${esc(mem.id)}</text>`);
      }
    }

    if (app.display === "model") parts.push(this.loadsSvg());
    if (showResults && res) parts.push(this.resultsSvg(res));

    // ฐานราก (รูปด้านในระนาบโครง)
    for (const [nid, fr] of Object.entries(app.footings)) {
      const n = m.nodes.find((x) => x.id === nid);
      if (!n || !fr.L) continue;
      const x0 = this.sx(n.x - fr.L / 2), y0 = this.sy(n.y) + 16;
      const w = fr.L * this.zoom, hgt = Math.max(6, fr.t * this.zoom);
      parts.push(`<rect class="footing ${fr.ok ? "" : "fail"}" x="${x0}" y="${y0}" width="${w}" height="${hgt}"/>`);
      if (fr.piles) {
        const xs = [...new Set(fr.piles.coords.map((p) => p.x))];
        for (const px of xs) {
          const sx = this.sx(n.x + px);
          parts.push(`<line class="pile-line" x1="${sx}" y1="${y0 + hgt}" x2="${sx}" y2="${y0 + hgt + 28}"/>`);
        }
      }
    }
    // จุดรองรับ
    for (const s of m.supports) {
      const n = m.nodes.find((x) => x.id === s.node);
      if (!n) continue;
      const sx = this.sx(n.x), sy = this.sy(n.y);
      const spY = !s.uy && (s.ky ?? 0) > 0, spX = !s.ux && (s.kx ?? 0) > 0, spR = !s.rz && (s.kr ?? 0) > 0;
      if (spY || spX || spR) parts.push(this.springSvg(sx, sy, s.ux, spY, spX, spR));
      else parts.push(this.supportSvg(sx, sy, s.ux, s.uy, s.rz));
    }
    // จุดต่อ
    for (const n of m.nodes) {
      const sel = app.selection?.kind === "node" && app.selection.id === n.id;
      parts.push(`<circle class="node ${sel ? "selected" : ""}" data-kind="node" data-id="${esc(n.id)}" cx="${this.sx(n.x)}" cy="${this.sy(n.y)}" r="${sel ? 6 : 4.5}"/>`);
      if (app.showLabels) parts.push(`<text class="label nlabel" x="${this.sx(n.x) - 8}" y="${this.sy(n.y) + 16}" text-anchor="end">${esc(n.id)}</text>`);
    }

    // เส้นช่วยวาด
    if (app.mode === "draw" && this.cursor) {
      const c = this.snap(this.cursor);
      parts.push(`<circle class="snap" cx="${this.sx(c.x)}" cy="${this.sy(c.y)}" r="6"/>`);
      parts.push(`<text class="label coord" x="${this.sx(c.x) + 10}" y="${this.sy(c.y) - 10}">(${fmt(c.x)}, ${fmt(c.y)})</text>`);
      if (this.drawFrom) {
        const L = Math.hypot(c.x - this.drawFrom.x, c.y - this.drawFrom.y);
        parts.push(`<line class="rubber" x1="${this.sx(this.drawFrom.x)}" y1="${this.sy(this.drawFrom.y)}" x2="${this.sx(c.x)}" y2="${this.sy(c.y)}"/>`);
        parts.push(`<text class="label coord" x="${this.sx(c.x) + 10}" y="${this.sy(c.y) + 18}">L = ${fmt(L)} m</text>`);
      }
    }
    this.svg.innerHTML = parts.join("");
  }

  private gridSvg(w: number, h: number) {
    const g = app.grid;
    let step = g;
    while (step * this.zoom < 12) step *= 2;
    const a = this.toWorld(0, h), b = this.toWorld(w, 0);
    const out: string[] = [];
    for (let x = Math.ceil(a.x / step) * step; x <= b.x; x += step) {
      const major = Math.abs(x / (step * 5) - Math.round(x / (step * 5))) < 1e-6;
      out.push(`<line class="grid ${major ? "major" : ""}" x1="${this.sx(x)}" y1="0" x2="${this.sx(x)}" y2="${h}"/>`);
    }
    for (let y = Math.ceil(a.y / step) * step; y <= b.y; y += step) {
      const major = Math.abs(y / (step * 5) - Math.round(y / (step * 5))) < 1e-6;
      out.push(`<line class="grid ${major ? "major" : ""}" x1="0" y1="${this.sy(y)}" x2="${w}" y2="${this.sy(y)}"/>`);
    }
    out.push(`<line class="axis" x1="${this.sx(0)}" y1="0" x2="${this.sx(0)}" y2="${h}"/><line class="axis" x1="0" y1="${this.sy(0)}" x2="${w}" y2="${this.sy(0)}"/>`);
    return out.join("");
  }

  /** จุดรองรับสปริง: ขดสปริงแนวดิ่ง/ราบ + วงหมุน (สปริงหมุน) */
  private springSvg(x: number, y: number, ux: boolean, spY: boolean, spX: boolean, spR: boolean) {
    const p: string[] = [];
    const zig = (x0: number, y0: number, dx: number, dy: number) => {
      const n = 6, L = 22, w = 5, nx = -dy, ny = dx;
      let d = `M${x0},${y0} l${dx * 3},${dy * 3}`;
      for (let k = 0; k < n; k++) { const sg = k % 2 ? -1 : 1; d += ` l${(dx * (L - 6)) / n + nx * w * sg * (k === 0 ? 1 : 2) * 0.5},${(dy * (L - 6)) / n + ny * w * sg * (k === 0 ? 1 : 2) * 0.5}`; }
      return `<path d="${d} L${x0 + dx * L},${y0 + dy * L}" fill="none"/>`;
    };
    if (spY) { p.push(zig(x, y, 0, 1)); p.push(`<line x1="${x - 12}" y1="${y + 22}" x2="${x + 12}" y2="${y + 22}"/>`); }
    else p.push(`<path d="M${x},${y} l-8,12 h16 z"/><line x1="${x - 12}" y1="${y + 15}" x2="${x + 12}" y2="${y + 15}"/>`);
    if (spX) { p.push(zig(x, y, -1, 0)); p.push(`<line x1="${x - 22}" y1="${y - 10}" x2="${x - 22}" y2="${y + 10}"/>`); }
    else if (ux && spY) p.push(`<line x1="${x - 16}" y1="${y + 26}" x2="${x + 16}" y2="${y + 26}"/>`);
    if (spR) p.push(`<path d="M${x + 9},${y} A9,9 0 1,1 ${x},${y - 9}" fill="none"/><path d="M${x},${y - 9} l5,-3 v6 z"/>`);
    return `<g class="support spring">${p.join("")}</g>`;
  }

  private supportSvg(x: number, y: number, ux: boolean, uy: boolean, rz: boolean) {
    if (ux && uy && rz) {
      return `<g class="support"><line x1="${x - 14}" y1="${y}" x2="${x + 14}" y2="${y}"/>${[-12, -6, 0, 6, 12].map((d) => `<line x1="${x + d}" y1="${y}" x2="${x + d - 6}" y2="${y + 7}"/>`).join("")}</g>`;
    }
    if (ux && uy) {
      return `<g class="support"><path d="M${x},${y} l-9,14 h18 z"/><line x1="${x - 13}" y1="${y + 14}" x2="${x + 13}" y2="${y + 14}"/></g>`;
    }
    if (uy) {
      return `<g class="support"><path d="M${x},${y} l-9,12 h18 z"/><circle cx="${x - 5}" cy="${y + 15}" r="2.5"/><circle cx="${x + 5}" cy="${y + 15}" r="2.5"/></g>`;
    }
    if (ux) {
      return `<g class="support"><path d="M${x},${y} l-12,-9 v18 z"/><circle cx="${x - 15}" cy="${y - 5}" r="2.5"/><circle cx="${x - 15}" cy="${y + 5}" r="2.5"/></g>`;
    }
    return rz ? `<g class="support"><rect x="${x - 6}" y="${y - 6}" width="12" height="12"/></g>` : "";
  }

  private arrow(x1: number, y1: number, x2: number, y2: number, cls: string) {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const hl = 7;
    const a1 = ang + Math.PI - 0.4, a2 = ang + Math.PI + 0.4;
    return `<g class="${cls}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><path d="M${x2},${y2} L${x2 + hl * Math.cos(a1)},${y2 + hl * Math.sin(a1)} L${x2 + hl * Math.cos(a2)},${y2 + hl * Math.sin(a2)} z"/></g>`;
  }

  private loadsSvg() {
    const m = app.model;
    const lc = m.loadCases.find((c) => c.id === app.activeCase);
    if (!lc) return "";
    const out: string[] = [];
    for (const t of lc.settle ?? []) {
      const n = m.nodes.find((x) => x.id === t.node);
      if (!n) continue;
      const parts = [t.dx && `dx=${fmt(t.dx * 1000)}`, t.dy && `dy=${fmt(t.dy * 1000)}`].filter(Boolean).join(" ");
      const lbl = [parts && `${parts} mm`, t.rz && `θ=${fmt(t.rz * 1000)}‰ rad`].filter(Boolean).join(" ");
      if (lbl) out.push(`<text class="label lval settle" x="${this.sx(n.x)}" y="${this.sy(n.y) + 50}" text-anchor="middle">ทรุด ${lbl}</text>`);
    }
    for (const ld of lc.loads) {
      if (ld.type === "nodal") {
        const n = m.nodes.find((x) => x.id === ld.node);
        if (!n) continue;
        const x = this.sx(n.x), y = this.sy(n.y);
        const parts: string[] = [];
        if (ld.fx) { const d = Math.sign(ld.fx); out.push(this.arrow(x - d * 45, y, x - d * 6, y, "load")); parts.push(`Fx=${fmt(ld.fx)}`); }
        if (ld.fy) { const d = Math.sign(ld.fy); out.push(this.arrow(x, y + d * 45, x, y + d * 6, "load")); parts.push(`Fy=${fmt(ld.fy)}`); }
        if (ld.mz) parts.push(`M=${fmt(ld.mz)}`);
        if (parts.length) out.push(`<text class="label lval" x="${x + 6}" y="${y - 30}">${parts.join(" ")} </text>`);
        continue;
      }
      const mem = m.members.find((x) => x.id === ld.member);
      const g = mem && this.geom(m, mem);
      if (!g) continue;
      if (ld.type === "dist") {
        // แรงแผ่เป็นช่วง (สามเหลี่ยม/คางหมูจากพื้น): รูปหลายเหลี่ยม + ลูกศรตามความยาว ความสูงตามขนาด
        const wMax = Math.max(1e-9, ...ld.pts.map(([, w]) => Math.abs(w)));
        const sgn = Math.sign(ld.pts.find(([, w]) => w)?.[1] ?? -1);
        let ddx = 0, ddy = 0;
        if (ld.dir === "globalY") ddy = -sgn; else if (ld.dir === "globalX") ddx = sgn; else { ddx = -g.s * sgn; ddy = -g.c * sgn; }
        const LEN = 30, poly: string[] = [];
        const at = (x: number) => { const t = Math.max(0, Math.min(1, x / g.L)); return [this.sx(g.xi + (g.xj - g.xi) * t), this.sy(g.yi + (g.yj - g.yi) * t)]; };
        for (const [x, w] of ld.pts) { const [px, py] = at(x); const l = (Math.abs(w) / wMax) * LEN; poly.push(`${px - ddx * l},${py - ddy * l}`); }
        const n = Math.max(3, Math.round((g.L * this.zoom) / 35));
        for (let k = 0; k <= n; k++) {
          const x = (g.L * k) / n;
          let w = 0;
          for (let q = 0; q + 1 < ld.pts.length; q++) { const [xa, wa] = ld.pts[q], [xb, wb] = ld.pts[q + 1]; if (x >= xa - 1e-9 && x <= xb + 1e-9 && xb > xa) { w = wa + ((wb - wa) * (x - xa)) / (xb - xa); break; } }
          const l = (Math.abs(w) / wMax) * LEN;
          if (l > 4) { const [px, py] = at(x); out.push(this.arrow(px - ddx * l, py - ddy * l, px - ddx * 3, py - ddy * 3, "load udl")); }
        }
        out.push(`<polyline class="load-line" points="${poly.join(" ")}"/>`);
        const [mx, my] = at(g.L / 2);
        out.push(`<text class="label lval" x="${mx - ddx * (LEN + 10)}" y="${my - ddy * (LEN + 8)}" text-anchor="middle">พื้น ≤ ${fmt(wMax)} kN/m</text>`);
        continue;
      }
      const val = ld.type === "udl" ? ld.w : ld.P;
      // ทิศทางแรงในจอ (y จอชี้ลง)
      let dx = 0, dy = 0;
      if (ld.dir === "globalY") dy = -Math.sign(val);
      else if (ld.dir === "globalX") dx = Math.sign(val);
      else { dx = -g.s * Math.sign(val); dy = -g.c * Math.sign(val); }
      const len = 30;
      if (ld.type === "udl") {
        const n = Math.max(3, Math.round((g.L * this.zoom) / 35));
        const pts: string[] = [];
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const px = this.sx(g.xi + (g.xj - g.xi) * t), py = this.sy(g.yi + (g.yj - g.yi) * t);
          out.push(this.arrow(px - dx * len, py - dy * len, px - dx * 3, py - dy * 3, "load udl"));
          pts.push(`${px - dx * len},${py - dy * len}`);
        }
        out.push(`<polyline class="load-line" points="${pts.join(" ")}"/>`);
        const mx = this.sx((g.xi + g.xj) / 2) - dx * (len + 10), my = this.sy((g.yi + g.yj) / 2) - dy * (len + 8);
        out.push(`<text class="label lval" x="${mx}" y="${my}" text-anchor="middle">w=${fmt(Math.abs(val))} kN/m</text>`);
      } else {
        const t = ld.a / g.L;
        const px = this.sx(g.xi + (g.xj - g.xi) * t), py = this.sy(g.yi + (g.yj - g.yi) * t);
        out.push(this.arrow(px - dx * 45, py - dy * 45, px - dx * 3, py - dy * 3, "load"));
        out.push(`<text class="label lval" x="${px + 4}" y="${py - dy * 50}">P=${fmt(Math.abs(val))}</text>`);
      }
    }
    return out.join("");
  }

  private geom(m: Model, mem: Member) {
    const ni = m.nodes.find((n) => n.id === mem.i), nj = m.nodes.find((n) => n.id === mem.j);
    if (!ni || !nj) return null;
    const L = Math.hypot(nj.x - ni.x, nj.y - ni.y);
    if (L < 1e-9) return null;
    return { xi: ni.x, yi: ni.y, xj: nj.x, yj: nj.y, L, c: (nj.x - ni.x) / L, s: (nj.y - ni.y) / L };
  }

  private resultsSvg(res: AnalysisResult) {
    const m = app.model;
    const out: string[] = [];
    const ext = Math.max(1, ...m.nodes.map((n) => Math.abs(n.x)), ...m.nodes.map((n) => Math.abs(n.y)));
    const span = (() => {
      if (!m.nodes.length) return 1;
      const xs = m.nodes.map((n) => n.x), ys = m.nodes.map((n) => n.y);
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    })() || ext;

    if (app.display === "deformed") {
      let maxD = 0;
      for (const mr of Object.values(res.members)) {
        for (const st of mr.stations) maxD = Math.max(maxD, Math.abs(st.v));
      }
      for (const d of Object.values(res.disp)) maxD = Math.max(maxD, Math.hypot(d.ux, d.uy));
      const k = maxD > 0 ? ((span * 0.08) / maxD) * app.scale : 0;
      for (const mem of m.members) {
        const g = this.geom(m, mem); const mr = res.members[mem.id];
        if (!g || !mr) continue;
        const di = res.disp[mem.i], dj = res.disp[mem.j];
        const uli = g.c * di.ux + g.s * di.uy, ulj = g.c * dj.ux + g.s * dj.uy;
        const pts = mr.stations.map((st) => {
          const t = st.x / g.L;
          const u = uli + (ulj - uli) * t;
          const bx = g.xi + g.c * st.x, by = g.yi + g.s * st.x;
          const wx = bx + k * (g.c * u - g.s * st.v), wy = by + k * (g.s * u + g.c * st.v);
          return `${this.sx(wx)},${this.sy(wy)}`;
        });
        out.push(`<polyline class="deformed" points="${pts.join(" ")}"/>`);
      }
      // ค่าการเคลื่อนตัวสูงสุด
      let best = { id: "", d: 0, ux: 0, uy: 0 };
      for (const [id, d] of Object.entries(res.disp)) {
        const mag = Math.hypot(d.ux, d.uy);
        if (mag > best.d) best = { id, d: mag, ux: d.ux, uy: d.uy };
      }
      if (best.id) {
        const n = m.nodes.find((x) => x.id === best.id)!;
        out.push(`<text class="label rval" x="${this.sx(n.x) + 8}" y="${this.sy(n.y) - 10}">${best.id}: ux=${fmt(best.ux * 1000)} uy=${fmt(best.uy * 1000)} mm</text>`);
      }
      return out.join("");
    }

    if (app.display === "reactions") {
      for (const [nid, r] of Object.entries(res.reactions)) {
        const n = m.nodes.find((x) => x.id === nid);
        if (!n) continue;
        const x = this.sx(n.x), y = this.sy(n.y);
        if (Math.abs(r.fy) > 1e-6) out.push(this.arrow(x, y + (r.fy > 0 ? 70 : 24), x, y + (r.fy > 0 ? 24 : 70), "reaction"));
        if (Math.abs(r.fx) > 1e-6) out.push(this.arrow(x - (r.fx > 0 ? 50 : -50), y + 28, x, y + 28, "reaction"));
        out.push(`<text class="label rval" x="${x}" y="${y + 88}" text-anchor="middle">Rx=${fmt(r.fx)} Ry=${fmt(r.fy)}</text>`);
        if (Math.abs(r.mz) > 1e-6) out.push(`<text class="label rval" x="${x}" y="${y + 102}" text-anchor="middle">M=${fmt(r.mz)} kN·m</text>`);
      }
      return out.join("");
    }

    // แผนภาพ N / V / M
    const key = app.display as "N" | "V" | "M";
    let maxAbs = 0;
    for (const mr of Object.values(res.members)) for (const st of mr.stations) maxAbs = Math.max(maxAbs, Math.abs(st[key]));
    const k = maxAbs > 0 ? ((span * 0.12) / maxAbs) * app.scale : 0;
    // M วาดด้านรับแรงดึง (บวก = ด้านล่างของคานที่วาดจากซ้ายไปขวา)
    const sign = key === "M" ? -1 : 1;
    for (const mem of m.members) {
      const g = this.geom(m, mem); const mr = res.members[mem.id];
      if (!g || !mr) continue;
      const base = (x: number) => ({ x: g.xi + g.c * x, y: g.yi + g.s * x });
      const pts = mr.stations.map((st) => {
        const b = base(st.x);
        const off = sign * st[key] * k;
        return `${this.sx(b.x - g.s * off)},${this.sy(b.y + g.c * off)}`;
      });
      const b0 = base(0), b1 = base(g.L);
      const poly = `${this.sx(b0.x)},${this.sy(b0.y)} ${pts.join(" ")} ${this.sx(b1.x)},${this.sy(b1.y)}`;
      out.push(`<polygon class="diagram d${key}" points="${poly}"/>`);
      // ป้ายค่าสูงสุด/ต่ำสุด
      let iMax = 0, iMin = 0;
      mr.stations.forEach((st, i) => { if (st[key] > mr.stations[iMax][key]) iMax = i; if (st[key] < mr.stations[iMin][key]) iMin = i; });
      const seen = new Set<number>();
      for (const i of [iMax, iMin, 0, mr.stations.length - 1]) {
        const st = mr.stations[i];
        if (Math.abs(st[key]) < maxAbs * 0.02 || seen.has(Math.round(st[key] * 100))) continue;
        seen.add(Math.round(st[key] * 100));
        const b = base(st.x);
        const off = sign * st[key] * k;
        const px = this.sx(b.x - g.s * off), py = this.sy(b.y + g.c * off);
        out.push(`<text class="label dval" x="${px + 3}" y="${py + (off < 0 ? 13 : -4)}">${fmt(st[key])}</text>`);
      }
    }
    return out.join("");
  }

  // ---------- การโต้ตอบ ----------
  private snap(p: { x: number; y: number }) {
    // ดูดเข้าจุดต่อที่ใกล้ (ภายใน 10 px) ก่อน แล้วจึงดูดเข้ากริด
    for (const n of app.model.nodes) {
      if (Math.hypot(this.sx(n.x) - this.sx(p.x), this.sy(n.y) - this.sy(p.y)) < 10) return { x: n.x, y: n.y };
    }
    const g = app.grid;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }

  private local(e: MouseEvent) {
    const r = this.svg.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const { px, py } = this.local(e);
    const f = Math.exp(-e.deltaY * 0.0015);
    const nz = Math.min(2000, Math.max(5, this.zoom * f));
    this.ox = px - ((px - this.ox) * nz) / this.zoom;
    this.oy = py - ((py - this.oy) * nz) / this.zoom;
    this.zoom = nz;
    this.render();
  }

  private onDown(e: PointerEvent) {
    const { px, py } = this.local(e);
    if (e.button === 1 || (e.button === 0 && app.mode === "select")) {
      this.panning = { sx: px, sy: py, ox: this.ox, oy: this.oy, moved: false };
      this.svg.setPointerCapture(e.pointerId);
    }
  }

  private onMove(e: PointerEvent) {
    const { px, py } = this.local(e);
    if (this.panning) {
      const dx = px - this.panning.sx, dy = py - this.panning.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.panning.moved = true;
      if (this.panning.moved) {
        this.ox = this.panning.ox + dx;
        this.oy = this.panning.oy + dy;
        this.render();
      }
      return;
    }
    this.cursor = this.toWorld(px, py);
    if (app.mode === "draw") this.render();
  }

  private onUp(e: PointerEvent) {
    const wasPan = this.panning;
    this.panning = null;
    if (wasPan?.moved) return;
    if (e.button !== 0) return;
    const { px, py } = this.local(e);
    if (app.mode === "select") {
      const target = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
      const kind = target?.getAttribute("data-kind");
      const id = target?.getAttribute("data-id");
      app.selection = kind && id ? { kind: kind as "node" | "member", id } : null;
      viewChanged();
      return;
    }
    // โหมดวาดชิ้นส่วน
    const p = this.snap(this.toWorld(px, py));
    if (!this.drawFrom) { this.drawFrom = p; this.render(); return; }
    if (Math.hypot(p.x - this.drawFrom.x, p.y - this.drawFrom.y) < 1e-6) return;
    this.addMember(this.drawFrom, p);
    this.drawFrom = p; // วาดต่อเนื่องจากจุดล่าสุด (Esc เพื่อหยุด)
  }

  private nodeAt(p: { x: number; y: number }): string {
    const m = app.model;
    const ex = m.nodes.find((n) => Math.abs(n.x - p.x) < 1e-6 && Math.abs(n.y - p.y) < 1e-6);
    if (ex) return ex.id;
    const id = nextId("N", m.nodes);
    m.nodes.push({ id, x: +p.x.toFixed(4), y: +p.y.toFixed(4) });
    return id;
  }

  private addMember(a: { x: number; y: number }, b: { x: number; y: number }) {
    const m = app.model;
    const i = this.nodeAt(a), j = this.nodeAt(b);
    if (m.members.some((x) => (x.i === i && x.j === j) || (x.i === j && x.j === i))) return;
    const vertical = Math.abs(a.x - b.x) < 1e-6;
    const kind = vertical ? "column" : "beam";
    const id = nextId(vertical ? "C" : "B", m.members.filter((x) => x.id.startsWith(vertical ? "C" : "B")));
    const [ii, jj] = vertical ? (a.y <= b.y ? [i, j] : [j, i]) : (a.x <= b.x ? [i, j] : [j, i]);
    m.members.push({ id, i: ii, j: jj, section: vertical ? app.drawSection.column : app.drawSection.beam, kind });
    app.selection = { kind: "member", id };
    modelChanged();
  }

  private onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "Escape") { this.drawFrom = null; app.selection = null; viewChanged(); }
    if ((e.key === "Delete" || e.key === "Backspace") && app.selection) {
      deleteSelection();
    }
  }
}

export function deleteSelection() {
  const m = app.model;
  const sel = app.selection;
  if (!sel) return;
  if (sel.kind === "member") {
    m.members = m.members.filter((x) => x.id !== sel.id);
    for (const lc of m.loadCases) lc.loads = lc.loads.filter((l) => l.type === "nodal" || l.member !== sel.id);
  } else {
    const removed = new Set(m.members.filter((x) => x.i === sel.id || x.j === sel.id).map((x) => x.id));
    m.members = m.members.filter((x) => !removed.has(x.id));
    m.nodes = m.nodes.filter((n) => n.id !== sel.id);
    m.supports = m.supports.filter((s) => s.node !== sel.id);
    for (const lc of m.loadCases) {
      lc.loads = lc.loads.filter((l) => (l.type === "nodal" ? l.node !== sel.id : !removed.has(l.member)));
      if (lc.settle) { lc.settle = lc.settle.filter((t) => t.node !== sel.id); if (!lc.settle.length) delete lc.settle; }
    }
  }
  app.selection = null;
  modelChanged();
}

export { NS };
