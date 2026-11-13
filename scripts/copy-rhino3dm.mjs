// Copies the rhino3dm WASM build into public/ so the 3DMLoader never hits a CDN.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'rhino3dm');
const dest = join(root, 'public', 'rhino3dm');

if (!existsSync(src)) {
  console.warn('[copy-rhino3dm] rhino3dm not installed yet, skipping');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of ['rhino3dm.js', 'rhino3dm.wasm']) {
  cpSync(join(src, f), join(dest, f));
}
console.log('[copy-rhino3dm] copied rhino3dm.js + rhino3dm.wasm to public/rhino3dm/');
