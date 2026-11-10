// Checks web/pipeline.js against the Python pipeline output in fixture.json
// (made by export_model.py). Run: node web/tools/check_pipeline.mjs
import { readFileSync } from "node:fs";
import { normalizeSkeleton, extractLiveClip, mirrorSkeleton, buildTensor } from "../pipeline.js";

const fx = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));
const frames = fx.raw.map((f) => normalizeSkeleton(f.map(([x, y, z, visibility]) => ({ x, y, z, visibility }))));
const clip = extractLiveClip(frames, fx.fps);

let ok = true;
for (const [name, c] of [["plain", clip], ["mirrored", mirrorSkeleton(clip)]]) {
  const got = buildTensor(c), want = fx[name].tensor;
  let maxDiff = 0;
  for (let i = 0; i < want.length; i++) maxDiff = Math.max(maxDiff, Math.abs(got[i] - want[i]));
  const pass = got.length === want.length && maxDiff < 1e-4;
  ok &&= pass;
  console.log(`${name}: max diff ${maxDiff.toExponential(2)} ${pass ? "OK" : "FAIL"}`);
}
process.exit(ok ? 0 : 1);
