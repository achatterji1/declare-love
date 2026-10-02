// Post-build patch: the rolldown runtime chunk eagerly calls
// createRequire(import.meta.url), which crashes on the published host
// where import.meta.url is undefined. Make it lazy and fall back to a
// stub require that throws only if actually used.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "dist/server/assets");
if (!existsSync(dir)) {
  console.log("patch-dist: no dist/server/assets — skip");
  process.exit(0);
}

const needles = [
  'var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();',
  'var __require = /* @__PURE__ */ (() => createRequire(import.meta.url))();',
  '(() => createRequire(import.meta.url))()',
];
const replacement =
  'var __require = /* #__PURE__ */ (() => { try { return createRequire(import.meta.url || "file:///server.js"); } catch { return (id) => { throw new Error("require is not available: " + id); }; } })();';

let patched = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".js")) continue;
  const p = join(dir, f);
  let src = readFileSync(p, "utf8");
  const before = src;
  for (const needle of needles) {
    if (src.includes(needle)) {
      if (needle.startsWith("var __require")) {
        src = src.replace(needle, replacement);
      } else {
        src = src.replaceAll(
          needle,
          '(() => { try { return createRequire(import.meta.url || "file:///server.js"); } catch { return (id) => { throw new Error("require is not available: " + id); }; } })()',
        );
      }
    }
  }
  // Also soften any remaining createRequire(import.meta.url) forms
  src = src.replace(
    /createRequire\(\s*import\.meta\.url\s*\)/g,
    'createRequire(import.meta.url || "file:///server.js")',
  );
  if (src !== before) {
    writeFileSync(p, src);
    patched++;
    console.log("patched", f);
  }
}

// Patch main server.js too
const serverMain = join(process.cwd(), "dist/server/server.js");
if (existsSync(serverMain)) {
  let src = readFileSync(serverMain, "utf8");
  const before = src;
  src = src.replace(
    /createRequire\(\s*import\.meta\.url\s*\)/g,
    'createRequire(import.meta.url || "file:///server.js")',
  );
  if (src !== before) {
    writeFileSync(serverMain, src);
    patched++;
    console.log("patched server.js");
  }
}

if (!patched) {
  console.log("patch-dist: nothing to patch (ok for lean builds)");
} else {
  console.log("patch-dist: patched", patched, "file(s)");
}
