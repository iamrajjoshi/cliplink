import { writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import type { ClipFrontmatter } from "./schema";

function stripUndefined(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
    );
  }

  return value;
}

export function serializeClip(frontmatter: ClipFrontmatter, body = "") {
  const yaml = stringify(stripUndefined(frontmatter), {
    lineWidth: 0,
  }).trimEnd();

  const trimmedBody = body.trim();
  return `---\n${yaml}\n---\n${trimmedBody ? `\n${trimmedBody}\n` : ""}`;
}

export async function writeClipFile(contentDir: string, filename: string, markdown: string) {
  const destination = path.join(contentDir, filename);
  await writeFile(destination, markdown, "utf8");
  return destination;
}
