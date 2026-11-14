// ถ่ายภาพหน้าจอสำหรับคู่มือ (public/manual/*.webp)
// ใช้: เปิด dev server (npm run dev -- --port 5175) แล้ว
//   npm i --no-save puppeteer-core && node scripts/manual-shots.mjs [http://localhost:5175]
// ต้องมี Google Chrome ติดตั้งที่ /Applications (macOS) หรือกำหนด CHROME=/path/to/chrome
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://localhost:5175";
const OUT = process.env.OUT ?? fileURLToPath(new URL("../public/manual/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--lang=th-TH", "--hide-scrollbars"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on("dialog", (d) => d.accept());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log("•", s);
const full = async (name) => { await wait(350); await page.screenshot({ path: `${OUT}${name}.webp`, type: "webp", quality: 82 }); log(name); };
const el = async (name, sel, find) => {
  const h = find ? await page.evaluateHandle(find) : await page.$(sel);
  const e = h && h.asElement ? h.asElement() : h;
  if (!e) { log(`ข้าม ${name} (ไม่พบ ${sel ?? "element"})`); return; }
  await e.evaluate((x) => x.scrollIntoView({ block: "start" }));
  await wait(150);
  await e.screenshot({ path: `${OUT}${name}.webp`, type: "webp", quality: 86 });
  log(name);
};
const card = (text, root = "#right-body") => `(() => [...document.querySelectorAll("${root} .card, ${root} details")].find((c) => c.querySelector(".card-h")?.textContent.includes(${JSON.stringify(text)})))()`;
const idle = () => page.waitForFunction(() => document.querySelector("#busy")?.hidden && document.querySelector("#right-body .card"), { timeout: 90000 });
const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const setVal = (sel, v) => page.evaluate((s, val) => { const e = document.querySelector(s); if (!e) return; if (e.type === "checkbox") e.checked = val; else e.value = val; e.dispatchEvent(new Event("change", { bubbles: true })); }, sel, v);
/** เลือกชิ้นส่วนตามรหัส (ผ่าน window.structlab3d) */
const pickMember = async (id) => { await page.evaluate((x) => window.structlab3d.select(x), id); await wait(400); return id; };

// ---------------- โหมด 3D ----------------
await page.goto(`${BASE}/3d.html`, { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}/3d.html`, { waitUntil: "networkidle0" });
await idle(); await wait(800);
await full("3d-overview");
await el("3d-ribbon", "header.ribbon");
await el("3d-building", "#left-body .card");
await el("3d-design-settings", null, card("ตั้งค่าการออกแบบ", "#left-body"));
await el("3d-foundation-settings", null, card("ตั้งค่าฐานราก", "#left-body"));
// ผลวิเคราะห์
await click('[data-display="Mz"]'); await full("3d-m33");
await click('[data-display="deformed"]'); await full("3d-deformed");
await click('[data-display="design"]'); await full("3d-design-colors");
await click('[data-display="model"]');
await click("#btn-solid"); await click("#btn-concrete"); await full("3d-solid");
await click("#btn-concrete"); await click("#btn-solid");
await click('[data-view="plan"]'); await full("3d-plan"); await click('[data-view="iso"]');
// เลือกชิ้นส่วน
const beam = await pickMember("BX-B1-2");
log(`เลือก ${beam}`);
await full("3d-select");
await el("3d-member-card", "#right-body .card");
await el("3d-edit-card", ".edit3d");
await el("3d-beam-design", null, card("ออกแบบคาน"));
await el("3d-design-summary", null, card("สรุปการออกแบบ"));
await el("3d-footing-summary", null, card("ฐานราก"));
await el("3d-drift", null, card("ตรวจการเคลื่อนตัวรายชั้น"));
// พื้นและน้ำหนัก
await setVal("#s-on", true); await idle(); await wait(600);
await el("3d-slab-inputs", null, `(() => document.querySelector("#s-on").closest(".form"))()`);
await full("3d-slabs");
await el("3d-slab-card", null, card("พื้นสองทาง"));
await click("#btn-loads"); await page.select("#sel-result", "case:DL").catch(() => {}); await wait(400); await full("3d-loads"); await click("#btn-loads");
await el("3d-boq", ".boq");
// รูปทรงอาคาร
await setVal("#g-open", "*:A2"); await wait(400);
await setVal("#g-cy0", "1.5"); await idle(); await wait(800);
await full("3d-layout");
await el("3d-layout-inputs", null, `(() => document.querySelector("#g-open").closest(".form"))()`);
await setVal("#g-open", ""); await wait(300); await setVal("#g-cy0", "0"); await idle(); await wait(500);
// คานคอดิน
await setVal("#g-tie", true); await idle(); await wait(600);
await click('[data-view="x"]'); await full("3d-tiebeam"); await click('[data-view="iso"]');
await setVal("#g-tie", false); await idle();
// แผ่นดินไหว
await setVal("#e-on", true); await idle(); await wait(800);
await el("3d-seismic-inputs", null, `(() => document.querySelector("#e-on").closest(".form"))()`);
await el("3d-seismic-card", null, card("แรงแผ่นดินไหวรายชั้น", "#left-body"));
await el("3d-drift-seismic", null, card("ตรวจการเคลื่อนตัวรายชั้น"));
await el("3d-autosize-before", null, card("สรุปการออกแบบ"));
// การสั่น
await click("#btn-modal"); await page.waitForFunction(() => document.querySelector(".card.modal table"), { timeout: 60000 });
await el("3d-modal", ".card.modal");
await click('.card.modal [data-mode="1"]'); await wait(450); await full("3d-mode");
await click("#btn-modal-stop");
// บันได
await setVal('[data-stair="enabled"]', true); await wait(400);
await el("3d-stair", null, card("ออกแบบบันได", "#left-body"));
// รายการคำนวณ
await page.setViewport({ width: 1440, height: 2300, deviceScaleFactor: 1 }); // หน้า A4 สูงกว่าจอ
await click("#btn-report3d"); await wait(2500);
const pageShot = async (name, text) => el(name, null, `(() => [...document.querySelectorAll("#report .page")].find((p) => p.innerText.includes(${JSON.stringify(text)})))()`);
await pageShot("report-cover", "สารบัญ");
await pageShot("report-summary", "สรุปข้อมูลโครงสร้างและการวิเคราะห์");
await pageShot("report-schedule", "ตารางหน้าตัดคานและเสา");
await pageShot("report-beam", "รายละเอียดเหล็กเสริมตามความยาว");
await pageShot("report-slab", "ตารางสัมประสิทธิ์โมเมนต์");
await pageShot("report-boq", "ค่าก่อสร้างโครงสร้างโดยประมาณ");
await page.keyboard.press("Escape");
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
// ไปหน้า 2D (โครงของอาคาร)
await page.goto(`${BASE}/3d.html`, { waitUntil: "networkidle0" }); await idle(); await wait(600);
const b2 = await pickMember("BX-B2-2");
log(`เลือก ${b2} แล้วไป 2D`);
await full("3d-to2d");
await click("a.btn-link");
await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
await wait(1500);

// ---------------- โหมด 2D ----------------
await full("2d-linked");
await el("2d-toolbar", "header.topbar");
for (const [tab, name] of [["nodes", "2d-tab-nodes"], ["members", "2d-tab-members"], ["sections", "2d-tab-sections"], ["loads", "2d-tab-loads"], ["wind", "2d-tab-wind"], ["combos", "2d-tab-combos"]]) {
  await click(`[data-tab="${tab}"]`); await wait(300); await el(name, "aside.left");
}
await click('[data-display="M"]'); await full("2d-moment");
await click('[data-display="deformed"]'); await full("2d-deformed");
await click('[data-display="model"]');
await el("2d-right", "aside.right");
await click('[data-mode="draw"]'); await wait(300); await full("2d-draw"); await click('[data-mode="select"]');
await page.setViewport({ width: 1440, height: 2300, deviceScaleFactor: 1 });
await click("#btn-report"); await wait(2000);
await el("2d-report", null, `(() => document.querySelector("#report .page, .report .page"))()`);
await browser.close();
console.log("เสร็จ:", OUT);
