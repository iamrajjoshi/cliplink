import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { parse } from "yaml";
import { runClipCommand, type ClipCommandDeps } from "../commands/clip";
import type { PublishParams } from "../publishers";
import { clipFrontmatterSchema } from "../schema";

const linkUrl = "https://github.com/example/project";
const videoUrl = "https://youtu.be/example";
const tweetUrl = "https://x.com/example/status/123456789";
const imageSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" /></svg>';
const kinds = [
  { kind: "link", input: linkUrl },
  { kind: "video", input: videoUrl },
  { kind: "tweet", input: tweetUrl },
  { kind: "image", input: "example.svg" },
  { kind: "note", input: "-" },
] as const;

function replaceProperty(
  t: TestContext,
  object: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
) {
  const previous = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, { configurable: true, ...descriptor });
  t.after(() => {
    if (previous) Object.defineProperty(object, key, previous);
    else Reflect.deleteProperty(object, key);
  });
}

async function fixture(
  t: TestContext,
  stdinText = "  Original stdin heading\n\nOriginal body.  \n",
) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "clip-metadata-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {});
  replaceProperty(t, process.stdin, "isTTY", { value: false });
  replaceProperty(t, process.stdout, "isTTY", { value: false });
  t.mock.method(process.stdin, Symbol.asyncIterator, async function* () {
    yield Buffer.from(stdinText);
  });
  await writeFile(path.join(cwd, "example.svg"), imageSvg);

  const fetchCalls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetchCalls.push(url);
    if (url.startsWith("https://www.youtube.com/oembed?")) {
      return Response.json({
        title: "Scraped video title",
        author_name: "Example channel",
        thumbnail_url: "https://assets.example/thumbnail.jpg",
      });
    }
    if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result?")) {
      return Response.json({
        id_str: "123456789",
        text: "Original tweet text",
        created_at: "2026-04-19T00:00:00.000Z",
        user: {
          name: "Example Author",
          screen_name: "example",
          profile_image_url_https: "https://assets.example/avatar.jpg",
        },
        mediaDetails: [
          { media_url_https: "https://assets.example/photo.jpg", ext_alt_text: "Scraped photo" },
        ],
      });
    }
    if (url === linkUrl || url === "https://example.com/article") {
      return new Response(
        '<html><head><meta property="og:title" content="Scraped article title">' +
          '<meta property="og:description" content="Scraped article description">' +
          '<meta property="og:site_name" content="Example site">' +
          '<meta property="og:image" content="https://assets.example/preview.png">' +
          '<link rel="icon" href="https://assets.example/favicon.ico"></head></html>',
        { headers: { "content-type": "text/html" } },
      );
    }
    if (url.startsWith("https://assets.example/")) {
      return new Response("image bytes", { headers: { "content-type": "image/png" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const publishCalls: PublishParams[] = [];
  let publisherCreations = 0;
  const deps: ClipCommandDeps = {
    cwd,
    keychain: { read: async () => "test-token" },
    configStore: {
      read: async () => ({
        mode: "remote",
        github: { owner: "example", repo: "clip", branch: "main" },
      }),
    },
    createPublisherFn: () => {
      publisherCreations += 1;
      return {
        publish: async (params) => {
          publishCalls.push(params);
          return { mode: "remote", committed: true, pushed: true, location: "test-commit" };
        },
      };
    },
  };

  function published() {
    assert.equal(publishCalls.length, 1);
    const params = publishCalls[0]!;
    const sections = params.markdownContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    assert.ok(sections, "publish valid Markdown frontmatter and body");
    const frontmatter = clipFrontmatterSchema.parse(parse(sections[1]!));
    assert.equal(params.slug, frontmatter.slug);
    assert.equal(
      params.markdownFilename,
      `${frontmatter.clippedAt.toISOString().slice(0, 10)}-${params.slug}.md`,
    );
    assert.equal(params.markdownPath, `apps/web/src/content/clips/${params.markdownFilename}`);
    return { params, frontmatter, body: sections[2]!.trim() };
  }

  return {
    cwd,
    deps,
    fetchCalls,
    publishCalls,
    published,
    publisherCreations: () => publisherCreations,
  };
}

describe("clip metadata defaults", () => {
  for (const { kind, input } of kinds) {
    it(`preserves scraped and generated ${kind} metadata without flags`, async (t) => {
      const { cwd, deps, published } = await fixture(t);

      await runClipCommand([input], deps);

      const { frontmatter, params, body } = published();
      assert.equal(frontmatter.kind, kind);
      assert.deepEqual(frontmatter.tags, kind === "link" ? ["github"] : []);
      assert.equal(body, kind === "note" ? "Original stdin heading\n\nOriginal body." : "");
      switch (frontmatter.kind) {
        case "link":
          assert.equal(frontmatter.title, "Scraped article title");
          assert.equal(frontmatter.description, "Scraped article description");
          assert.equal(frontmatter.siteName, "Example site");
          assert.equal(frontmatter.slug, "scraped-article-title");
          assert.equal(params.assets.length, 2);
          break;
        case "video":
          assert.equal(frontmatter.title, "Scraped video title");
          assert.equal(frontmatter.channel, "Example channel");
          assert.equal(frontmatter.provider, "youtube");
          assert.equal(frontmatter.slug, "scraped-video-title");
          assert.equal(params.assets.length, 1);
          break;
        case "tweet":
          assert.equal(frontmatter.text, "Original tweet text");
          assert.equal(frontmatter.author.name, "Example Author");
          assert.equal(frontmatter.author.handle, "example");
          assert.equal(frontmatter.media?.[0]?.alt, "Scraped photo");
          assert.equal(params.assets.length, 2);
          break;
        case "image":
          assert.equal(frontmatter.alt, "example");
          assert.equal(frontmatter.width, 24);
          assert.equal(frontmatter.height, 16);
          assert.equal(frontmatter.src, "/clips/example/example.svg");
          assert.equal(params.assets.length, 1);
          break;
        case "note":
          assert.equal(frontmatter.slug, "original-stdin-heading");
          assert.equal(params.assets.length, 0);
          break;
      }
      assert.deepEqual(
        await readdir(cwd),
        ["example.svg"],
        "remote mode needs no checkout or writes",
      );
    });
  }
});

describe("clip metadata overrides", () => {
  for (const { kind, input } of kinds) {
    it(`merges repeatable tags in order for ${kind}, retaining case and literal --tag commas`, async (t) => {
      const { deps, published } = await fixture(t);

      await runClipCommand(
        [
          "--tag",
          " Focus ",
          input,
          "--tags=github,Focus,Learn",
          "--tag=Comma, literal",
          "--tags",
          " Learn,focus,GitHub ",
          "--tag",
          "github",
        ],
        deps,
      );

      assert.deepEqual(
        published().frontmatter.tags,
        kind === "link"
          ? ["github", "Focus", "Learn", "Comma, literal", "focus", "GitHub"]
          : ["Focus", "github", "Learn", "Comma, literal", "focus", "GitHub"],
      );
    });
  }

  it("does not add the GitHub default tag to other link hosts", async (t) => {
    const { deps, published } = await fixture(t);
    await runClipCommand(["https://example.com/article", "--tags=reading,code"], deps);
    assert.deepEqual(published().frontmatter.tags, ["reading", "code"]);
  });

  for (const input of [linkUrl, videoUrl]) {
    it(`uses the last title override for content, unique slug, and asset paths: ${input}`, async (t) => {
      const { cwd, deps, published } = await fixture(t);
      const contentDir = path.join(cwd, "apps/web/src/content/clips");
      await mkdir(contentDir, { recursive: true });
      await writeFile(path.join(contentDir, "2026-01-01-my-chosen-title.md"), "existing clip");
      await writeFile(path.join(contentDir, "2026-01-02-my-chosen-title-2.md"), "another clip");

      await runClipCommand(
        [input, "--title", "Earlier title", "--title=  My chosen title  "],
        deps,
      );

      const { frontmatter, params } = published();
      assert.ok(frontmatter.kind === "link" || frontmatter.kind === "video");
      assert.equal(frontmatter.title, "My chosen title");
      assert.equal(frontmatter.slug, "my-chosen-title-3");
      assert.ok(params.assets.length > 0);
      for (const asset of params.assets) {
        assert.ok(asset.path.startsWith("apps/web/public/clips/my-chosen-title-3/"));
      }
      if (frontmatter.kind === "link") {
        assert.equal(frontmatter.description, "Scraped article description");
        assert.equal(frontmatter.favicon, "/clips/my-chosen-title-3/favicon.ico");
        assert.equal(frontmatter.ogImage, "/clips/my-chosen-title-3/og-image.png");
      } else {
        assert.equal(frontmatter.channel, "Example channel");
        assert.equal(frontmatter.thumbnail, "/clips/my-chosen-title-3/thumbnail.jpg");
      }
    });
  }

  it("uses the last description and preserves punctuation through YAML serialization", async (t) => {
    const { deps, published } = await fixture(t);
    await runClipCommand(
      [
        linkUrl,
        "--description=Earlier",
        "--description",
        '  Summary: "quoted" = value\nSecond line.  ',
      ],
      deps,
    );
    const { frontmatter } = published();
    assert.equal(frontmatter.kind, "link");
    if (frontmatter.kind !== "link") assert.fail("Expected link clip");
    assert.equal(frontmatter.description, 'Summary: "quoted" = value\nSecond line.');
    assert.equal(frontmatter.title, "Scraped article title");
    assert.equal(frontmatter.slug, "scraped-article-title");
  });

  it("uses the last image alt override without changing the asset or slug", async (t) => {
    const { deps, published } = await fixture(t);
    await runClipCommand(
      ["example.svg", "--alt=Earlier alt", "--alt", "  A small rectangle  "],
      deps,
    );
    const { frontmatter, params } = published();
    assert.equal(frontmatter.kind, "image");
    if (frontmatter.kind !== "image") assert.fail("Expected image clip");
    assert.equal(frontmatter.alt, "A small rectangle");
    assert.equal(frontmatter.slug, "example");
    assert.equal(frontmatter.src, "/clips/example/example.svg");
    assert.equal(params.assets[0]?.buffer.toString(), imageSvg);
  });

  it("allows literal flag-like text and equals signs through --flag=value", async (t) => {
    const { deps, published } = await fixture(t);
    await runClipCommand(
      [linkUrl, "--title=--tag=value", "--tag=--literal", "--note=--note=value"],
      deps,
    );
    const { frontmatter, body } = published();
    assert.ok(frontmatter.kind === "link");
    assert.equal(frontmatter.title, "--tag=value");
    assert.deepEqual(frontmatter.tags, ["github", "--literal"]);
    assert.equal(body, "--note=value");
  });

  it("honors the option delimiter for a filename beginning with --tag", async (t) => {
    const { cwd, deps, published } = await fixture(t);
    await writeFile(path.join(cwd, "--tag.svg"), imageSvg);
    await runClipCommand(["--tag", "art", "--", "--tag.svg"], deps);
    const { frontmatter } = published();
    assert.equal(frontmatter.kind, "image");
    assert.equal(frontmatter.slug, "tag");
    assert.deepEqual(frontmatter.tags, ["art"]);
  });
});

describe("clip note metadata", () => {
  for (const { kind, input } of kinds) {
    for (const syntax of ["equals", "separate"] as const) {
      it(`uses a trimmed ${syntax} note for ${kind} without interactive TTY or editor checks`, async (t) => {
        const { deps, published } = await fixture(t);
        Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
        Object.defineProperty(process.stdout, "isTTY", {
          configurable: true,
          get() {
            assert.fail("An explicit --note must bypass interactive prompt and editor checks");
          },
        });
        const note = "  Added heading\n\n**Markdown** note.  \n";

        await runClipCommand(
          [input, ...(syntax === "equals" ? [`--note=${note}`] : ["--note", note])],
          deps,
        );

        const { body, frontmatter } = published();
        assert.equal(
          body,
          kind === "note"
            ? "Original stdin heading\n\nOriginal body.\n\nAdded heading\n\n**Markdown** note."
            : "Added heading\n\n**Markdown** note.",
        );
        if (kind === "note") assert.equal(frontmatter.slug, "original-stdin-heading");
      });
    }
  }

  for (const stdinText of ["", " \n\t "]) {
    it(`uses the supplied note for the slug with ${stdinText ? "whitespace" : "empty"} stdin`, async (t) => {
      const { deps, published } = await fixture(t, stdinText);
      await runClipCommand(["-", "--note", "  A new note\n\nBody.  "], deps);
      assert.equal(published().frontmatter.slug, "a-new-note");
      assert.equal(published().body, "A new note\n\nBody.");
    });
  }

  it("uses only the last note flag while retaining the complete stdin body", async (t) => {
    const { deps, published } = await fixture(t);
    await runClipCommand(["-", "--note=Discarded note", "--note", " Final note "], deps);
    assert.equal(published().body, "Original stdin heading\n\nOriginal body.\n\nFinal note");
  });
});

describe("clip metadata validation", () => {
  const allowedKinds = {
    "--title": ["link", "video"],
    "--description": ["link"],
    "--alt": ["image"],
  };
  for (const [flag, allowed] of Object.entries(allowedKinds)) {
    for (const { kind, input } of kinds) {
      if (allowed.includes(kind)) continue;
      it(`rejects ${flag} for ${kind} before scraping or publishing`, async (t) => {
        const { deps, fetchCalls, publishCalls, publisherCreations } = await fixture(t);

        await assert.rejects(
          runClipCommand([input, flag, "Override"], deps),
          new RegExp(`${flag}.*only supported.*received ${kind}`),
        );

        assert.deepEqual(fetchCalls, []);
        assert.deepEqual(publishCalls, []);
        assert.equal(publisherCreations(), 0);
      });
    }
  }

  for (const flag of ["--tag", "--tags", "--title", "--description", "--alt", "--note"]) {
    for (const value of [undefined, "", "  \t  "]) {
      for (const syntax of value === undefined ? ["separate"] : ["separate", "equals"]) {
        it(`rejects ${flag} with ${value === undefined ? "missing" : value ? "whitespace" : "empty"} ${syntax} value`, async (t) => {
          const { deps, fetchCalls, publishCalls } = await fixture(t);
          const flagArgs =
            value === undefined
              ? [flag]
              : syntax === "equals"
                ? [`${flag}=${value}`]
                : [flag, value];
          await assert.rejects(
            runClipCommand([linkUrl, ...flagArgs], deps),
            new RegExp(`${value === undefined ? "Missing" : "Empty"} value for ${flag}`),
          );
          assert.deepEqual(fetchCalls, []);
          assert.deepEqual(publishCalls, []);
        });
      }
    }

    it(`does not consume another option as the value for ${flag}`, async (t) => {
      const { deps, fetchCalls, publishCalls } = await fixture(t);
      for (const next of ["--dry-run", "--", "-h"]) {
        await assert.rejects(
          runClipCommand([linkUrl, flag, next], deps),
          new RegExp(`Missing value for ${flag}`),
        );
      }
      assert.deepEqual(fetchCalls, []);
      assert.deepEqual(publishCalls, []);
    });
  }

  for (const value of [",reading", "reading,", "reading,,code", "reading, ,code", ","]) {
    it(`rejects empty comma-separated tags: ${JSON.stringify(value)}`, async (t) => {
      const { deps, fetchCalls, publishCalls } = await fixture(t);
      await assert.rejects(
        runClipCommand([linkUrl, `--tags=${value}`], deps),
        /Empty tag in --tags/,
      );
      assert.deepEqual(fetchCalls, []);
      assert.deepEqual(publishCalls, []);
    });
  }

  for (const args of [
    [linkUrl, "--unknown=value"],
    [linkUrl, "--dry-run=true"],
    [linkUrl, "second-input.svg"],
    ["--", "example.svg", "--tag", "art"],
  ]) {
    it(`rejects malformed arguments without side effects: ${args.join(" ")}`, async (t) => {
      const { deps, fetchCalls, publishCalls } = await fixture(t);
      await assert.rejects(runClipCommand(args, deps), /Unknown flag|Only a single input value/);
      assert.deepEqual(fetchCalls, []);
      assert.deepEqual(publishCalls, []);
    });
  }
});
