import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSiteServer } from "./serve-site.mjs";
import { getCommitSha } from "./build-site.mjs";

const server = createSiteServer();
let origin;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test("serves landing and local assets without runtime dependencies", async () => {
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Good finds\.<br\s*\/>Kept close\./);
  assert.doesNotMatch(html, /commit:start/);
  const sha = getCommitSha();
  if (sha) assert.ok(html.includes(`href="https://github.com/iamrajjoshi/cliplink/commit/${sha}"`));
  for (const match of html.matchAll(/(?:href|src)="\.\/([^"#]+)"/g)) {
    const response = await fetch(`${origin}/${match[1]}`);
    assert.equal(response.status, 200, match[1]);
  }
});
test("restricts files to site directory", async () => {
  assert.equal((await fetch(`${origin}/%2e%2e%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${origin}/missing.html`)).status, 404);
  assert.equal((await fetch(`${origin}/%E0%A4%A`)).status, 404);
});
test("supports HEAD, rejects writes, and sets asset content types", async () => {
  const head = await fetch(origin, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await fetch(origin, { method: "POST" })).status, 405);
  assert.match((await fetch(`${origin}/styles.css`)).headers.get("content-type"), /text\/css/);
});
