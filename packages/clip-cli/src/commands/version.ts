import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the CLI version from package.json.
 *
 * Works in both dev (tsx running src/) and built (dist/index.js) modes by
 * trying candidate paths relative to this module's location.
 */
export function getVersion(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "..", "package.json"), // built: dist/ -> ../package.json
    path.join(moduleDir, "..", "..", "package.json"), // dev: src/commands/ -> ../../package.json
  ];

  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, "utf8");
      const pkg = JSON.parse(content) as { version?: string };
      if (typeof pkg.version === "string") {
        return pkg.version;
      }
    } catch {
      // Try next candidate
    }
  }

  return "unknown";
}

export function printVersion(): void {
  console.log(getVersion());
}
