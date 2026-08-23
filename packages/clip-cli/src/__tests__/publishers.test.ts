import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { GitHubApiPublisher } from "../publishers/github-api";
import { LocalGitPublisher, type GitExec } from "../publishers/local-git";
import { createPublisher } from "../publishers/index";
import type { Asset, Publisher, PublishParams, PublishResult } from "../publishers/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clip-pub-"));
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Helpers for building test params
// ---------------------------------------------------------------------------

function makeParams(overrides: Partial<PublishParams> = {}): PublishParams {
  return {
    slug: "test-slug",
    markdownContent: "---\nkind: note\nslug: test-slug\n---\n\nbody text\n",
    markdownFilename: "2026-08-19-test-slug.md",
    markdownPath: "apps/web/src/content/clips/2026-08-19-test-slug.md",
    assets: [],
    commitMessage: ":sparkles: feat[clips]: add test-slug note clip",
    dryRun: false,
    noPush: false,
    ...overrides,
  };
}

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    filename: "favicon.png",
    buffer: Buffer.from("fake-png-data"),
    path: "apps/web/public/clips/test-slug/favicon.png",
    ...overrides,
  };
}

/**
 * Creates a mock GitExec that records every call and always succeeds.
 * Returns the recorder alongside the exec function so tests can assert calls.
 */
function createMockGitExec(): { exec: GitExec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: GitExec = (args) => {
    calls.push(args);
    return { status: 0 };
  };
  return { exec, calls };
}

/**
 * Creates a real git repo in a temp dir for integration testing.
 */
async function createGitRepo(): Promise<string> {
  const dir = await createTempDir();
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
  // Initial commit so the repo is not empty
  await mkdir(path.join(dir, "apps/web/src/content/clips"), { recursive: true });
  await writeFile(path.join(dir, "apps/web/src/content/clips/.gitkeep"), "", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

// ---------------------------------------------------------------------------
// Publisher interface (VAL-REMOTE-001)
// ---------------------------------------------------------------------------

describe("Publisher interface", () => {
  it("exposes a Publisher interface with publish(params) returning PublishResult", async () => {
    // LocalGitPublisher implements Publisher — verify the contract shape
    const dir = await createTempDir();
    const publisher: Publisher = new LocalGitPublisher({ repoRoot: dir });

    const result = await publisher.publish(
      makeParams({ dryRun: true, markdownPath: "apps/web/src/content/clips/x.md" }),
    );

    assert.equal(result.mode, "local");
    assert.equal(typeof result.committed, "boolean");
    assert.equal(typeof result.pushed, "boolean");
    assert.equal(typeof result.location, "string");
  });

  it("PublishResult has mode, committed, pushed, and location fields", () => {
    const result: PublishResult = {
      mode: "local",
      committed: true,
      pushed: true,
      location: "/some/path",
    };
    assert.equal(result.mode, "local");
    assert.equal(result.committed, true);
    assert.equal(result.pushed, true);
    assert.equal(result.location, "/some/path");
  });

  it("PublishParams includes slug, markdownContent, assets, commitMessage, dryRun, noPush", () => {
    const params: PublishParams = makeParams();
    assert.equal(params.slug, "test-slug");
    assert.ok(params.markdownContent.length > 0);
    assert.ok(Array.isArray(params.assets));
    assert.ok(params.commitMessage.length > 0);
    assert.equal(params.dryRun, false);
    assert.equal(params.noPush, false);
  });
});

// ---------------------------------------------------------------------------
// LocalGitPublisher (VAL-REMOTE-002, VAL-LOCAL-001 through VAL-LOCAL-005)
// ---------------------------------------------------------------------------

describe("LocalGitPublisher", () => {
  describe("file writes", () => {
    it("writes markdown to disk at the repo-relative path (VAL-LOCAL-001)", async () => {
      const dir = await createTempDir();
      const { exec } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      const params = makeParams({
        markdownPath: "apps/web/src/content/clips/2026-08-19-test.md",
        markdownContent: "---\nkind: note\n---\n\nhello\n",
      });

      await publisher.publish(params);

      const written = await readFile(
        path.join(dir, "apps/web/src/content/clips/2026-08-19-test.md"),
        "utf8",
      );
      assert.equal(written, "---\nkind: note\n---\n\nhello\n");
    });

    it("writes assets to disk at their repo-relative paths (VAL-LOCAL-001)", async () => {
      const dir = await createTempDir();
      const { exec } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      const asset = makeAsset({
        buffer: Buffer.from("binary-data"),
        path: "apps/web/public/clips/test-slug/favicon.png",
      });

      await publisher.publish(makeParams({ assets: [asset] }));

      const written = await readFile(path.join(dir, "apps/web/public/clips/test-slug/favicon.png"));
      assert.deepEqual(written, Buffer.from("binary-data"));
    });

    it("creates nested directories for assets", async () => {
      const dir = await createTempDir();
      const { exec } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      const asset = makeAsset({
        path: "apps/web/public/clips/deep/nested/slug/image.jpg",
        buffer: Buffer.from("img"),
      });

      await publisher.publish(makeParams({ assets: [asset] }));

      const st = await stat(path.join(dir, "apps/web/public/clips/deep/nested/slug/image.jpg"));
      assert.ok(st.isFile());
    });
  });

  describe("git operations", () => {
    it("stages markdown and asset paths with git add (VAL-LOCAL-002)", async () => {
      const dir = await createTempDir();
      const { exec, calls } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      const asset = makeAsset({ path: "apps/web/public/clips/slug/img.png" });
      await publisher.publish(
        makeParams({
          markdownPath: "apps/web/src/content/clips/x.md",
          assets: [asset],
        }),
      );

      const addCall = calls.find((c) => c[0] === "add");
      assert.ok(addCall, "git add was called");
      assert.ok(addCall!.includes("apps/web/src/content/clips/x.md"));
      assert.ok(addCall!.includes("apps/web/public/clips/slug/img.png"));
    });

    it("commits with the supplied message (VAL-LOCAL-002)", async () => {
      const dir = await createTempDir();
      const { exec, calls } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      await publisher.publish(
        makeParams({ commitMessage: ":sparkles: feat[clips]: add test clip" }),
      );

      const commitCall = calls.find((c) => c[0] === "commit");
      assert.ok(commitCall, "git commit was called");
      assert.ok(commitCall!.includes("-m"));
      assert.ok(commitCall!.includes(":sparkles: feat[clips]: add test clip"));
    });

    it("pushes when noPush is false (VAL-LOCAL-003)", async () => {
      const dir = await createTempDir();
      const { exec, calls } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      await publisher.publish(makeParams({ noPush: false }));

      const pushCall = calls.find((c) => c[0] === "push");
      assert.ok(pushCall, "git push was called");
    });

    it("pushes with -u origin HEAD when no upstream is configured", async () => {
      const dir = await createTempDir();
      const calls: string[][] = [];
      const exec: GitExec = (args) => {
        calls.push(args);
        if (args[0] === "rev-parse" && args.some((a) => a.includes("@{u}"))) {
          return { status: 1 }; // no upstream configured
        }
        return { status: 0 };
      };
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      await publisher.publish(makeParams({ noPush: false }));

      const pushCall = calls.find((c) => c[0] === "push");
      assert.ok(pushCall);
      assert.ok(pushCall!.includes("-u"));
      assert.ok(pushCall!.includes("origin"));
      assert.ok(pushCall!.includes("HEAD"));
    });

    it("pushes without -u when upstream is configured", async () => {
      const dir = await createTempDir();
      const calls: string[][] = [];
      const exec: GitExec = (args) => {
        calls.push(args);
        if (args[0] === "rev-parse" && args.some((a) => a.includes("@{u}"))) {
          return { status: 0 }; // upstream exists
        }
        return { status: 0 };
      };
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      await publisher.publish(makeParams({ noPush: false }));

      const pushCall = calls.find((c) => c[0] === "push");
      assert.ok(pushCall);
      assert.equal(pushCall!.length, 1); // just "push", no -u origin HEAD
    });

    it("does not push when noPush is true (VAL-LOCAL-004)", async () => {
      const dir = await createTempDir();
      const { exec, calls } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      const result = await publisher.publish(makeParams({ noPush: true }));

      const pushCall = calls.find((c) => c[0] === "push");
      assert.equal(pushCall, undefined, "git push was NOT called");
      assert.equal(result.pushed, false);
    });

    it("still commits when noPush is true", async () => {
      const dir = await createTempDir();
      const { exec, calls } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      await publisher.publish(makeParams({ noPush: true }));

      const commitCall = calls.find((c) => c[0] === "commit");
      assert.ok(commitCall, "git commit was still called");
    });
  });

  describe("dry run", () => {
    it("skips all file writes on dry run (VAL-LOCAL-005)", async () => {
      const dir = await createTempDir();
      const { exec, calls } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      const asset = makeAsset();
      await publisher.publish(makeParams({ dryRun: true, assets: [asset] }));

      // No files written
      await assert.rejects(() =>
        stat(path.join(dir, "apps/web/src/content/clips/2026-08-19-test-slug.md")),
      );
      await assert.rejects(() => stat(path.join(dir, asset.path)));

      // No git ops
      assert.equal(calls.length, 0, "no git commands were called");
    });

    it("returns committed=false and pushed=false on dry run", async () => {
      const dir = await createTempDir();
      const { exec } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      const result = await publisher.publish(makeParams({ dryRun: true }));

      assert.equal(result.committed, false);
      assert.equal(result.pushed, false);
    });

    it("returns the would-be location on dry run", async () => {
      const dir = await createTempDir();
      const { exec } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      const result = await publisher.publish(makeParams({ dryRun: true }));

      assert.equal(
        result.location,
        path.join(dir, "apps/web/src/content/clips/2026-08-19-test-slug.md"),
      );
    });
  });

  describe("result", () => {
    it("returns mode: local, committed: true, pushed: true, location: full path", async () => {
      const dir = await createTempDir();
      const { exec } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      const result = await publisher.publish(makeParams({ noPush: false }));

      assert.equal(result.mode, "local");
      assert.equal(result.committed, true);
      assert.equal(result.pushed, true);
      assert.equal(
        result.location,
        path.join(dir, "apps/web/src/content/clips/2026-08-19-test-slug.md"),
      );
    });

    it("returns pushed: false when noPush is true", async () => {
      const dir = await createTempDir();
      const { exec } = createMockGitExec();
      const publisher = new LocalGitPublisher({ repoRoot: dir, gitExec: exec });

      const result = await publisher.publish(makeParams({ noPush: true }));

      assert.equal(result.committed, true);
      assert.equal(result.pushed, false);
    });
  });

  describe("integration with real git", () => {
    it("writes files, stages, and commits in a real git repo", async () => {
      const dir = await createGitRepo();
      const publisher = new LocalGitPublisher({ repoRoot: dir });

      const asset = makeAsset({
        buffer: Buffer.from("real-asset"),
        path: "apps/web/public/clips/test-slug/favicon.png",
      });

      const result = await publisher.publish(
        makeParams({
          noPush: true, // no remote configured
          assets: [asset],
        }),
      );

      // Files written
      const md = await readFile(
        path.join(dir, "apps/web/src/content/clips/2026-08-19-test-slug.md"),
        "utf8",
      );
      assert.ok(md.includes("kind: note"));

      const assetContent = await readFile(
        path.join(dir, "apps/web/public/clips/test-slug/favicon.png"),
      );
      assert.deepEqual(assetContent, Buffer.from("real-asset"));

      // Commit created
      const log = execFileSync("git", ["log", "--oneline", "-1"], {
        cwd: dir,
        encoding: "utf8",
      }).trim();
      assert.ok(log.includes("feat[clips]"), `commit message preserved: ${log}`);

      // Result
      assert.equal(result.mode, "local");
      assert.equal(result.committed, true);
      assert.equal(result.pushed, false);
    });
  });
});

// ---------------------------------------------------------------------------
// Publisher factory (VAL-REMOTE-004)
// ---------------------------------------------------------------------------

describe("createPublisher factory", () => {
  it("returns LocalGitPublisher when no token (VAL-REMOTE-004, VAL-LOCAL-005)", () => {
    const publisher = createPublisher({
      repoRoot: "/tmp/fake",
      local: false,
      token: null,
    });
    assert.ok(publisher instanceof LocalGitPublisher);
  });

  it("returns LocalGitPublisher when --local flag is set even with a token (VAL-REMOTE-004)", () => {
    const publisher = createPublisher({
      repoRoot: "/tmp/fake",
      local: true,
      token: "ghp_testtoken",
    });
    assert.ok(publisher instanceof LocalGitPublisher);
  });

  it("returns LocalGitPublisher when --local flag and no token", () => {
    const publisher = createPublisher({
      repoRoot: "/tmp/fake",
      local: true,
      token: null,
    });
    assert.ok(publisher instanceof LocalGitPublisher);
  });

  it("returns GitHubApiPublisher when token and github config are provided", () => {
    const publisher = createPublisher({
      repoRoot: "/tmp/fake",
      local: false,
      token: "ghp_testtoken",
      github: { owner: "owner", repo: "repo", branch: "main" },
    });
    assert.ok(publisher instanceof GitHubApiPublisher);
  });

  it("throws when token is present but github config is missing", () => {
    assert.throws(
      () =>
        createPublisher({
          repoRoot: "/tmp/fake",
          local: false,
          token: "ghp_testtoken",
        }),
      /GitHub configuration/i,
    );
  });

  it("throws a helpful error when github.repo is empty (VAL-REMOTE-031)", () => {
    assert.throws(
      () =>
        createPublisher({
          repoRoot: "/tmp/fake",
          local: false,
          token: "ghp_testtoken",
          github: { owner: "owner", repo: "", branch: "main" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("No repository configured"));
        assert.ok(err.message.includes("clip init"));
        assert.ok(err.message.includes("clip config set github.repo"));
        return true;
      },
    );
  });

  it("returned publisher can be used as the Publisher interface", async () => {
    const dir = await createTempDir();
    const publisher: Publisher = createPublisher({
      repoRoot: dir,
      local: false,
      token: null,
    });

    const result = await publisher.publish(makeParams({ dryRun: true }));
    assert.equal(result.mode, "local");
  });
});
