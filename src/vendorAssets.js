// Self-hosts the MediaPipe browser assets (client.js's in-browser focus
// detector) instead of loading them from cdn.jsdelivr.net and
// storage.googleapis.com. Some networks (school/work/hotel wifi) block
// those CDNs outright, which silently drops players back to the manual
// focus toggle - self-hosting means the only thing anyone ever needs to
// reach is this server itself. Downloaded once into public/vendor/ on
// first boot (gitignored, like leaderboard.db) and reused after that.
const fs = require('fs');
const path = require('path');

const VENDOR_DIR = path.join(__dirname, '..', 'public', 'vendor', 'mediapipe');
const WASM_DIR = path.join(VENDOR_DIR, 'wasm');
const PKG_VERSION = '1.0.1';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${PKG_VERSION}`;

const ASSETS = [
  { url: `${CDN_BASE}/vision_bundle.mjs`, dest: path.join(VENDOR_DIR, 'vision_bundle.mjs') },
  { url: `${CDN_BASE}/wasm/vision_wasm_internal.js`, dest: path.join(WASM_DIR, 'vision_wasm_internal.js') },
  { url: `${CDN_BASE}/wasm/vision_wasm_internal.wasm`, dest: path.join(WASM_DIR, 'vision_wasm_internal.wasm') },
  { url: `${CDN_BASE}/wasm/vision_wasm_nosimd_internal.js`, dest: path.join(WASM_DIR, 'vision_wasm_nosimd_internal.js') },
  { url: `${CDN_BASE}/wasm/vision_wasm_nosimd_internal.wasm`, dest: path.join(WASM_DIR, 'vision_wasm_nosimd_internal.wasm') },
  {
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
    dest: path.join(VENDOR_DIR, 'face_landmarker.task'),
  },
];

async function downloadIfMissing({ url, dest }) {
  if (fs.existsSync(dest)) return;
  console.log(`downloading ${path.basename(dest)} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to download ${url}: HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function ensureVendorAssets() {
  fs.mkdirSync(WASM_DIR, { recursive: true });
  await Promise.all(ASSETS.map(downloadIfMissing));
}

module.exports = { ensureVendorAssets };
