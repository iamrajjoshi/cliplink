import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clipDataSchema, clipFrontmatterSchema, clipKindSchema } from "@clip/schema";

describe("@clip/schema package", () => {
  describe("valid clips parse", () => {
    it("parses a valid link clip", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "link",
        slug: "sample-link",
        clippedAt: new Date("2026-04-19T00:00:00.000Z"),
        tags: ["github"],
        url: "https://github.com/iamrajjoshi/clip",
        title: "GitHub - iamrajjoshi/clip",
      });
      assert.equal(result.success, true);
    });

    it("parses a valid tweet clip", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "tweet",
        slug: "tweet",
        clippedAt: new Date(),
        tags: [],
        platform: "x",
        url: "https://x.com/example/status/1",
        author: { name: "example", handle: "example" },
        text: "hello",
        postedAt: new Date(),
      });
      assert.equal(result.success, true);
    });

    it("parses a valid image clip", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "image",
        slug: "image",
        clippedAt: new Date(),
        tags: [],
        src: "/clips/image/file.png",
        width: 100,
        height: 100,
      });
      assert.equal(result.success, true);
    });

    it("parses a valid video clip", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "video",
        slug: "video",
        clippedAt: new Date(),
        tags: [],
        url: "https://youtu.be/dQw4w9WgXcQ",
        provider: "youtube",
        title: "video",
      });
      assert.equal(result.success, true);
    });

    it("parses a valid note clip", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "note",
        slug: "note",
        clippedAt: new Date(),
        tags: [],
      });
      assert.equal(result.success, true);
    });

    it("defaults tags to empty array when omitted", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "note",
        slug: "note",
        clippedAt: new Date(),
      });
      assert.equal(result.success, true);
      if (result.success) {
        assert.deepEqual(result.data.tags, []);
      }
    });

    it("coerces clippedAt from ISO string", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "note",
        slug: "note",
        clippedAt: "2026-04-19T00:00:00.000Z",
        tags: [],
      });
      assert.equal(result.success, true);
      if (result.success) {
        assert.ok(result.data.clippedAt instanceof Date);
      }
    });
  });

  describe("invalid clips reject", () => {
    it("rejects an unknown kind", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "unknown",
        slug: "test",
        clippedAt: new Date(),
        tags: [],
      });
      assert.equal(result.success, false);
    });

    it("rejects a link clip with missing url", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "link",
        slug: "test",
        clippedAt: new Date(),
        tags: [],
        title: "test",
      });
      assert.equal(result.success, false);
    });

    it("rejects a link clip with invalid url", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "link",
        slug: "test",
        clippedAt: new Date(),
        tags: [],
        url: "not-a-url",
        title: "test",
      });
      assert.equal(result.success, false);
    });

    it("rejects a link clip with missing title", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "link",
        slug: "test",
        clippedAt: new Date(),
        tags: [],
        url: "https://example.com",
      });
      assert.equal(result.success, false);
    });

    it("rejects an image clip with non-positive width", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "image",
        slug: "test",
        clippedAt: new Date(),
        tags: [],
        src: "/clips/test/file.png",
        width: 0,
        height: 100,
      });
      assert.equal(result.success, false);
    });

    it("rejects a video clip with invalid provider", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "video",
        slug: "test",
        clippedAt: new Date(),
        tags: [],
        url: "https://youtu.be/dQw4w9WgXcQ",
        provider: "invalid",
        title: "test",
      });
      assert.equal(result.success, false);
    });

    it("rejects a tweet clip with missing author", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "tweet",
        slug: "test",
        clippedAt: new Date(),
        tags: [],
        platform: "x",
        url: "https://x.com/example/status/1",
        text: "hello",
        postedAt: new Date(),
      });
      assert.equal(result.success, false);
    });

    it("rejects a clip with missing slug", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "note",
        clippedAt: new Date(),
        tags: [],
      });
      assert.equal(result.success, false);
    });

    it("rejects a clip with empty slug", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "note",
        slug: "  ",
        clippedAt: new Date(),
        tags: [],
      });
      assert.equal(result.success, false);
    });

    it("rejects a clip with empty tag strings", () => {
      const result = clipFrontmatterSchema.safeParse({
        kind: "note",
        slug: "test",
        clippedAt: new Date(),
        tags: [""],
      });
      assert.equal(result.success, false);
    });
  });

  describe("clipKindSchema", () => {
    it("accepts all valid kinds", () => {
      for (const kind of ["link", "tweet", "image", "video", "note"] as const) {
        assert.equal(clipKindSchema.safeParse(kind).success, true);
      }
    });

    it("rejects invalid kind", () => {
      assert.equal(clipKindSchema.safeParse("invalid").success, false);
    });
  });

  describe("clipDataSchema", () => {
    it("parses valid clip data without slug", () => {
      const result = clipDataSchema.safeParse({
        kind: "note",
        clippedAt: new Date(),
        tags: [],
      });
      assert.equal(result.success, true);
    });

    it("parses a valid link data entry", () => {
      const result = clipDataSchema.safeParse({
        kind: "link",
        clippedAt: new Date(),
        tags: [],
        url: "https://example.com",
        title: "example",
      });
      assert.equal(result.success, true);
    });

    it("rejects data with unknown kind", () => {
      const result = clipDataSchema.safeParse({
        kind: "podcast",
        clippedAt: new Date(),
        tags: [],
      });
      assert.equal(result.success, false);
    });
  });
});
