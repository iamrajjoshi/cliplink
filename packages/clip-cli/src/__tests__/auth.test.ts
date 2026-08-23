import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { AuthError, KeychainStore } from "../auth/keychain";
import { CLIENT_ID, OAuthClient, OAuthError } from "../auth/oauth";
import { runLoginCommand } from "../commands/login";
import { runLogoutCommand } from "../commands/logout";
import { ConfigStore } from "../config/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clip-auth-"));
  tempDirs.push(dir);
  return dir;
}

const TEST_TOKEN = "fake-token-placeholder";
const TEST_LOGIN = "testuser";
const TEST_USER_CODE = "ABCD-1234";
const TEST_VERIFICATION_URI = "https://github.com/login/device";
const TEST_DEVICE_CODE = "device-code-xyz";

const noopSleep = async () => {};

interface MockResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

function createMockResponse(r: MockResponse): Response {
  return {
    ok: r.ok,
    status: r.status,
    json: async () => r.body,
  } as Response;
}

interface MockFetchOptions {
  deviceCodeResponse?: MockResponse;
  tokenResponses?: MockResponse[];
  userResponse?: MockResponse;
}

function createMockFetch(options: MockFetchOptions): typeof fetch {
  let tokenCallIndex = 0;
  return (async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/login/device/code")) {
      return createMockResponse(
        options.deviceCodeResponse ?? {
          ok: true,
          status: 200,
          body: {
            device_code: TEST_DEVICE_CODE,
            user_code: TEST_USER_CODE,
            verification_uri: TEST_VERIFICATION_URI,
            expires_in: 900,
            interval: 5,
          },
        },
      );
    }
    if (url.includes("/login/oauth/access_token")) {
      const responses = options.tokenResponses ?? [];
      const r = responses[tokenCallIndex];
      tokenCallIndex += 1;
      if (!r) throw new Error("No more token responses");
      return createMockResponse(r);
    }
    if (url.includes("/user")) {
      return createMockResponse(
        options.userResponse ?? {
          ok: true,
          status: 200,
          body: { login: TEST_LOGIN, id: 12345 },
        },
      );
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;
}

function createFailingFetch(): typeof fetch {
  return (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
}

interface MockExecOptions {
  findResult?: string;
  findError?: boolean;
  addSucceeds?: boolean;
  deleteSucceeds?: boolean;
}

function createMockExec(options: MockExecOptions = {}) {
  return (_command: string, args: string[]): string => {
    if (args.includes("find-generic-password")) {
      if (options.findError) throw new Error("Keychain access denied");
      return options.findResult ?? "";
    }
    if (args.includes("add-generic-password")) {
      if (!options.addSucceeds) throw new Error("Keychain add failed");
      return "";
    }
    if (args.includes("delete-generic-password")) {
      if (!options.deleteSucceeds) throw new Error("not found");
      return "";
    }
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  };
}

async function captureOutput(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  const errorLines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errorLines.push(args.map(String).join(" "));
  };
  try {
    await fn();
    return { stdout: lines.join("\n"), stderr: errorLines.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

// ---------------------------------------------------------------------------
// OAuthClient
// ---------------------------------------------------------------------------

describe("OAuthClient", () => {
  describe("requestDeviceCode", () => {
    it("returns device code response on success", async () => {
      const fetchFn = createMockFetch({});
      const oauth = new OAuthClient({ fetchFn });
      const result = await oauth.requestDeviceCode();
      assert.equal(result.device_code, TEST_DEVICE_CODE);
      assert.equal(result.user_code, TEST_USER_CODE);
      assert.equal(result.verification_uri, TEST_VERIFICATION_URI);
      assert.equal(result.expires_in, 900);
      assert.equal(result.interval, 5);
    });

    it("throws OAuthError on HTTP error", async () => {
      const fetchFn = createMockFetch({
        deviceCodeResponse: { ok: false, status: 500, body: {} },
      });
      const oauth = new OAuthClient({ fetchFn });
      await assert.rejects(
        () => oauth.requestDeviceCode(),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("500"));
          return true;
        },
      );
    });

    it("throws OAuthError on network error (VAL-AUTH-018)", async () => {
      const oauth = new OAuthClient({ fetchFn: createFailingFetch() });
      await assert.rejects(
        () => oauth.requestDeviceCode(),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("Could not connect"));
          return true;
        },
      );
    });

    it("throws OAuthError on invalid JSON (VAL-AUTH-022)", async () => {
      const fetchFn = createMockFetch({
        deviceCodeResponse: { ok: true, status: 200, body: "not json" },
      });
      const oauth = new OAuthClient({ fetchFn });
      // The mock's json() returns the body as-is, so "not json" string is returned
      // isValidDeviceCodeResponse will reject it
      await assert.rejects(
        () => oauth.requestDeviceCode(),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          return true;
        },
      );
    });

    it("throws OAuthError on missing required fields (VAL-AUTH-022)", async () => {
      const fetchFn = createMockFetch({
        deviceCodeResponse: {
          ok: true,
          status: 200,
          body: { device_code: "abc" }, // missing user_code, verification_uri, etc.
        },
      });
      const oauth = new OAuthClient({ fetchFn });
      await assert.rejects(
        () => oauth.requestDeviceCode(),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("Invalid device code response"));
          return true;
        },
      );
    });

    it("sends client_id and scope=repo in request body", async () => {
      let capturedBody: string | undefined;
      const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/login/device/code") && init?.body) {
          capturedBody = init.body as string;
        }
        return createMockResponse({
          ok: true,
          status: 200,
          body: {
            device_code: TEST_DEVICE_CODE,
            user_code: TEST_USER_CODE,
            verification_uri: TEST_VERIFICATION_URI,
            expires_in: 900,
            interval: 5,
          },
        });
      }) as typeof fetch;
      const oauth = new OAuthClient({ fetchFn });
      await oauth.requestDeviceCode();
      assert.ok(capturedBody);
      const parsed = JSON.parse(capturedBody as string) as Record<string, unknown>;
      assert.equal(parsed["client_id"], CLIENT_ID);
      assert.equal(parsed["scope"], "repo");
    });
  });

  describe("pollForToken", () => {
    it("returns access token on success", async () => {
      const fetchFn = createMockFetch({
        tokenResponses: [{ ok: true, status: 200, body: { access_token: TEST_TOKEN } }],
      });
      const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
      const token = await oauth.pollForToken(TEST_DEVICE_CODE, 5, 900);
      assert.equal(token, TEST_TOKEN);
    });

    it("continues polling on authorization_pending (VAL-AUTH-011)", async () => {
      const fetchFn = createMockFetch({
        tokenResponses: [
          { ok: true, status: 200, body: { error: "authorization_pending" } },
          { ok: true, status: 200, body: { error: "authorization_pending" } },
          { ok: true, status: 200, body: { access_token: TEST_TOKEN } },
        ],
      });
      const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
      const token = await oauth.pollForToken(TEST_DEVICE_CODE, 5, 900);
      assert.equal(token, TEST_TOKEN);
    });

    it("increases interval on slow_down (VAL-AUTH-012)", async () => {
      const sleepCalls: number[] = [];
      const trackingSleep = async (ms: number) => {
        sleepCalls.push(ms);
      };
      const fetchFn = createMockFetch({
        tokenResponses: [
          { ok: true, status: 200, body: { error: "slow_down" } },
          { ok: true, status: 200, body: { access_token: TEST_TOKEN } },
        ],
      });
      const oauth = new OAuthClient({ fetchFn, sleepFn: trackingSleep });
      await oauth.pollForToken(TEST_DEVICE_CODE, 5, 900);
      // First sleep: 5000ms (5s * 1000), second sleep: 10000ms (5000 + 5000)
      assert.equal(sleepCalls.length, 2);
      assert.equal(sleepCalls[0], 5000);
      assert.equal(sleepCalls[1], 10000);
    });

    it("throws on expired_token (VAL-AUTH-013)", async () => {
      const fetchFn = createMockFetch({
        tokenResponses: [{ ok: true, status: 200, body: { error: "expired_token" } }],
      });
      const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
      await assert.rejects(
        () => oauth.pollForToken(TEST_DEVICE_CODE, 5, 900),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("expired"));
          return true;
        },
      );
    });

    it("throws on token_expired (VAL-AUTH-013)", async () => {
      const fetchFn = createMockFetch({
        tokenResponses: [{ ok: true, status: 200, body: { error: "token_expired" } }],
      });
      const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
      await assert.rejects(
        () => oauth.pollForToken(TEST_DEVICE_CODE, 5, 900),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("expired"));
          return true;
        },
      );
    });

    it("throws on access_denied (VAL-AUTH-014)", async () => {
      const fetchFn = createMockFetch({
        tokenResponses: [{ ok: true, status: 200, body: { error: "access_denied" } }],
      });
      const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
      await assert.rejects(
        () => oauth.pollForToken(TEST_DEVICE_CODE, 5, 900),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("denied"));
          return true;
        },
      );
    });

    it("throws on timeout when expires_in elapses (VAL-AUTH-015)", async () => {
      const fetchFn = createMockFetch({
        tokenResponses: [{ ok: true, status: 200, body: { error: "authorization_pending" } }],
      });
      const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
      // expires_in = 0 means the deadline is now, so it should throw immediately
      await assert.rejects(
        () => oauth.pollForToken(TEST_DEVICE_CODE, 5, 0),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("expired"));
          return true;
        },
      );
    });

    it("throws on network error during polling (VAL-AUTH-018)", async () => {
      const oauth = new OAuthClient({ fetchFn: createFailingFetch(), sleepFn: noopSleep });
      await assert.rejects(
        () => oauth.pollForToken(TEST_DEVICE_CODE, 5, 900),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("Could not connect"));
          return true;
        },
      );
    });

    it("throws on HTTP error during polling", async () => {
      const fetchFn = createMockFetch({
        tokenResponses: [{ ok: false, status: 500, body: {} }],
      });
      const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
      await assert.rejects(
        () => oauth.pollForToken(TEST_DEVICE_CODE, 5, 900),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("500"));
          return true;
        },
      );
    });
  });

  describe("verifyToken", () => {
    it("returns login on success", async () => {
      const fetchFn = createMockFetch({});
      const oauth = new OAuthClient({ fetchFn });
      const login = await oauth.verifyToken(TEST_TOKEN);
      assert.equal(login, TEST_LOGIN);
    });

    it("throws on 401/403 (VAL-AUTH-019)", async () => {
      const fetchFn = createMockFetch({
        userResponse: { ok: false, status: 401, body: { message: "Bad credentials" } },
      });
      const oauth = new OAuthClient({ fetchFn });
      await assert.rejects(
        () => oauth.verifyToken(TEST_TOKEN),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("could not be verified"));
          // Token must not appear in the error message
          assert.ok(!err.message.includes(TEST_TOKEN));
          return true;
        },
      );
    });

    it("throws on network error (VAL-AUTH-018)", async () => {
      const oauth = new OAuthClient({ fetchFn: createFailingFetch() });
      await assert.rejects(
        () => oauth.verifyToken(TEST_TOKEN),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          assert.ok(err.message.includes("Could not connect"));
          return true;
        },
      );
    });

    it("throws on missing login field", async () => {
      const fetchFn = createMockFetch({
        userResponse: { ok: true, status: 200, body: { id: 12345 } },
      });
      const oauth = new OAuthClient({ fetchFn });
      await assert.rejects(
        () => oauth.verifyToken(TEST_TOKEN),
        (err: unknown) => {
          assert.ok(err instanceof OAuthError);
          return true;
        },
      );
    });
  });

  describe("authenticate", () => {
    it("calls onDisplay with user_code and verification_uri (VAL-AUTH-001)", async () => {
      const fetchFn = createMockFetch({
        tokenResponses: [{ ok: true, status: 200, body: { access_token: TEST_TOKEN } }],
      });
      const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
      const displayed: Array<{ userCode: string; verificationUri: string }> = [];
      const token = await oauth.authenticate((info) => {
        displayed.push(info);
      });
      assert.equal(displayed.length, 1);
      const info = displayed[0];
      assert.ok(info);
      assert.equal(info.userCode, TEST_USER_CODE);
      assert.equal(info.verificationUri, TEST_VERIFICATION_URI);
      assert.equal(token, TEST_TOKEN);
    });
  });
});

// ---------------------------------------------------------------------------
// KeychainStore
// ---------------------------------------------------------------------------

describe("KeychainStore", () => {
  describe("store", () => {
    it("stores in Keychain on macOS when interactive (VAL-AUTH-002)", async () => {
      const execCalls: string[][] = [];
      const execFn = (cmd: string, args: string[]): string => {
        execCalls.push([cmd, ...args]);
        if (args.includes("add-generic-password")) return "";
        if (args.includes("delete-generic-password")) throw new Error("not found");
        throw new Error("unexpected");
      };
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        execFn,
        platform: "darwin",
        interactive: true,
      });
      await store.store(TEST_TOKEN);
      // Should have called delete (fails, ignored) then add
      assert.ok(execCalls.some((c) => c.includes("delete-generic-password")));
      assert.ok(execCalls.some((c) => c.includes("add-generic-password")));
      // Should NOT have created a credentials file
      await assert.rejects(
        () => stat(path.join(dir, "clip", "credentials.json")),
        (err: NodeJS.ErrnoException) => err.code === "ENOENT",
      );
    });

    it("falls back to file when Keychain fails (VAL-AUTH-003, VAL-AUTH-017)", async () => {
      const execFn = createMockExec({ addSucceeds: false });
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        execFn,
        platform: "darwin",
        interactive: true,
      });
      await store.store(TEST_TOKEN);
      // Should have created a credentials file
      const credPath = path.join(dir, "clip", "credentials.json");
      const content = await readFile(credPath, "utf8");
      const data = JSON.parse(content) as { token: string };
      assert.equal(data.token, TEST_TOKEN);
    });

    it("uses file on non-macOS", async () => {
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        platform: "linux",
        interactive: true,
      });
      await store.store(TEST_TOKEN);
      const credPath = path.join(dir, "clip", "credentials.json");
      const content = await readFile(credPath, "utf8");
      const data = JSON.parse(content) as { token: string };
      assert.equal(data.token, TEST_TOKEN);
    });

    it("uses file in non-interactive environment (VAL-AUTH-016)", async () => {
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        platform: "darwin",
        interactive: false,
      });
      await store.store(TEST_TOKEN);
      const credPath = path.join(dir, "clip", "credentials.json");
      const content = await readFile(credPath, "utf8");
      const data = JSON.parse(content) as { token: string };
      assert.equal(data.token, TEST_TOKEN);
    });

    it("creates file with 0600 permissions (VAL-AUTH-020)", async () => {
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        platform: "linux",
        interactive: true,
      });
      await store.store(TEST_TOKEN);
      const credPath = path.join(dir, "clip", "credentials.json");
      const stats = await stat(credPath);
      const mode = stats.mode & 0o777;
      assert.equal(mode, 0o600);
    });

    it("creates directory with 0700 permissions", async () => {
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        platform: "linux",
        interactive: true,
      });
      await store.store(TEST_TOKEN);
      const clipDir = path.join(dir, "clip");
      const stats = await stat(clipDir);
      const mode = stats.mode & 0o777;
      assert.equal(mode, 0o700);
    });
  });

  describe("read", () => {
    it("reads from Keychain on macOS when interactive", async () => {
      const execFn = createMockExec({ findResult: TEST_TOKEN });
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        execFn,
        platform: "darwin",
        interactive: true,
      });
      const token = await store.read();
      assert.equal(token, TEST_TOKEN);
    });

    it("falls back to file when Keychain returns nothing", async () => {
      const execFn = createMockExec({ findResult: "" });
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "credentials.json"),
        JSON.stringify({ token: TEST_TOKEN }),
        { mode: 0o600 },
      );
      const store = new KeychainStore({
        configDir: dir,
        execFn,
        platform: "darwin",
        interactive: true,
      });
      const token = await store.read();
      assert.equal(token, TEST_TOKEN);
    });

    it("reads from file on non-macOS", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "credentials.json"),
        JSON.stringify({ token: TEST_TOKEN }),
        { mode: 0o600 },
      );
      const store = new KeychainStore({
        configDir: dir,
        platform: "linux",
        interactive: true,
      });
      const token = await store.read();
      assert.equal(token, TEST_TOKEN);
    });

    it("returns null when no token exists", async () => {
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        platform: "linux",
        interactive: true,
      });
      const token = await store.read();
      assert.equal(token, null);
    });

    it("returns null when Keychain fails and no file exists", async () => {
      const execFn = createMockExec({ findError: true });
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        execFn,
        platform: "darwin",
        interactive: true,
      });
      const token = await store.read();
      assert.equal(token, null);
    });
  });

  describe("delete", () => {
    it("deletes from Keychain on macOS", async () => {
      const execCalls: string[][] = [];
      const execFn = (cmd: string, args: string[]): string => {
        execCalls.push([cmd, ...args]);
        return "";
      };
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        execFn,
        platform: "darwin",
        interactive: true,
      });
      const result = await store.delete();
      assert.equal(result, true);
      assert.ok(execCalls.some((c) => c.includes("delete-generic-password")));
    });

    it("deletes from file (VAL-AUTH-008)", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      const credPath = path.join(clipDir, "credentials.json");
      await writeFile(credPath, JSON.stringify({ token: TEST_TOKEN }), { mode: 0o600 });
      const store = new KeychainStore({
        configDir: dir,
        platform: "linux",
        interactive: true,
      });
      const result = await store.delete();
      assert.equal(result, true);
      await assert.rejects(
        () => stat(credPath),
        (err: NodeJS.ErrnoException) => err.code === "ENOENT",
      );
    });

    it("returns false when nothing to delete (VAL-AUTH-009)", async () => {
      const dir = await createTempDir();
      const store = new KeychainStore({
        configDir: dir,
        platform: "linux",
        interactive: true,
      });
      const result = await store.delete();
      assert.equal(result, false);
    });

    it("tries both Keychain and file on macOS", async () => {
      let deleteCalled = false;
      const execFn = (_cmd: string, args: string[]): string => {
        if (args.includes("delete-generic-password")) {
          deleteCalled = true;
          throw new Error("not found");
        }
        throw new Error("unexpected");
      };
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "credentials.json"),
        JSON.stringify({ token: TEST_TOKEN }),
        { mode: 0o600 },
      );
      const store = new KeychainStore({
        configDir: dir,
        execFn,
        platform: "darwin",
        interactive: true,
      });
      const result = await store.delete();
      assert.equal(result, true);
      assert.ok(deleteCalled);
    });
  });

  describe("XDG_CONFIG_HOME", () => {
    it("respects XDG_CONFIG_HOME for credentials file (VAL-AUTH-021)", async () => {
      const xdgDir = await createTempDir();
      const oldXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = xdgDir;
      try {
        const store = new KeychainStore({
          platform: "linux",
          interactive: true,
        });
        await store.store(TEST_TOKEN);
        const credPath = path.join(xdgDir, "clip", "credentials.json");
        const stats = await stat(credPath);
        assert.ok(stats.isFile());
        const mode = stats.mode & 0o777;
        assert.equal(mode, 0o600);
      } finally {
        if (oldXdg === undefined) {
          delete process.env.XDG_CONFIG_HOME;
        } else {
          process.env.XDG_CONFIG_HOME = oldXdg;
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// runLoginCommand
// ---------------------------------------------------------------------------

describe("runLoginCommand", () => {
  it("initiates Device Flow and displays user_code and verification_uri (VAL-AUTH-001)", async () => {
    const fetchFn = createMockFetch({
      tokenResponses: [{ ok: true, status: 200, body: { access_token: TEST_TOKEN } }],
    });
    const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    const configStore = new ConfigStore({ configDir: dir });
    const { stdout } = await captureOutput(() => runLoginCommand({ oauth, keychain, configStore }));
    assert.ok(stdout.includes(TEST_USER_CODE), "stdout should contain user_code");
    assert.ok(stdout.includes(TEST_VERIFICATION_URI), "stdout should contain verification_uri");
  });

  it("stores token in Keychain on macOS (VAL-AUTH-002)", async () => {
    const fetchFn = createMockFetch({
      tokenResponses: [{ ok: true, status: 200, body: { access_token: TEST_TOKEN } }],
    });
    const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
    let addCalled = false;
    const execFn = (_cmd: string, args: string[]): string => {
      if (args.includes("add-generic-password")) {
        addCalled = true;
        return "";
      }
      if (args.includes("delete-generic-password")) throw new Error("not found");
      if (args.includes("find-generic-password")) return "";
      throw new Error("unexpected");
    };
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      execFn,
      platform: "darwin",
      interactive: true,
    });
    const configStore = new ConfigStore({ configDir: dir });
    await runLoginCommand({ oauth, keychain, configStore });
    assert.ok(addCalled, "should have called security add-generic-password");
  });

  it("falls back to file when Keychain fails (VAL-AUTH-003, VAL-AUTH-017)", async () => {
    const fetchFn = createMockFetch({
      tokenResponses: [{ ok: true, status: 200, body: { access_token: TEST_TOKEN } }],
    });
    const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
    const execFn = createMockExec({ addSucceeds: false });
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      execFn,
      platform: "darwin",
      interactive: true,
    });
    const configStore = new ConfigStore({ configDir: dir });
    await runLoginCommand({ oauth, keychain, configStore });
    const credPath = path.join(dir, "clip", "credentials.json");
    const content = await readFile(credPath, "utf8");
    const data = JSON.parse(content) as { token: string };
    assert.equal(data.token, TEST_TOKEN);
    const stats = await stat(credPath);
    assert.equal(stats.mode & 0o777, 0o600);
  });

  it("verifies token with GET /user (VAL-AUTH-006)", async () => {
    let userUrlCalled = false;
    const fetchFn = (async (input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/login/device/code")) {
        return createMockResponse({
          ok: true,
          status: 200,
          body: {
            device_code: TEST_DEVICE_CODE,
            user_code: TEST_USER_CODE,
            verification_uri: TEST_VERIFICATION_URI,
            expires_in: 900,
            interval: 5,
          },
        });
      }
      if (url.includes("/login/oauth/access_token")) {
        return createMockResponse({ ok: true, status: 200, body: { access_token: TEST_TOKEN } });
      }
      if (url.includes("/user")) {
        userUrlCalled = true;
        return createMockResponse({ ok: true, status: 200, body: { login: TEST_LOGIN } });
      }
      throw new Error(`Unexpected: ${url}`);
    }) as typeof fetch;
    const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    const configStore = new ConfigStore({ configDir: dir });
    await runLoginCommand({ oauth, keychain, configStore });
    assert.ok(userUrlCalled, "should have called GET /user");
  });

  it("prints success message without token (VAL-AUTH-004, VAL-AUTH-010)", async () => {
    const fetchFn = createMockFetch({
      tokenResponses: [{ ok: true, status: 200, body: { access_token: TEST_TOKEN } }],
    });
    const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    const configStore = new ConfigStore({ configDir: dir });
    const { stdout, stderr } = await captureOutput(() =>
      runLoginCommand({ oauth, keychain, configStore }),
    );
    assert.ok(stdout.includes(`Logged in as ${TEST_LOGIN}`));
    assert.ok(!stdout.includes(TEST_TOKEN), "token must not appear in stdout");
    assert.ok(!stderr.includes(TEST_TOKEN), "token must not appear in stderr");
  });

  it("handles already logged in gracefully (VAL-AUTH-005)", async () => {
    const dir = await createTempDir();
    const clipDir = path.join(dir, "clip");
    await mkdir(clipDir, { recursive: true });
    await writeFile(path.join(clipDir, "credentials.json"), JSON.stringify({ token: TEST_TOKEN }), {
      mode: 0o600,
    });
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    const { stdout } = await captureOutput(() => runLoginCommand({ keychain }));
    assert.ok(stdout.includes("Already logged in"));
    // Should not have attempted OAuth
    assert.ok(!stdout.includes(TEST_USER_CODE));
  });

  it("handles network failure with meaningful error (VAL-AUTH-018)", async () => {
    const oauth = new OAuthClient({ fetchFn: createFailingFetch(), sleepFn: noopSleep });
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    await assert.rejects(
      () => runLoginCommand({ oauth, keychain }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("Could not connect"));
        assert.ok(!err.message.includes(TEST_TOKEN));
        return true;
      },
    );
  });

  it("handles invalid device-code response (VAL-AUTH-022)", async () => {
    const fetchFn = createMockFetch({
      deviceCodeResponse: { ok: true, status: 200, body: { foo: "bar" } },
    });
    const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    await assert.rejects(
      () => runLoginCommand({ oauth, keychain }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("Invalid device code response"));
        return true;
      },
    );
  });

  it("handles GET /user failure with generic auth error (VAL-AUTH-019)", async () => {
    const fetchFn = createMockFetch({
      tokenResponses: [{ ok: true, status: 200, body: { access_token: TEST_TOKEN } }],
      userResponse: { ok: false, status: 401, body: { message: "Bad credentials" } },
    });
    const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    await assert.rejects(
      () => runLoginCommand({ oauth, keychain }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("could not be verified"));
        assert.ok(!err.message.includes(TEST_TOKEN));
        return true;
      },
    );
    // Token should not have been stored
    const stored = await keychain.read();
    assert.equal(stored, null);
  });

  it("uses file fallback in non-interactive environment (VAL-AUTH-016)", async () => {
    const fetchFn = createMockFetch({
      tokenResponses: [{ ok: true, status: 200, body: { access_token: TEST_TOKEN } }],
    });
    const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "darwin",
      interactive: false,
    });
    const configStore = new ConfigStore({ configDir: dir });
    await runLoginCommand({ oauth, keychain, configStore });
    const credPath = path.join(dir, "clip", "credentials.json");
    const stats = await stat(credPath);
    assert.ok(stats.isFile());
    assert.equal(stats.mode & 0o777, 0o600);
  });

  it("token never appears in any output across all auth operations (VAL-AUTH-010)", async () => {
    const fetchFn = createMockFetch({
      tokenResponses: [{ ok: true, status: 200, body: { access_token: TEST_TOKEN } }],
    });
    const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    const configStore = new ConfigStore({ configDir: dir });
    const { stdout, stderr } = await captureOutput(() =>
      runLoginCommand({ oauth, keychain, configStore }),
    );
    assert.ok(!stdout.includes(TEST_TOKEN));
    assert.ok(!stderr.includes(TEST_TOKEN));
  });

  it("auto-sets github.owner from GET /user login (VAL-AUTH-023)", async () => {
    const fetchFn = createMockFetch({
      tokenResponses: [{ ok: true, status: 200, body: { access_token: TEST_TOKEN } }],
    });
    const oauth = new OAuthClient({ fetchFn, sleepFn: noopSleep });
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    const configStore = new ConfigStore({ configDir: dir });
    await runLoginCommand({ oauth, keychain, configStore });
    const owner = await configStore.get("github.owner");
    assert.equal(owner, TEST_LOGIN, "github.owner should be set to the authenticated login");
    // Token must not be stored in the config file
    const configPath = path.join(dir, "clip", "config.json");
    const content = await readFile(configPath, "utf8");
    assert.ok(!content.includes(TEST_TOKEN), "token must not be stored in config");
  });
});

// ---------------------------------------------------------------------------
// runLogoutCommand
// ---------------------------------------------------------------------------

describe("runLogoutCommand", () => {
  it("deletes from Keychain (VAL-AUTH-007)", async () => {
    let deleteCalled = false;
    const execFn = (_cmd: string, args: string[]): string => {
      if (args.includes("delete-generic-password")) {
        deleteCalled = true;
        return "";
      }
      throw new Error("unexpected");
    };
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      execFn,
      platform: "darwin",
      interactive: true,
    });
    const { stdout } = await captureOutput(() => runLogoutCommand({ keychain }));
    assert.ok(deleteCalled, "should have called security delete-generic-password");
    assert.ok(stdout.includes("Logged out"));
  });

  it("deletes from file (VAL-AUTH-008)", async () => {
    const dir = await createTempDir();
    const clipDir = path.join(dir, "clip");
    await mkdir(clipDir, { recursive: true });
    const credPath = path.join(clipDir, "credentials.json");
    await writeFile(credPath, JSON.stringify({ token: TEST_TOKEN }), { mode: 0o600 });
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    const { stdout } = await captureOutput(() => runLogoutCommand({ keychain }));
    assert.ok(stdout.includes("Logged out"));
    await assert.rejects(
      () => stat(credPath),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT",
    );
  });

  it("handles not logged in gracefully (VAL-AUTH-009)", async () => {
    const dir = await createTempDir();
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    const { stdout } = await captureOutput(() => runLogoutCommand({ keychain }));
    assert.ok(stdout.includes("Not logged in"));
  });

  it("token never printed in logout output (VAL-AUTH-010)", async () => {
    const dir = await createTempDir();
    const clipDir = path.join(dir, "clip");
    await mkdir(clipDir, { recursive: true });
    await writeFile(path.join(clipDir, "credentials.json"), JSON.stringify({ token: TEST_TOKEN }), {
      mode: 0o600,
    });
    const keychain = new KeychainStore({
      configDir: dir,
      platform: "linux",
      interactive: true,
    });
    const { stdout, stderr } = await captureOutput(() => runLogoutCommand({ keychain }));
    assert.ok(!stdout.includes(TEST_TOKEN));
    assert.ok(!stderr.includes(TEST_TOKEN));
  });
});

// ---------------------------------------------------------------------------
// AuthError
// ---------------------------------------------------------------------------

describe("AuthError", () => {
  it("creates with message and name", () => {
    const err = new AuthError("test error");
    assert.equal(err.message, "test error");
    assert.equal(err.name, "AuthError");
    assert.ok(err instanceof Error);
  });
});
