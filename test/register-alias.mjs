import { register } from "node:module";

register(new URL("./alias-hook.mjs", import.meta.url), import.meta.url);
