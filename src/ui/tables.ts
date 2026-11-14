// ตารางแก้ไขข้อมูลแบบทั่วไป

export interface Column<T> {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "checkbox" | "readonly";
  width?: string;
  options?: { value: string; label: string }[];
  get: (row: T) => string | number | boolean;
  set?: (row: T, v: string | number | boolean) => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderTable<T>(
  host: HTMLElement,
  title: string,
  rows: T[],
  cols: Column<T>[],
  opts: {
    onChange: () => void;
    onAdd?: () => void;
    onDelete?: (row: T) => void;
    onRowClick?: (row: T) => void;
    isSelected?: (row: T) => boolean;
  },
) {
  const wrap = document.createElement("div");
  wrap.className = "tbl";
  const head = `<div class="tbl-head"><span>${esc(title)}</span>${opts.onAdd ? `<button class="small add">+ เพิ่ม</button>` : ""}</div>`;
  const th = cols.map((c) => `<th style="${c.width ? `width:${c.width}` : ""}">${esc(c.label)}</th>`).join("") + (opts.onDelete ? "<th></th>" : "");
  const body = rows.map((r, ri) => {
    const tds = cols.map((c, ci) => {
      const v = c.get(r);
      const at = `data-r="${ri}" data-c="${ci}"`;
      switch (c.type) {
        case "readonly": return `<td class="ro">${esc(String(v))}</td>`;
        case "checkbox": return `<td><input type="checkbox" ${at} ${v ? "checked" : ""}/></td>`;
        case "select": return `<td><select ${at}>${(c.options ?? []).map((o) => `<option value="${esc(o.value)}" ${o.value === v ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></td>`;
        case "number": return `<td><input type="number" step="any" ${at} value="${esc(String(v))}"/></td>`;
        default: return `<td><input type="text" ${at} value="${esc(String(v))}"/></td>`;
      }
    }).join("");
    const sel = opts.isSelected?.(r) ? "selected" : "";
    return `<tr class="${sel}" data-row="${ri}">${tds}${opts.onDelete ? `<td><button class="small del" data-del="${ri}" title="ลบ">✕</button></td>` : ""}</tr>`;
  }).join("");
  wrap.innerHTML = `${head}<div class="tbl-scroll"><table><thead><tr>${th}</tr></thead><tbody>${body || `<tr><td class="empty" colspan="${cols.length + 1}">ยังไม่มีข้อมูล</td></tr>`}</tbody></table></div>`;

  wrap.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const r = el.dataset.r, c = el.dataset.c;
    if (r === undefined || c === undefined) return;
    const col = cols[+c];
    const row = rows[+r];
    if (!col.set) return;
    let v: string | number | boolean;
    if (col.type === "checkbox") v = (el as HTMLInputElement).checked;
    else if (col.type === "number") {
      v = parseFloat(el.value);
      if (!Number.isFinite(v)) { el.classList.add("invalid"); return; }
    } else v = el.value;
    el.classList.remove("invalid");
    col.set(row, v);
    opts.onChange();
  });
  wrap.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains("add")) { opts.onAdd?.(); return; }
    const del = t.dataset.del;
    if (del !== undefined) { opts.onDelete?.(rows[+del]); return; }
    if (t.tagName === "INPUT" || t.tagName === "SELECT") return;
    const tr = t.closest("tr[data-row]") as HTMLElement | null;
    if (tr && opts.onRowClick) opts.onRowClick(rows[+tr.dataset.row!]);
  });
  host.appendChild(wrap);
}
