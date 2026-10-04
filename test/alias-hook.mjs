export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    let rel = specifier.slice(2);
    if (!/\.[cm]?[jt]s$/.test(rel)) rel += ".ts";
    return nextResolve(new URL("../src/" + rel, import.meta.url).href, context);
  }
  const parent = context.parentURL || "";
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier) && parent.includes("/src/")) {
    return nextResolve(specifier + ".ts", context);
  }
  return nextResolve(specifier, context);
}
