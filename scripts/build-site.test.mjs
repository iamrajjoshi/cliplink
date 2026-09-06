import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getCommitSha, stampCommit } from "./build-site.mjs";

const placeholder =
  '<footer><!-- commit:start --><a href="#">Source</a><!-- commit:end --></footer>';

test("uses the CI commit for a full permalink and a short label", () => {
  const sha = "A".repeat(40);
  const html = stampCommit(placeholder, getCommitSha("/not-a-checkout", sha));
  assert.match(
    html,
    new RegExp(`href="https://github.com/iamrajjoshi/cliplink/commit/${sha.toLowerCase()}"`),
  );
  assert.match(html, />aaaaaaa<\/a>/);
  assert.match(html, /aria-label="View commit aaaaaaa on GitHub"/);
  assert.doesNotMatch(html, /commit:start/);
});

test("reads the local checkout HEAD when no valid CI commit is available", async (t) => {
  const cwd = await mkdtemp(join(os.tmpdir(), "cliplink-site-git-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  git("init", "--quiet");
  git(
    "-c",
    "user.name=Site test",
    "-c",
    "user.email=site@example.com",
    "commit",
    "--allow-empty",
    "--quiet",
    "-m",
    "Test commit",
  );
  const expected = git("rev-parse", "HEAD");
  assert.equal(getCommitSha(cwd, ""), expected);
  assert.equal(getCommitSha(cwd, 'not-a-sha"'), expected);
});

test("keeps a safe source link when no commit can be resolved", async (t) => {
  const cwd = await mkdtemp(join(os.tmpdir(), "cliplink-site-source-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  assert.equal(getCommitSha(cwd, ""), null);
  const html = stampCommit(placeholder, '<script>alert("no")</script>');
  assert.match(html, /href="https:\/\/github.com\/iamrajjoshi\/cliplink"/);
  assert.match(html, />Source<\/a>/);
  assert.doesNotMatch(html, /<script>|\/commit\//);
});
