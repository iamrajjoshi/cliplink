import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { baseSlugFromText, datedFilename, ensureUniqueSlug } from "../slug";

const tempDirs: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("slug helpers", () => {
  it("slugifies note content", () => {
    assert.equal(baseSlugFromText("A tiny saved note"), "a-tiny-saved-note");
  });

  it("adds a counter for duplicate slugs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "clip-slug-"));
    tempDirs.push(dir);
    await writeFile(path.join(dir, "2026-04-19-sample.md"), "");
    assert.equal(await ensureUniqueSlug("sample", dir), "sample-2");
  });

  it("builds dated filenames", () => {
    assert.equal(
      datedFilename(new Date("2026-04-19T00:00:00.000Z"), "sample"),
      "2026-04-19-sample.md",
    );
  });
});
