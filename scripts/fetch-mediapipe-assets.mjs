/**
 * Prepares the MediaPipe static assets used by the hand control panel.
 *
 * - Copies the `@mediapipe/tasks-vision` ES bundle and its wasm files out of
 *   node_modules into `public/mediapipe/`. The library is loaded at runtime
 *   rather than bundled: it contains a dynamic `import()` of its own wasm
 *   loader that Turbopack refuses to resolve, which breaks `next dev`.
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

const MEDIAPIPE_DIR = path.resolve("public/mediapipe");
const WASM_DIR = path.join(MEDIAPIPE_DIR, "wasm");
const MODEL_DIR = path.resolve("public/mediapipe/models");
const MODEL_FILE = path.join(MODEL_DIR, "hand_landmarker.task");

const force = process.argv.includes("--force");

function copyLibrary() {
  let wasmSrcDir;
  try {
    // The package only exports individual files, so resolve one of the wasm
    // entries and take its directory.
    wasmSrcDir = path.dirname(
      require.resolve("@mediapipe/tasks-vision/vision_wasm_internal.js")
    );
  } catch {
    console.warn(
      "[mediapipe] @mediapipe/tasks-vision is not installed; skipping library copy."
    );
    return;
  }

  if (!fs.existsSync(wasmSrcDir)) {
    console.warn(
      `[mediapipe] wasm directory not found at ${wasmSrcDir}; skipping.`
    );
    return;
  }

  const packageDir = path.dirname(wasmSrcDir);
  let copied = 0;

  const copy = (src, dest) => {
    if (!force && fs.existsSync(dest)) return;
    if (!fs.existsSync(src)) return;
    fs.copyFileSync(src, dest);
    copied++;
  };

  fs.mkdirSync(WASM_DIR, { recursive: true });
  for (const file of fs.readdirSync(wasmSrcDir)) {
    copy(path.join(wasmSrcDir, file), path.join(WASM_DIR, file));
  }

  copy(
    path.join(packageDir, "vision_bundle.mjs"),
    path.join(MEDIAPIPE_DIR, "vision_bundle.mjs")
  );

  console.log(
    copied > 0
      ? `[mediapipe] copied ${copied} file(s) to public/mediapipe/`
      : "[mediapipe] library assets already present."
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

copyLibrary();
await downloadModel();
