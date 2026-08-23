import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

export function slugify(input: string) {
  return input
    .normalize("NFKD")
    .split("")
    .filter((character) => character.charCodeAt(0) < 128)
    .join("")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function ensureDir(directory: string) {
  await mkdir(directory, { recursive: true });
}

export function sanitizeFilename(input: string) {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function expandHomeDirectory(input: string) {
  if (input === "~") {
    return os.homedir();
  }

  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

export function looksLikeUrl(input: string) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function pathExtFromUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return path.extname(url.pathname);
  } catch {
    return "";
  }
}

export function extFromContentType(contentType: string | null) {
  if (!contentType) {
    return "";
  }

  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return IMAGE_CONTENT_TYPES[normalized] ?? "";
}

export function firstMeaningfulLine(input: string) {
  return input
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
}

export async function readStdin() {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchBuffer(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "clip.rajjoshi.me/1.0 (+https://clip.rajjoshi.me)",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
  };
}

export function normalizeTags(input: string) {
  return [
    ...new Set(
      input
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}
