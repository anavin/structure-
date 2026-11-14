// คำนวณเบื้องหลัง (Web Worker): วิเคราะห์ทุกกรณี และออกแบบคาน/เสา/ฐานราก — หน้าจอไม่ค้างระหว่างคำนวณ

import { runAll3, type Run3 } from "../core3d/combos3d.ts";
import type { Model3 } from "../core3d/model3d.ts";
import { design3d, type Design3Settings } from "../design/design3d.ts";
import type { FoundationSettings } from "../design/footing.ts";
import { designFoundations3 } from "../design/foundation3d.ts";

export type WorkerIn =
  | { type: "analyze"; seq: number; model: Model3 }
  | { type: "design"; seq: number; dset: Design3Settings; fset: FoundationSettings };
export type WorkerOut =
  | { type: "progress"; seq: number; phase: string; done: number; total: number }
  | { type: "analyzed"; seq: number; run: Run3 }
  | { type: "designed"; seq: number; design: ReturnType<typeof design3d>; footings: ReturnType<typeof designFoundations3>["footings"] | null; footError: string | null }
  | { type: "error"; seq: number; message: string };

let model: Model3 | null = null;
let run: Run3 | null = null;
const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === "analyze") {
      model = msg.model;
      run = runAll3(model, (done, total) => post({ type: "progress", seq: msg.seq, phase: "วิเคราะห์", done, total }));
      post({ type: "analyzed", seq: msg.seq, run });
    } else if (msg.type === "design") {
      if (!model || !run) throw new Error("ยังไม่ได้วิเคราะห์");
      post({ type: "progress", seq: msg.seq, phase: "ออกแบบคาน/เสา", done: 0, total: 2 });
      const design = design3d(model, run, msg.dset);
      post({ type: "progress", seq: msg.seq, phase: "ออกแบบฐานราก", done: 1, total: 2 });
      let footings = null, footError = null;
      try { footings = designFoundations3(model, run, msg.fset, msg.dset.code).footings; } catch (err) { footError = (err as Error).message; }
      post({ type: "designed", seq: msg.seq, design, footings, footError });
    }
  } catch (err) {
    post({ type: "error", seq: msg.seq, message: (err as Error).message });
  }
};
