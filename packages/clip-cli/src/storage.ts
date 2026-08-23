import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectPaths } from "./types";
import { ensureDir, sanitizeFilename } from "./utils";

export interface Storage {
  writeBuffer(slug: string, filename: string, buffer: Buffer): Promise<string>;
  copyLocalFile(slug: string, sourcePath: string, filename?: string): Promise<string>;
}

export function createLocalStorage(paths: ProjectPaths): Storage {
  async function ensureClipDir(slug: string) {
    const clipDir = path.join(paths.clipsAssetDir, slug);
    await ensureDir(clipDir);
    return clipDir;
  }

  return {
    async writeBuffer(slug, filename, buffer) {
      const clipDir = await ensureClipDir(slug);
      const safeFilename = sanitizeFilename(filename) || "asset";
      const destination = path.join(clipDir, safeFilename);
      await writeFile(destination, buffer);
      return `/clips/${slug}/${safeFilename}`;
    },
    async copyLocalFile(slug, sourcePath, filename) {
      const clipDir = await ensureClipDir(slug);
      const safeFilename = sanitizeFilename(filename ?? path.basename(sourcePath));
      const destination = path.join(clipDir, safeFilename);
      await copyFile(sourcePath, destination);
      return `/clips/${slug}/${safeFilename}`;
    },
  };
}
