// Post-build patch: the rolldown runtime chunk eagerly calls
// createRequire(import.meta.url), which crashes on the published host
// where import.meta.url is undefined. Make it lazy and fall back to a
// stub require that throws only if actually used.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../dist/server/assets", import.meta.url).pathname;
const needle = 'var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();';
const replacement =
  'var __require = /* #__PURE__ */ (() => { try { return createRequire(import.meta.url || "file:///server.js"); } catch { return (id) => { throw new Error("require is not available: " + id); }; } })();';

let patched = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".js")) continue;
  const p = join(dir, f);
  const src = readFileSync(p, "utf8");
  if (src.includes(needle)) {
    writeFileSync(p, src.replace(needle, replacement));
    patched++;
    console.log("patched", f);
  }
}
if (!patched) {
  console.error("patch-dist: needle not found in any server asset");
  process.exit(1);
}
