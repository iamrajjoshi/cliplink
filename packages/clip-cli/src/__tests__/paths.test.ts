import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { resolveProjectPaths } from "../paths";

const tempDirs: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function createWorkspaceRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "clip-paths-"));
  tempDirs.push(root);
  await mkdir(path.join(root, ".git"));
  await writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  return root;
}

describe("resolveProjectPaths", () => {
  it("finds the workspace root from a nested directory", async () => {
    const root = await createWorkspaceRoot();
    const nestedDir = path.join(root, "apps", "web", "src");
    await mkdir(nestedDir, { recursive: true });

    const paths = await resolveProjectPaths({ start: nestedDir });

    assert.equal(paths.repoRoot, root);
    assert.equal(paths.contentDir, path.join(root, "apps/web/src/content/clips"));
  });

  it("falls back to another start when cwd is outside the workspace", async () => {
    const root = await createWorkspaceRoot();
    const cliDir = path.join(root, "packages", "clip-cli", "src");
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "clip-outside-"));
    tempDirs.push(outsideDir);
    await mkdir(cliDir, { recursive: true });

    const paths = await resolveProjectPaths({
      start: outsideDir,
      fallbackStarts: [cliDir],
    });

    assert.equal(paths.repoRoot, root);
    assert.equal(paths.clipsAssetDir, path.join(root, "apps/web/public/clips"));
  });

  it("prefers the clip workspace over another pnpm workspace", async () => {
    const clipRoot = await createWorkspaceRoot();
    const otherRoot = await createWorkspaceRoot();
    const cliDir = path.join(clipRoot, "packages", "clip-cli", "src");
    await mkdir(cliDir, { recursive: true });

    const paths = await resolveProjectPaths({
      start: cliDir,
      fallbackStarts: [otherRoot],
    });

    assert.equal(paths.repoRoot, clipRoot);
  });
});
