import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublished, prepareRelease } from "./prepare-release.mjs";

const cli = { name: "cliplink", version: "0.2.0" };
const schema = { name: "cliplink-schema", version: "0.1.1" };

test("checks the exact version and skips a previously published schema", async () => {
  const requested = [];
  const plan = await prepareRelease({ cli, schema, tag: "v0.2.0" }, async (url) => {
    requested.push(url);
    return url.endsWith("/cliplink-schema/0.1.1")
      ? Response.json(schema)
      : new Response(null, { status: 404 });
  });

  assert.deepEqual(requested, [
    "https://registry.npmjs.org/cliplink-schema/0.1.1",
    "https://registry.npmjs.org/cliplink/0.2.0",
  ]);
  assert.deepEqual(plan, { schemaPublish: false, cliPublish: true });
});

test("skips both packages when retrying an already completed release", async () => {
  const plan = await prepareRelease({ cli, schema, tag: "v0.2.0" }, async (url) =>
    Response.json(url.includes("cliplink-schema") ? schema : cli),
  );
  assert.deepEqual(plan, { schemaPublish: false, cliPublish: false });
});

test("publishes missing versions when the registry returns 404", async () => {
  const plan = await prepareRelease(
    { cli, schema, tag: "v0.2.0" },
    async () => new Response(null, { status: 404 }),
  );
  assert.deepEqual(plan, { schemaPublish: true, cliPublish: true });
});

test("rejects missing or mismatched tags before checking the registry", async () => {
  for (const tag of [undefined, "", "v0.1.1", "0.2.0", "v0.2.0-rc.1"]) {
    await assert.rejects(
      prepareRelease({ cli, schema, tag }, () => assert.fail("Registry must not be queried")),
      /Release tag must be v0\.2\.0/,
    );
  }
});

test("does not treat registry, authentication, or rate limit errors as unpublished", async () => {
  for (const status of [400, 401, 403, 408, 429, 500, 502, 503]) {
    await assert.rejects(
      isPublished(schema, async () => new Response(null, { status })),
      new RegExp(`npm registry returned HTTP ${status}`),
    );
  }
});

test("rejects network failures", async () => {
  await assert.rejects(
    prepareRelease({ cli, schema, tag: "v0.2.0" }, async () => {
      throw new Error("Network unavailable");
    }),
    /Network unavailable/,
  );
});

test("rejects malformed or mismatched registry metadata", async () => {
  for (const metadata of [{}, { ...schema, version: "0.1.0" }, { ...schema, name: "other" }]) {
    await assert.rejects(
      isPublished(schema, async () => Response.json(metadata)),
      /unexpected package metadata/,
    );
  }
  await assert.rejects(
    isPublished(schema, async () => new Response("invalid JSON")),
    SyntaxError,
  );
});
