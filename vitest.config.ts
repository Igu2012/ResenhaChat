import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);
const packageJson = JSON.parse(readFileSync(path.join(templateRoot, "package.json"), "utf8")) as { version: string };

export default defineConfig({
  root: templateRoot,
  define: {
    __RESENHA_APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "client/src/**/*.test.ts", "client/src/**/*.spec.ts"],
  },
});
