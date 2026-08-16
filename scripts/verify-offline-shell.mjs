import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const publicDir = resolve("dist/public");
const shell = await readFile(resolve(publicDir, "index.html"), "utf8");
const assetPaths = Array.from(shell.matchAll(/(?:src|href)="([^\"]*\/assets\/[^\"]+)"/g), match => match[1]);

if (!assetPaths.length) {
  throw new Error("O build não contém bundles JavaScript ou CSS para pré-cache.");
}

const simulatedCache = new Map([["/", shell]]);
for (const assetPath of assetPaths) {
  const content = await readFile(resolve(publicDir, `.${assetPath}`));
  simulatedCache.set(assetPath, content);
}

const offlineFetch = path => {
  const cached = simulatedCache.get(path);
  if (!cached) throw new Error(`Recurso indisponível offline: ${path}`);
  return cached;
};

if (!offlineFetch("/").includes("<div id=\"root\"></div>")) {
  throw new Error("O shell HTML não foi recuperado do cache offline.");
}
for (const assetPath of assetPaths) {
  if (!offlineFetch(assetPath).length) throw new Error(`Bundle vazio no cache offline: ${assetPath}`);
}

console.log(`Shell offline validado: HTML + ${assetPaths.length} bundle(s) essenciais em cache.`);
