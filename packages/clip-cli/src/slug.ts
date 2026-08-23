import { readdir } from "node:fs/promises";
import path from "node:path";
import { firstMeaningfulLine, slugify } from "./utils";

export function baseSlugFromText(input: string, fallback = "clip") {
  const line = firstMeaningfulLine(input) ?? fallback;
  return slugify(line) || fallback;
}

export async function ensureUniqueSlug(baseSlug: string, contentDir: string) {
  const filenames = await readdir(contentDir).catch(() => []);
  const existing = new Set(
    filenames
      .filter((filename) => filename.endsWith(".md"))
      .map((filename) => {
        const basename = path.basename(filename, ".md");
        const match = basename.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
        return match?.[1] ?? basename;
      }),
  );

  if (!existing.has(baseSlug)) {
    return baseSlug;
  }

  let counter = 2;
  while (existing.has(`${baseSlug}-${counter}`)) {
    counter += 1;
  }

  return `${baseSlug}-${counter}`;
}

export function datedFilename(date: Date, slug: string) {
  return `${date.toISOString().slice(0, 10)}-${slug}.md`;
}
