import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const license = readFileSync(resolve(root, "LICENSE"), "utf8");
const packages = [
  { directory: "clip-cli", files: ["dist/index.js", "dist/index.js.map", "THIRD_PARTY_NOTICES"] },
  { directory: "clip-schema", files: ["src/index.ts"] },
];

for (const { directory, files } of packages) {
  const cwd = resolve(root, "packages", directory);
  const pkg = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
  assert.equal(pkg.license, "MIT", `${pkg.name}: missing MIT metadata`);
  assert.equal(pkg.repository.directory, `packages/${directory}`);
  assert.equal(pkg.bugs.url, "https://github.com/iamrajjoshi/cliplink/issues");
  assert.equal(readFileSync(resolve(cwd, "LICENSE"), "utf8"), license);
  const [packed] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    }),
  );
  assert.deepEqual(
    packed.files.map(({ path }) => path).sort(),
    ["LICENSE", "README.md", "package.json", ...files].sort(),
    `${pkg.name}: unexpected package files; build first and check the publish allowlist`,
  );
  console.log(`${pkg.name}@${pkg.version}: license, metadata, and package files verified`);
}

const cliRoot = resolve(root, "packages/clip-cli");
assert.ok(statSync(resolve(cliRoot, "dist/index.js")).mode & 0o111, "CLI must be executable");
const sourceMap = JSON.parse(readFileSync(resolve(cliRoot, "dist/index.js.map"), "utf8"));
const bundledDependencies = sourceMap.sources.filter((source) => source.includes("node_modules/"));
assert.ok(bundledDependencies.length > 0, "Expected dependency sources in the CLI source map");
assert.ok(
  bundledDependencies.every((source) => source.includes("node_modules/zod/")),
  "A new dependency is bundled; review its license and update THIRD_PARTY_NOTICES",
);
const requireSchema = createRequire(resolve(root, "packages/clip-schema/package.json"));
const zodRoot = dirname(requireSchema.resolve("zod/package.json"));
const zodLicense = readFileSync(resolve(zodRoot, "LICENSE"), "utf8").trim();
assert.ok(
  readFileSync(resolve(cliRoot, "THIRD_PARTY_NOTICES"), "utf8").includes(zodLicense),
  "Bundled Zod license differs from THIRD_PARTY_NOTICES",
);
console.log("CLI executable and bundled dependency notices verified");
