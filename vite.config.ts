import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  server: { port: 8080 },
  // Bundle deps into the production SSR output so the published host has them,
  // then scripts/patch-dist.mjs fixes createRequire(import.meta.url) for that host.
  // Dev keeps dependencies external: Vite 8's SSR runner evaluates React's CJS
  // entry as ESM and throws "module is not defined" when noExternal is true.
  ssr: { noExternal: command === "build" ? true : [] },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [tanstackStart(), viteReact()],
}));
