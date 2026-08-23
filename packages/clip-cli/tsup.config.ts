import { defineConfig } from "tsup";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["sharp"],
  noExternal: ["@clip/schema"],
  onSuccess: async () => {
    const distPath = resolve("dist/index.js");
    const content = readFileSync(distPath, "utf8");
    // Strip esbuild source-path annotation comments (e.g. // src/index.ts, // ../clip-schema/src/index.ts)
    const stripped = content
      .split("\n")
      .filter((line) => !/^\/\/ (src\/|\.\.\/).*\.(ts|js)$/.test(line))
      .join("\n");
    writeFileSync(distPath, stripped, "utf8");
    chmodSync(distPath, 0o755);
  },
});
