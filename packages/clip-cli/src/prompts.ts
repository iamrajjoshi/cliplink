import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { confirm } from "@inquirer/prompts";

async function openEditor(initialText: string) {
  const editor = process.env.VISUAL || process.env.EDITOR;

  if (!editor) {
    return "";
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clip-"));
  const filePath = path.join(tempDir, "note.md");

  try {
    await writeFile(filePath, initialText, "utf8");
    const result = spawnSync(editor, [filePath], {
      stdio: "inherit",
      shell: true,
    });

    if (result.status !== 0) {
      throw new Error(`Editor exited with status ${result.status ?? "unknown"}`);
    }

    return (await readFile(filePath, "utf8")).trim();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function collectPrompts(existingBody = "") {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return {
      body: existingBody.trim(),
    };
  }

  let body = existingBody.trim();

  if (!body) {
    const wantsNote = await confirm({
      message: "add a note in $EDITOR?",
      default: false,
    });

    if (wantsNote) {
      body = await openEditor(["# add your note here", "", ""].join("\n"));

      if (body.startsWith("# add your note here")) {
        body = body.replace(/^# add your note here/, "").trim();
      }
    }
  }

  return {
    body,
  };
}
