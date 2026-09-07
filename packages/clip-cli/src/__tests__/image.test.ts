import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import { inspectImage } from "../scrapers/image";

describe("inspectImage", () => {
  for (const format of ["png", "jpeg", "webp"] as const) {
    it(`reads dimensions and filenames from a ${format} image`, async (t) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "clip-image-"));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const filename = `sample.photo.${format}`;
      const filePath = path.join(directory, filename);

      await sharp({
        create: {
          width: 3,
          height: 2,
          channels: 3,
          background: "#2463eb",
        },
      })
        .toFormat(format)
        .toFile(filePath);

      assert.deepEqual(await inspectImage(filePath), {
        width: 3,
        height: 2,
        filename,
        stem: "sample.photo",
      });
    });
  }
});
