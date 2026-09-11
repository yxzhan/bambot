/**
 * Prepares the MediaPipe static assets used by the hand control panel.
 *
 * - Copies the `@mediapipe/tasks-vision` wasm bundle out of node_modules into
 *   `public/mediapipe/wasm/`.
 * - Downloads the Hand Landmarker model into `public/mediapipe/models/`.
 *
 * Both outputs are gitignored, so this runs from `predev` / `prebuild`.
 * Existing files are left alone; pass `--force` to refetch.
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WASM_DIR = path.resolve("public/mediapipe/wasm");
const MODEL_DIR = path.resolve("public/mediapipe/models");
const MODEL_FILE = path.join(MODEL_DIR, "hand_landmarker.task");

const force = process.argv.includes("--force");

function copyWasm() {
  let srcDir;
  try {
    // The package only exports individual files, so resolve one of the wasm
    // entries and take its directory.
    srcDir = path.dirname(
      require.resolve("@mediapipe/tasks-vision/vision_wasm_internal.js")
    );
  } catch {
    console.warn(
      "[mediapipe] @mediapipe/tasks-vision is not installed; skipping wasm copy."
    );
    return;
  }

  if (!fs.existsSync(srcDir)) {
    console.warn(`[mediapipe] wasm directory not found at ${srcDir}; skipping.`);
    return;
  }

  fs.mkdirSync(WASM_DIR, { recursive: true });
  let copied = 0;
  for (const file of fs.readdirSync(srcDir)) {
    const dest = path.join(WASM_DIR, file);
    if (!force && fs.existsSync(dest)) continue;
    fs.copyFileSync(path.join(srcDir, file), dest);
    copied++;
  }
  console.log(
    copied > 0
      ? `[mediapipe] copied ${copied} wasm file(s) to public/mediapipe/wasm/`
      : "[mediapipe] wasm assets already present."
  );
}

async function downloadModel() {
  if (!force && fs.existsSync(MODEL_FILE)) {
    console.log("[mediapipe] hand_landmarker.task already present.");
    return;
  }

  fs.mkdirSync(MODEL_DIR, { recursive: true });
  console.log(`[mediapipe] downloading ${MODEL_URL} ...`);
  try {
    const response = await fetch(MODEL_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(MODEL_FILE, buffer);
    console.log(
      `[mediapipe] saved hand_landmarker.task (${(buffer.length / 1e6).toFixed(1)} MB)`
    );
  } catch (error) {
    // Not fatal: the app falls back to loading the model from the CDN at runtime.
    console.warn(
      `[mediapipe] failed to download the hand landmarker model: ${error.message}`
    );
    console.warn("[mediapipe] the app will fall back to the CDN at runtime.");
  }
}

copyWasm();
await downloadModel();
