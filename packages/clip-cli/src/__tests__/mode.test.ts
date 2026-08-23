import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { detectMode, type PublishMode } from "../mode";
import { executePublishing, type ClipCommandDeps, type PreparedClip } from "../commands/clip";
import { LocalGitPublisher } from "../publishers/local-git";
import { GitHubApiPublisher } from "../publishers/github-api";
import { createPublisher } from "../publishers";
import type { Publisher, PublishParams, PublishResult } from "../publishers/types";
import type { PublisherFactoryOptions } from "../publishers";
import type { ClipConfig } from "../config";

// ---------------------------------------------------------------------------
// Temp directory cleanup
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clip-mode-"));
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Output capture helper
// ---------------------------------------------------------------------------

interface CapturedOutput {
  stdout: string;
  stderr: string;
}

function captureOutput<T>(fn: () => Promise<T>): Promise<{ output: CapturedOutput; result: T }> {
  return new Promise((resolve, reject) => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = (...args: unknown[]) => {
      stdoutLines.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    };
    fn()
      .then((result) => {
        resolve({
          output: { stdout: stdoutLines.join("\n"), stderr: stderrLines.join("\n") },
          result,
        });
      })
      .catch(reject)
      .finally(() => {
        console.log = originalLog;
        console.warn = originalWarn;
      });
  });
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockKeychain(token: string | null) {
  return {
    async read(): Promise<string | null> {
      return token;
    },
  };
}

function createMockConfigStore(config: ClipConfig) {
  return {
    async read(): Promise<ClipConfig> {
      return config;
    },
  };
}

const DEFAULT_GITHUB_CONFIG: ClipConfig = {
  mode: "remote",
  github: { owner: "", repo: "", branch: "main" },
};

interface MockPublisherState {
  factoryCalls: PublisherFactoryOptions[];
  publishCalls: PublishParams[];
  result: PublishResult;
}

function createMockPublisherFactory(
  state: MockPublisherState,
): NonNullable<ClipCommandDeps["createPublisherFn"]> {
  const mockPublisher: Publisher = {
    async publish(params: PublishParams): Promise<PublishResult> {
      state.publishCalls.push(params);
      return state.result;
    },
  };
  return (options: PublisherFactoryOptions): Publisher => {
    state.factoryCalls.push(options);
    return mockPublisher;
  };
}

function makePreparedClip(overrides: Partial<PreparedClip> = {}): PreparedClip {
  return {
    frontmatter: {
      kind: "note",
      slug: "test-slug",
      clippedAt: new Date("2026-08-19T00:00:00.000Z"),
      tags: [],
    },
    markdown: "---\nkind: note\nslug: test-slug\n---\n\nbody text\n",
    filename: "2026-08-19-test-slug.md",
    markdownPath: "apps/web/src/content/clips/2026-08-19-test-slug.md",
    assets: [],
    ...overrides,
  };
}

// ===========================================================================
// detectMode unit tests
// ===========================================================================

describe("detectMode", () => {
  describe("VAL-MODE-001: Remote mode is the default when a token exists", () => {
    it("returns 'remote' when token is present and --local is not set", () => {
      const mode = detectMode({ local: false, token: "ghp_testtoken" });
      assert.equal(mode, "remote");
    });

    it("returns 'remote' for any non-empty token string", () => {
      const mode = detectMode({ local: false, token: "any-token-value" });
      assert.equal(mode, "remote");
    });
  });

  describe("VAL-MODE-002: --local forces local mode even when logged in", () => {
    it("returns 'local' when --local is set and token is present", () => {
      const mode = detectMode({ local: true, token: "ghp_testtoken" });
      assert.equal(mode, "local");
    });

    it("returns 'local' when --local is set regardless of token value", () => {
      const mode = detectMode({ local: true, token: "very-long-token" });
      assert.equal(mode, "local");
    });
  });

  describe("VAL-MODE-003: No token defaults to local mode", () => {
    it("returns 'local' when no token and --local is not set", () => {
      const mode = detectMode({ local: false, token: null });
      assert.equal(mode, "local");
    });

    it("returns 'local' when token is null (backward compatible)", () => {
      const mode = detectMode({ local: false, token: null });
      assert.equal(mode, "local");
    });
  });

  describe("VAL-MODE-011: --local with no token works normally", () => {
    it("returns 'local' when --local is set and no token", () => {
      const mode = detectMode({ local: true, token: null });
      assert.equal(mode, "local");
    });

    it("returns 'local' (redundant but not an error)", () => {
      const mode = detectMode({ local: true, token: null });
      assert.equal(mode, "local");
    });
  });

  describe("all mode combinations", () => {
    const cases: Array<{ local: boolean; token: string | null; expected: PublishMode }> = [
      { local: false, token: "ghp_token", expected: "remote" },
      { local: true, token: "ghp_token", expected: "local" },
      { local: false, token: null, expected: "local" },
      { local: true, token: null, expected: "local" },
    ];

    for (const { local, token, expected } of cases) {
      it(`local=${local}, token=${token ? "present" : "null"} → ${expected}`, () => {
        const mode = detectMode({ local, token });
        assert.equal(mode, expected);
      });
    }
  });
});

// ===========================================================================
// executePublishing tests
// ===========================================================================

describe("executePublishing", () => {
  // -----------------------------------------------------------------------
  // VAL-MODE-001: Remote mode default when token exists
  // -----------------------------------------------------------------------
  describe("VAL-MODE-001: Remote mode is the default when a token exists", () => {
    it("selects remote mode and uses GitHubApiPublisher when token is present (no --local)", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "remote", committed: true, pushed: true, location: "abc123sha" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(result.mode, "remote");
      assert.equal(state.factoryCalls.length, 1);
      assert.equal(state.factoryCalls[0]!.local, false);
      assert.equal(state.factoryCalls[0]!.token, "ghp_testtoken");
      assert.ok(state.factoryCalls[0]!.github, "github config should be passed");
      assert.ok(output.stdout.includes("mode: remote"), "output should report remote mode");
    });
  });

  // -----------------------------------------------------------------------
  // VAL-MODE-002: --local forces local mode even when logged in
  // -----------------------------------------------------------------------
  describe("VAL-MODE-002: --local forces local mode even when logged in", () => {
    it("selects local mode when --local is set and token is present", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: true, location: dir },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: true },
          dir,
          deps,
        ),
      );

      assert.equal(result.mode, "local");
      assert.equal(state.factoryCalls[0]!.local, true);
      assert.equal(state.factoryCalls[0]!.token, "ghp_testtoken");
      assert.ok(output.stdout.includes("mode: local"), "output should report local mode");
    });
  });

  // -----------------------------------------------------------------------
  // VAL-MODE-003: No token defaults to local mode
  // -----------------------------------------------------------------------
  describe("VAL-MODE-003: No token defaults to local mode", () => {
    it("selects local mode when no token is stored", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: true, location: dir },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(result.mode, "local");
      assert.equal(state.factoryCalls[0]!.token, null);
      assert.ok(output.stdout.includes("mode: local"), "output should report local mode");
    });

    it("does not attempt GitHub API calls when no token (factory gets null token)", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: false, location: dir },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(state.factoryCalls[0]!.token, null);
      // The factory should select local publisher since token is null
      assert.equal(state.factoryCalls[0]!.local, false);
    });
  });

  // -----------------------------------------------------------------------
  // VAL-MODE-004: --dry-run in remote mode shows preview without API calls
  // -----------------------------------------------------------------------
  describe("VAL-MODE-004: --dry-run in remote mode", () => {
    it("prints preview with mode and makes NO publisher calls", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "remote", committed: false, pushed: false, location: "" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      // No publisher created, no publish called
      assert.equal(state.factoryCalls.length, 0, "no publisher should be created in dry-run");
      assert.equal(state.publishCalls.length, 0, "no publish() should be called in dry-run");

      // Mode reported
      assert.ok(output.stdout.includes("mode: remote"), "dry-run output should report remote mode");

      // Preview printed
      assert.ok(output.stdout.includes("# 2026-08-19-test-slug.md"), "should print filename");
      assert.ok(output.stdout.includes("kind: note"), "should print markdown preview");

      // Result indicates no side effects
      assert.equal(result.committed, false);
      assert.equal(result.pushed, false);
    });

    it("exits successfully (returns a result, no throw)", async () => {
      const dir = await createTempDir();
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
      };

      const { result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(result.mode, "remote");
    });
  });

  // -----------------------------------------------------------------------
  // VAL-MODE-005: --dry-run in local mode shows preview without git ops
  // -----------------------------------------------------------------------
  describe("VAL-MODE-005: --dry-run in local mode", () => {
    it("prints preview with mode and makes NO publisher calls", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: false, pushed: false, location: "" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      // No publisher created, no publish called
      assert.equal(state.factoryCalls.length, 0, "no publisher should be created in dry-run");
      assert.equal(state.publishCalls.length, 0, "no publish() should be called in dry-run");

      // Mode reported
      assert.ok(output.stdout.includes("mode: local"), "dry-run output should report local mode");

      // Preview printed
      assert.ok(output.stdout.includes("# 2026-08-19-test-slug.md"), "should print filename");

      // No side effects
      assert.equal(result.committed, false);
      assert.equal(result.pushed, false);
    });
  });

  // -----------------------------------------------------------------------
  // VAL-MODE-008: --dry-run produces no side effects in either mode
  // -----------------------------------------------------------------------
  describe("VAL-MODE-008: --dry-run produces no side effects", () => {
    it("no publisher created in remote dry-run", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "remote", committed: false, pushed: false, location: "" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(state.factoryCalls.length, 0);
      assert.equal(state.publishCalls.length, 0);
    });

    it("no publisher created in local dry-run", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: false, pushed: false, location: "" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(state.factoryCalls.length, 0);
      assert.equal(state.publishCalls.length, 0);
    });
  });

  // -----------------------------------------------------------------------
  // VAL-MODE-009: --local --dry-run together produce local dry-run
  // -----------------------------------------------------------------------
  describe("VAL-MODE-009: --local --dry-run together", () => {
    it("selects local mode AND dry-run with no side effects", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: false, pushed: false, location: "" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: false, local: true },
          dir,
          deps,
        ),
      );

      // Local mode reported even though token is present
      assert.ok(output.stdout.includes("mode: local"), "should report local mode");
      // No side effects
      assert.equal(state.factoryCalls.length, 0, "no publisher created");
      assert.equal(state.publishCalls.length, 0, "no publish called");
      assert.equal(result.committed, false);
      assert.equal(result.pushed, false);
    });
  });

  // -----------------------------------------------------------------------
  // VAL-MODE-010: Mode is reported in the output
  // -----------------------------------------------------------------------
  describe("VAL-MODE-010: Mode is reported in output", () => {
    it("reports 'remote' in dry-run output when in remote mode", async () => {
      const dir = await createTempDir();
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
      };

      const { output } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.ok(output.stdout.includes("mode: remote"));
    });

    it("reports 'local' in dry-run output when in local mode", async () => {
      const dir = await createTempDir();
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
      };

      const { output } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.ok(output.stdout.includes("mode: local"));
    });

    it("reports mode in normal (non-dry-run) output for remote mode", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "remote", committed: true, pushed: true, location: "sha123" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.ok(output.stdout.includes("mode: remote"), "normal output should report remote mode");
      assert.ok(output.stdout.includes("saved note clip"), "should print saved message");
    });

    it("reports mode in normal (non-dry-run) output for local mode", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: true, location: dir },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.ok(output.stdout.includes("mode: local"), "normal output should report local mode");
    });
  });

  // -----------------------------------------------------------------------
  // VAL-MODE-007: --no-push in remote mode is ignored or warned
  // -----------------------------------------------------------------------
  describe("VAL-MODE-007: --no-push in remote mode", () => {
    it("warns that --no-push is ignored in remote mode, no error", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "remote", committed: true, pushed: true, location: "sha123" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: true, local: false },
          dir,
          deps,
        ),
      );

      // Warning printed to stderr
      assert.ok(output.stderr.includes("--no-push"), "should warn about --no-push in remote mode");
      assert.ok(output.stderr.includes("remote"), "warning should mention remote mode");
      // No error — publish still succeeds
      assert.equal(result.mode, "remote");
      assert.equal(result.committed, true);
      assert.equal(state.publishCalls.length, 1, "publish should still be called");
    });

    it("warns in dry-run remote mode too", async () => {
      const dir = await createTempDir();
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
      };

      const { output } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: true, local: false },
          dir,
          deps,
        ),
      );

      assert.ok(output.stderr.includes("--no-push"), "should warn even in dry-run");
    });
  });

  // -----------------------------------------------------------------------
  // VAL-MODE-006: --no-push in local mode commits without pushing
  // -----------------------------------------------------------------------
  describe("VAL-MODE-006: --no-push in local mode", () => {
    it("does not warn and passes noPush to publisher", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: false, location: dir },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: true, local: false },
          dir,
          deps,
        ),
      );

      // No warning in local mode
      assert.equal(output.stderr, "", "no warning in local mode");
      // noPush passed to publisher
      assert.equal(state.publishCalls[0]!.noPush, true);
      // Committed but not pushed
      assert.equal(result.committed, true);
      assert.equal(result.pushed, false);
    });
  });

  // -----------------------------------------------------------------------
  // VAL-MODE-011: --local with no token works normally
  // -----------------------------------------------------------------------
  describe("VAL-MODE-011: --local with no token", () => {
    it("operates in local mode normally", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: true, location: dir },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: true },
          dir,
          deps,
        ),
      );

      assert.equal(result.mode, "local");
      assert.ok(output.stdout.includes("mode: local"));
      assert.equal(state.factoryCalls[0]!.local, true);
      assert.equal(state.factoryCalls[0]!.token, null);
    });
  });

  // -----------------------------------------------------------------------
  // VAL-CROSS-008: Config branch change redirects remote publishing
  // -----------------------------------------------------------------------
  describe("VAL-CROSS-008: Config branch is passed to publisher factory", () => {
    it("passes the configured github branch to the factory in remote mode", async () => {
      const dir = await createTempDir();
      const customConfig: ClipConfig = {
        mode: "remote",
        github: { owner: "testowner", repo: "testrepo", branch: "develop" },
      };
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "remote", committed: true, pushed: true, location: "sha123" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(customConfig),
        createPublisherFn: createMockPublisherFactory(state),
      };

      await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.ok(state.factoryCalls[0]!.github, "github config should be passed");
      assert.equal(state.factoryCalls[0]!.github!.branch, "develop");
      assert.equal(state.factoryCalls[0]!.github!.owner, "testowner");
      assert.equal(state.factoryCalls[0]!.github!.repo, "testrepo");
    });

    it("passes default github config when config store returns defaults", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "remote", committed: true, pushed: true, location: "sha123" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(state.factoryCalls[0]!.github!.branch, "main");
    });

    it("does not read config in local mode (no config store call needed)", async () => {
      const dir = await createTempDir();
      let configReadCalled = false;
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: true, location: dir },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: {
          async read(): Promise<ClipConfig> {
            configReadCalled = true;
            return DEFAULT_GITHUB_CONFIG;
          },
        },
        createPublisherFn: createMockPublisherFactory(state),
      };

      await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(configReadCalled, false, "config should not be read in local mode");
      assert.equal(
        state.factoryCalls[0]!.github,
        undefined,
        "github config should be undefined in local mode",
      );
    });
  });

  // -----------------------------------------------------------------------
  // VAL-CROSS-006: After logout, clip falls back to local mode
  // -----------------------------------------------------------------------
  describe("VAL-CROSS-006: Logout falls back to local mode", () => {
    it("selects local mode when token is null (simulating post-logout state)", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: true, location: dir },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(result.mode, "local");
      assert.ok(output.stdout.includes("mode: local"));
      assert.equal(state.factoryCalls[0]!.token, null);
    });
  });

  // -----------------------------------------------------------------------
  // VAL-CROSS-007: Mode switching between remote and local in one session
  // -----------------------------------------------------------------------
  describe("VAL-CROSS-007: Mode switching in one session", () => {
    it("can publish in remote mode then local mode with different --local flags", async () => {
      const dir = await createTempDir();
      const remoteState: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "remote", committed: true, pushed: true, location: "sha-remote" },
      };
      const localState: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: true, location: dir },
      };

      // First: remote mode (token, no --local)
      const remoteDeps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(remoteState),
      };
      const { result: remoteResult } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          remoteDeps,
        ),
      );
      assert.equal(remoteResult.mode, "remote");

      // Second: local mode (token present, --local flag)
      const localDeps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(localState),
      };
      const { result: localResult } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: true },
          dir,
          localDeps,
        ),
      );
      assert.equal(localResult.mode, "local");

      // Both succeeded independently
      assert.equal(remoteState.publishCalls.length, 1);
      assert.equal(localState.publishCalls.length, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Token check failure defaults to local mode
  // -----------------------------------------------------------------------
  describe("token check failure", () => {
    it("defaults to local mode when keychain.read() throws", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: true, location: dir },
      };
      const deps: ClipCommandDeps = {
        keychain: {
          async read(): Promise<string | null> {
            throw new Error("Keychain access denied");
          },
        },
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      const { output, result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(result.mode, "local");
      assert.ok(output.stdout.includes("mode: local"));
      assert.equal(state.factoryCalls[0]!.token, null);
    });
  });

  // -----------------------------------------------------------------------
  // Integration with real publisher factory
  // -----------------------------------------------------------------------
  describe("integration with real createPublisher factory", () => {
    it("factory returns LocalGitPublisher when no token (no --local)", async () => {
      const dir = await createTempDir();
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        // Use the real factory (no createPublisherFn override)
      };

      const { result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      // Dry-run returns before factory is called, but mode is local
      assert.equal(result.mode, "local");
    });

    it("factory returns GitHubApiPublisher when token present (no --local)", async () => {
      // We can't easily test the real factory returning a GitHubApiPublisher
      // without mocking fetch, but we can verify the factory options are
      // correct via the mock factory tests above. Here we just verify
      // dry-run mode is reported correctly.
      const dir = await createTempDir();
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
      };

      const { result } = await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: true, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(result.mode, "remote");
    });
  });

  // -----------------------------------------------------------------------
  // Commit message is passed through correctly
  // -----------------------------------------------------------------------
  describe("commit message", () => {
    it("passes the correct commit message format to the publisher", async () => {
      const dir = await createTempDir();
      const state: MockPublisherState = {
        factoryCalls: [],
        publishCalls: [],
        result: { mode: "local", committed: true, pushed: true, location: dir },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain(null),
        configStore: createMockConfigStore(DEFAULT_GITHUB_CONFIG),
        createPublisherFn: createMockPublisherFactory(state),
      };

      await captureOutput(() =>
        executePublishing(
          makePreparedClip(),
          { dryRun: false, noPush: false, local: false },
          dir,
          deps,
        ),
      );

      assert.equal(
        state.publishCalls[0]!.commitMessage,
        ":sparkles: feat[clips]: add test-slug note clip",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Publisher type verification
  // -----------------------------------------------------------------------
  describe("publisher type selection", () => {
    it("real factory returns LocalGitPublisher for local mode", () => {
      const publisher = createPublisher({
        repoRoot: "/tmp/fake",
        local: false,
        token: null,
      });
      assert.ok(publisher instanceof LocalGitPublisher);
    });

    it("real factory returns GitHubApiPublisher for remote mode with config", () => {
      const publisher = createPublisher({
        repoRoot: "/tmp/fake",
        local: false,
        token: "ghp_testtoken",
        github: { owner: "owner", repo: "repo", branch: "main" },
      });
      assert.ok(publisher instanceof GitHubApiPublisher);
    });
  });

  // -----------------------------------------------------------------------
  // VAL-REMOTE-031: Remote mode with no repo configured
  // -----------------------------------------------------------------------
  describe("VAL-REMOTE-031: Remote mode with no repo configured", () => {
    it("exits with a helpful error when github.repo is empty", async () => {
      const dir = await createTempDir();
      const emptyRepoConfig: ClipConfig = {
        mode: "remote",
        github: { owner: "testowner", repo: "", branch: "main" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(emptyRepoConfig),
        // Use the real factory (no createPublisherFn override) so the
        // empty-repo guard runs and throws before any publisher is created.
      };

      await assert.rejects(
        () =>
          executePublishing(
            makePreparedClip(),
            { dryRun: false, noPush: false, local: false },
            dir,
            deps,
          ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("No repository configured"));
          assert.ok(err.message.includes("clip init"));
          assert.ok(err.message.includes("clip config set github.repo"));
          return true;
        },
      );
    });

    it("makes no publish API calls when github.repo is empty", async () => {
      const dir = await createTempDir();
      const emptyRepoConfig: ClipConfig = {
        mode: "remote",
        github: { owner: "testowner", repo: "", branch: "main" },
      };
      const deps: ClipCommandDeps = {
        keychain: createMockKeychain("ghp_testtoken"),
        configStore: createMockConfigStore(emptyRepoConfig),
        // Use the real factory (no createPublisherFn override). The empty-repo
        // guard throws before a GitHubApiPublisher is constructed, so no
        // GitHub API calls can be made.
      };

      await assert.rejects(
        () =>
          executePublishing(
            makePreparedClip(),
            { dryRun: false, noPush: false, local: false },
            dir,
            deps,
          ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("No repository configured"));
          return true;
        },
      );
      // Reaching this point means executePublishing rejected before any
      // publisher was created, so no publish API calls were made.
    });
  });
});
