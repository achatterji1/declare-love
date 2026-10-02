import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
mkdirSync(join(root, "dist"), { recursive: true });
mkdirSync(join(root, "dist/client"), { recursive: true });

const redirect = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Declare — multiplayer memory card game</title>
  <meta http-equiv="refresh" content="0;url=/declare/index.html" />
  <script>location.replace("/declare/index.html");</script>
</head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#f3ebe0;display:grid;place-items:center;min-height:100vh">
  <p><a href="/declare/index.html">Continue to Declare</a></p>
</body>
</html>
`;

writeFileSync(join(root, "dist/index.html"), redirect);
writeFileSync(join(root, "dist/client/index.html"), redirect);

const from = join(root, "dist/client/declare");
const to = join(root, "dist/declare");
if (existsSync(from)) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}
console.log("ensure-dist-index: ok");
