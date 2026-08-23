import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeClip } from "../markdown";
import { clipFrontmatterSchema } from "../schema";

describe("serializeClip", () => {
  it("serializes valid frontmatter and body", () => {
    const frontmatter = clipFrontmatterSchema.parse({
      kind: "link",
      slug: "sample-link",
      clippedAt: new Date("2026-04-19T00:00:00.000Z"),
      tags: ["github"],
      url: "https://github.com/iamrajjoshi/clip",
      title: "GitHub - iamrajjoshi/clip",
    });
    const markdown = serializeClip(frontmatter, "small commentary");

    assert.match(markdown, /kind: link/);
    assert.match(markdown, /tags:\n {2}- github/);
    assert.match(markdown, /title: GitHub - iamrajjoshi\/clip/);
    assert.match(markdown, /small commentary/);
  });

  it("validates all supported kinds", () => {
    const cases = [
      {
        kind: "link",
        slug: "link",
        clippedAt: new Date(),
        tags: [],
        url: "https://example.com",
        title: "example",
      },
      {
        kind: "tweet",
        slug: "tweet",
        clippedAt: new Date(),
        tags: [],
        platform: "x",
        url: "https://x.com/example/status/1",
        author: { name: "example", handle: "example" },
        text: "hello",
        postedAt: new Date(),
      },
      {
        kind: "image",
        slug: "image",
        clippedAt: new Date(),
        tags: [],
        src: "/clips/image/file.png",
        width: 100,
        height: 100,
      },
      {
        kind: "video",
        slug: "video",
        clippedAt: new Date(),
        tags: [],
        url: "https://youtu.be/dQw4w9WgXcQ",
        provider: "youtube",
        title: "video",
      },
      {
        kind: "note",
        slug: "note",
        clippedAt: new Date(),
        tags: [],
      },
    ] as const;

    for (const candidate of cases) {
      assert.equal(clipFrontmatterSchema.safeParse(candidate).success, true);
    }
  });
});
