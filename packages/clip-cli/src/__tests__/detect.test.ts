import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { detectInput } from "../detect";

const tempDirs: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("detectInput", () => {
  it("detects tweet urls", async () => {
    const detection = await detectInput("https://x.com/iamrajjoshi_/status/1776391593418664426");
    assert.equal(detection.kind, "tweet");
  });

  it("detects video urls", async () => {
    const detection = await detectInput("https://youtu.be/dQw4w9WgXcQ");
    assert.equal(detection.kind, "video");
  });

  it("falls back to link for bluesky urls", async () => {
    const detection = await detectInput("https://bsky.app/profile/example.com/post/123");
    assert.equal(detection.kind, "link");
  });

  it("keeps github urls on the generic link flow", async () => {
    const detection = await detectInput("https://github.com/iamrajjoshi/clip");
    assert.equal(detection.kind, "link");
  });

  it("detects local image paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "clip-detect-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "sample.png");
    await writeFile(filePath, "not-a-real-png");
    const detection = await detectInput(filePath);
    assert.equal(detection.kind, "image");
  });
});
