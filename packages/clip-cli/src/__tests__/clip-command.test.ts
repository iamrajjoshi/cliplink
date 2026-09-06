import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { runClipCommand, type ClipCommandDeps } from "../commands/clip";
import type { PublisherFactoryOptions, PublishParams } from "../publishers";

async function fixture(t: TestContext) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "clip-command-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {});
  await writeFile(
    path.join(cwd, "example.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" /></svg>',
  );

  const factoryCalls: PublisherFactoryOptions[] = [];
  const publishCalls: PublishParams[] = [];
  let tokenReads = 0;
  const deps: ClipCommandDeps = {
    cwd,
    keychain: {
      read: async () => {
        tokenReads += 1;
        return "test-token";
      },
    },
    configStore: {
      read: async () => ({
        mode: "remote",
        github: { owner: "example", repo: "clip", branch: "main" },
      }),
    },
    createPublisherFn: (options) => {
      factoryCalls.push(options);
      return {
        publish: async (params) => {
          publishCalls.push(params);
          return {
            mode: options.local || !options.token ? "local" : "remote",
            committed: true,
            pushed: !params.noPush,
            location: "test-commit",
          };
        },
      };
    },
  };

  return { cwd, deps, factoryCalls, publishCalls, tokenReads: () => tokenReads };
}

describe("clip command workspace selection", () => {
  it("publishes remotely without a checkout or local content writes", async (t) => {
    const { cwd, deps, factoryCalls, publishCalls, tokenReads } = await fixture(t);

    await runClipCommand(["example.svg"], deps);

    assert.equal(factoryCalls.length, 1);
    assert.equal(factoryCalls[0]?.repoRoot, cwd);
    assert.deepEqual(factoryCalls[0]?.github, {
      owner: "example",
      repo: "clip",
      branch: "main",
    });
    assert.equal(tokenReads(), 1, "use the same authentication state through publishing");
    const clip = publishCalls[0];
    assert.ok(clip);
    assert.match(
      clip.markdownPath,
      /^apps\/web\/src\/content\/clips\/\d{4}-\d{2}-\d{2}-example\.md$/,
    );
    assert.match(clip.markdownContent, /src: \/clips\/example\/example\.svg/);
    assert.equal(clip.assets[0]?.path, "apps/web/public/clips/example/example.svg");
    assert.ok(clip.assets[0]?.buffer.length);
    assert.deepEqual(await readdir(cwd), ["example.svg"]);
  });

  it("previews remotely without a checkout, publisher, or file writes", async (t) => {
    const { cwd, deps, factoryCalls, publishCalls } = await fixture(t);

    await runClipCommand(["example.svg", "--dry-run"], deps);

    assert.equal(factoryCalls.length, 0);
    assert.equal(publishCalls.length, 0);
    assert.deepEqual(await readdir(cwd), ["example.svg"]);
  });

  for (const loggedIn of [true, false]) {
    it(`requires a checkout in local mode when ${loggedIn ? "logged in" : "logged out"}`, async (t) => {
      const { cwd, deps, factoryCalls } = await fixture(t);
      if (!loggedIn) deps.keychain = { read: async () => null };
      const args = ["example.svg", "--repo", cwd];
      if (loggedIn) args.push("--local");

      await assert.rejects(runClipCommand(args, deps), /Could not find the clip workspace root/);

      assert.equal(factoryCalls.length, 0);
    });

    it(`preserves local paths and --no-push when ${loggedIn ? "logged in" : "logged out"}`, async (t) => {
      const { cwd, deps, factoryCalls, publishCalls } = await fixture(t);
      await mkdir(path.join(cwd, ".git"));
      await writeFile(path.join(cwd, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
      if (!loggedIn) deps.keychain = { read: async () => null };
      const args = ["example.svg", "--repo", cwd, "--no-push"];
      if (loggedIn) args.push("--local");

      await runClipCommand(args, deps);

      assert.equal(factoryCalls[0]?.repoRoot, cwd);
      assert.equal(factoryCalls[0]?.github, undefined);
      assert.equal(publishCalls[0]?.noPush, true);
      assert.equal(publishCalls[0]?.assets[0]?.path, "apps/web/public/clips/example/example.svg");
    });
  }
});
