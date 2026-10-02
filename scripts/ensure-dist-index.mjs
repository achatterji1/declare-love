import { copyFileSync, existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const clientIndex = join(root, "dist/client/index.html");
const declareIndex = join(root, "dist/client/declare/index.html");
const distIndex = join(root, "dist/index.html");

mkdirSync(join(root, "dist"), { recursive: true });

const redirect = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta http-equiv="refresh" content="0;url=/declare/index.html"/><script>location.replace("/declare/index.html")</script></head><body><a href="/declare/index.html">Continue to Declare</a></body></html>`;

if (!existsSync(clientIndex)) {
  writeFileSync(clientIndex, redirect);
}
writeFileSync(distIndex, redirect);

// Lovable sometimes expects flat static assets under dist/
if (existsSync(declareIndex)) {
  mkdirSync(join(root, "dist/declare"), { recursive: true });
  cpSync(join(root, "dist/client/declare"), join(root, "dist/declare"), { recursive: true });
}

console.log("ensure-dist-index: wrote dist/index.html and mirrored declare/");
