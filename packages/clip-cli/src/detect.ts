import { stat } from "node:fs/promises";
import path from "node:path";
import type { Detection } from "./types";
import { looksLikeUrl, readStdin } from "./utils";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]);

function isTweetUrl(url: URL) {
  const host = url.hostname.replace(/^www\./, "");
  return (host === "x.com" || host === "twitter.com") && /\/status\/\d+/.test(url.pathname);
}

function isVideoUrl(url: URL) {
  const host = url.hostname.replace(/^www\./, "");
  return host === "youtube.com" || host === "youtu.be" || host === "vimeo.com";
}

export async function detectInput(input: string, cwd = process.cwd()): Promise<Detection> {
  if (input === "-") {
    return {
      kind: "note",
      rawInput: "-",
      stdinText: await readStdin(),
    };
  }

  if (looksLikeUrl(input)) {
    const url = new URL(input);

    if (isTweetUrl(url)) {
      return { kind: "tweet", rawInput: input, url };
    }

    if (isVideoUrl(url)) {
      return { kind: "video", rawInput: input, url };
    }

    return { kind: "link", rawInput: input, url };
  }

  const resolvedPath = path.resolve(cwd, input);
  const fileStat = await stat(resolvedPath).catch(() => null);

  if (!fileStat) {
    throw new Error(`Input is neither a supported URL nor an existing local file: ${input}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`Only image file paths are supported right now: ${input}`);
  }

  const extension = path.extname(resolvedPath).toLowerCase();

  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported local file type: ${extension || "unknown"}`);
  }

  return {
    kind: "image",
    rawInput: input,
    filePath: resolvedPath,
  };
}
