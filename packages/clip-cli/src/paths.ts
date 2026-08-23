import { access } from "node:fs/promises";
import path from "node:path";
import type { ProjectPaths, ResolveProjectPathsOptions } from "./types";

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findWorkspaceRoot(start: string) {
  let current = path.resolve(start);

  while (true) {
    const hasGit = await exists(path.join(current, ".git"));
    const hasWorkspace = await exists(path.join(current, "pnpm-workspace.yaml"));

    if (hasGit && hasWorkspace) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return undefined;
}

function projectPathsFromRoot(repoRoot: string): ProjectPaths {
  return {
    repoRoot,
    contentDir: path.join(repoRoot, "apps/web/src/content/clips"),
    publicDir: path.join(repoRoot, "apps/web/public"),
    clipsAssetDir: path.join(repoRoot, "apps/web/public/clips"),
  };
}

export async function resolveProjectPaths({
  start = process.cwd(),
  fallbackStarts = [],
}: ResolveProjectPathsOptions = {}): Promise<ProjectPaths> {
  const candidates = [start, ...fallbackStarts];

  for (const candidate of candidates) {
    const repoRoot = await findWorkspaceRoot(candidate);

    if (repoRoot) {
      return projectPathsFromRoot(repoRoot);
    }
  }

  throw new Error("Could not find the clip workspace root from the current directory.");
}
