import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { KeychainStore } from "../auth/keychain";
import { runInitCommand, TEMPLATE_OWNER, TEMPLATE_REPO } from "../commands/init";
import { ConfigStore } from "../config/store";
import { GitHubApiError, GitHubClient } from "../github/client";
import { GitDataApi } from "../github/git-data";

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
  const dir = await mkdtemp(path.join(os.tmpdir(), "clip-init-"));
  tempDirs.push(dir);
  return dir;
}

const TEST_TOKEN = "ghp_sentinel_init_token";
const TEST_LOGIN = "testuser";
const NEW_REPO_NAME = "my-clip-site";
const NEW_REPO_URL = `https://github.com/${TEST_LOGIN}/${NEW_REPO_NAME}`;

interface MockApiResponse {
  ok: boolean;
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

function createMockResponse(r: MockApiResponse): Response {
  const headerEntries = Object.entries(r.headers ?? {});
  return {
    ok: r.ok,
    status: r.status,
    headers: {
      get: (name: string) => {
        const found = headerEntries.find(([k]) => k.toLowerCase() === name.toLowerCase());
        return found ? found[1] : null;
      },
    },
    json: async () => r.body,
    text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
  } as unknown as Response;
}

interface MockFetchOptions {
  generateResponse?: MockApiResponse;
  handler?: (url: string, method: string, bodyJson: unknown) => MockApiResponse;
}

function createMockFetch(options: MockFetchOptions): {
  fetch: typeof fetch;
  requests: Array<{ url: string; method: string; bodyJson: unknown }>;
} {
  const requests: Array<{ url: string; method: string; bodyJson: unknown }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    let bodyJson: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        bodyJson = JSON.parse(init.body);
      } catch {
        // not JSON
      }
    }
    requests.push({ url, method, bodyJson });
    if (options.handler) {
      return createMockResponse(options.handler(url, method, bodyJson));
    }
    if (url.includes(`/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/generate`)) {
      return createMockResponse(
        options.generateResponse ?? {
          ok: true,
          status: 201,
          body: {
            id: 12345,
            name: NEW_REPO_NAME,
            full_name: `${TEST_LOGIN}/${NEW_REPO_NAME}`,
            html_url: NEW_REPO_URL,
            clone_url: `https://github.com/${TEST_LOGIN}/${NEW_REPO_NAME}.git`,
            default_branch: "main",
            private: false,
          },
        },
      );
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;
  return { fetch: fetchFn, requests };
}

function createFailingFetch(): typeof fetch {
  return (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
}

function createMockKeychain(options: { token?: string | null; configDir: string }): KeychainStore {
  // Use the file fallback (non-macOS, non-interactive) so the token can be
  // seeded via the credentials file without touching the real Keychain.
  const store = new KeychainStore({
    configDir: options.configDir,
    platform: "linux",
    interactive: true,
  });
  return store;
}

async function seedToken(configDir: string, token: string): Promise<void> {
  const clipDir = path.join(configDir, "clip");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(clipDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(clipDir, "credentials.json"), JSON.stringify({ token }), {
    mode: 0o600,
  });
}

function createPromptFn(
  returnValue: string,
): (opts: { message: string; default?: string }) => Promise<string> {
  return async (opts: { message: string; default?: string }) => {
    // Echo the default so tests can assert it was passed.
    promptCalls.push({ message: opts.message, default: opts.default });
    return returnValue;
  };
}

const promptCalls: Array<{ message: string; default?: string }> = [];

function resetPromptCalls(): void {
  promptCalls.length = 0;
}

async function captureOutput(fn: () => Promise<void>): Promise<{ stdout: string }> {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await fn();
    return { stdout: lines.join("\n") };
  } finally {
    console.log = originalLog;
  }
}

function createClientFactory(fetchFn: typeof fetch): (token: string) => GitHubClient {
  return (token: string) =>
    new GitHubClient({
      token,
      owner: TEMPLATE_OWNER,
      repo: TEMPLATE_REPO,
      fetchFn,
    });
}

// ---------------------------------------------------------------------------
// GitDataApi.generateRepo
// ---------------------------------------------------------------------------

describe("GitDataApi.generateRepo", () => {
  it("POSTs to /repos/{owner}/{repo}/generate with name and private flag", async () => {
    const { fetch, requests } = createMockFetch({});
    const client = new GitHubClient({
      token: TEST_TOKEN,
      owner: TEMPLATE_OWNER,
      repo: TEMPLATE_REPO,
      fetchFn: fetch,
    });
    const gitData = new GitDataApi(client);
    const repo = await gitData.generateRepo(TEMPLATE_OWNER, TEMPLATE_REPO, {
      name: NEW_REPO_NAME,
      private: false,
    });
    assert.equal(repo.name, NEW_REPO_NAME);
    assert.equal(repo.html_url, NEW_REPO_URL);
    assert.equal(requests.length, 1);
    const req = requests[0];
    assert.ok(req);
    assert.equal(req.method, "POST");
    assert.ok(req.url.includes(`/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/generate`));
    assert.equal((req.bodyJson as { name: string }).name, NEW_REPO_NAME);
    assert.equal((req.bodyJson as { private: boolean }).private, false);
  });

  it("throws GitHubApiError on 422 (repo exists)", async () => {
    const { fetch } = createMockFetch({
      generateResponse: {
        ok: false,
        status: 422,
        body: { message: "name already exists on this account" },
      },
    });
    const client = new GitHubClient({
      token: TEST_TOKEN,
      owner: TEMPLATE_OWNER,
      repo: TEMPLATE_REPO,
      fetchFn: fetch,
    });
    const gitData = new GitDataApi(client);
    await assert.rejects(
      () => gitData.generateRepo(TEMPLATE_OWNER, TEMPLATE_REPO, { name: NEW_REPO_NAME }),
      (err: unknown) => {
        assert.ok(err instanceof GitHubApiError);
        assert.equal(err.status, 422);
        // Token must not appear in the error message.
        assert.ok(!err.message.includes(TEST_TOKEN));
        return true;
      },
    );
  });

  it("throws GitHubApiError on network failure (no token leaked)", async () => {
    const client = new GitHubClient({
      token: TEST_TOKEN,
      owner: TEMPLATE_OWNER,
      repo: TEMPLATE_REPO,
      fetchFn: createFailingFetch(),
    });
    const gitData = new GitDataApi(client);
    await assert.rejects(
      () => gitData.generateRepo(TEMPLATE_OWNER, TEMPLATE_REPO, { name: NEW_REPO_NAME }),
      (err: unknown) => {
        assert.ok(err instanceof GitHubApiError);
        assert.ok(err.message.includes("Could not connect"));
        assert.ok(!err.message.includes(TEST_TOKEN));
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// runInitCommand
// ---------------------------------------------------------------------------

describe("runInitCommand", () => {
  it("creates a repo from the template (VAL-INIT-001)", async () => {
    const dir = await createTempDir();
    await seedToken(dir, TEST_TOKEN);
    const keychain = createMockKeychain({ token: TEST_TOKEN, configDir: dir });
    const configStore = new ConfigStore({ configDir: dir });
    const { fetch, requests } = createMockFetch({});
    resetPromptCalls();
    const { stdout } = await captureOutput(() =>
      runInitCommand({
        keychain,
        configStore,
        createClient: createClientFactory(fetch),
        promptRepoName: createPromptFn(NEW_REPO_NAME),
      }),
    );
    assert.equal(requests.length, 1, "should make exactly one API call");
    const req = requests[0];
    assert.ok(req);
    assert.equal(req.method, "POST");
    assert.ok(req.url.includes(`/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/generate`));
    assert.ok(stdout.includes(NEW_REPO_URL), "stdout should include the new repo URL");
  });

  it("auto-sets github.repo to the new repo name (VAL-INIT-002)", async () => {
    const dir = await createTempDir();
    await seedToken(dir, TEST_TOKEN);
    const keychain = createMockKeychain({ token: TEST_TOKEN, configDir: dir });
    const configStore = new ConfigStore({ configDir: dir });
    const { fetch } = createMockFetch({});
    resetPromptCalls();
    await runInitCommand({
      keychain,
      configStore,
      createClient: createClientFactory(fetch),
      promptRepoName: createPromptFn(NEW_REPO_NAME),
    });
    const repo = await configStore.get("github.repo");
    assert.equal(repo, NEW_REPO_NAME, "github.repo should be set to the new repo name");
    // Token must not be written into the config file.
    const configContent = await readFile(path.join(dir, "clip", "config.json"), "utf8");
    assert.ok(!configContent.includes(TEST_TOKEN), "token must not be stored in config");
  });

  it("requires authentication (VAL-INIT-003)", async () => {
    const dir = await createTempDir();
    const keychain = createMockKeychain({ token: null, configDir: dir });
    const configStore = new ConfigStore({ configDir: dir });
    const { fetch, requests } = createMockFetch({});
    resetPromptCalls();
    const { stdout } = await captureOutput(() =>
      runInitCommand({
        keychain,
        configStore,
        createClient: createClientFactory(fetch),
        promptRepoName: createPromptFn(NEW_REPO_NAME),
      }),
    );
    assert.ok(stdout.includes("Run `clip login` first."));
    assert.equal(requests.length, 0, "no API calls should be made without a token");
    assert.equal(promptCalls.length, 0, "no prompt should be shown without a token");
    assert.equal(process.exitCode, 1);
    process.exitCode = undefined;
  });

  it("prompts for repo name with default 'clip' (VAL-INIT-004)", async () => {
    const dir = await createTempDir();
    await seedToken(dir, TEST_TOKEN);
    const keychain = createMockKeychain({ token: TEST_TOKEN, configDir: dir });
    const configStore = new ConfigStore({ configDir: dir });
    const { fetch, requests } = createMockFetch({});
    resetPromptCalls();
    await runInitCommand({
      keychain,
      configStore,
      createClient: createClientFactory(fetch),
      promptRepoName: createPromptFn(TEMPLATE_REPO),
    });
    assert.equal(promptCalls.length, 1, "should prompt exactly once");
    const call = promptCalls[0];
    assert.ok(call);
    assert.equal(call.default, TEMPLATE_REPO, "prompt default should be 'clip'");
    // The API request should use the prompted name (which accepted the default).
    const req = requests[0];
    assert.ok(req);
    assert.equal((req.bodyJson as { name: string }).name, TEMPLATE_REPO);
  });

  it("handles existing repo name with 422 (VAL-INIT-005)", async () => {
    const dir = await createTempDir();
    await seedToken(dir, TEST_TOKEN);
    const keychain = createMockKeychain({ token: TEST_TOKEN, configDir: dir });
    const configStore = new ConfigStore({ configDir: dir });
    const { fetch, requests } = createMockFetch({
      generateResponse: {
        ok: false,
        status: 422,
        body: { message: "name already exists on this account" },
      },
    });
    resetPromptCalls();
    const { stdout } = await captureOutput(() =>
      runInitCommand({
        keychain,
        configStore,
        createClient: createClientFactory(fetch),
        promptRepoName: createPromptFn(NEW_REPO_NAME),
      }),
    );
    assert.ok(
      stdout.includes("Repository already exists. Try a different name."),
      "should print the existing-repo error",
    );
    assert.equal(requests.length, 1, "should have attempted the generate call once");
    // github.repo must NOT be set when the repo already exists.
    const repo = await configStore.get("github.repo");
    assert.equal(repo, "", "github.repo should remain empty on 422");
    assert.equal(process.exitCode, 1);
    process.exitCode = undefined;
  });

  it("handles other errors with meaningful message (no token leaked)", async () => {
    const dir = await createTempDir();
    await seedToken(dir, TEST_TOKEN);
    const keychain = createMockKeychain({ token: TEST_TOKEN, configDir: dir });
    const configStore = new ConfigStore({ configDir: dir });
    const { fetch } = createMockFetch({
      generateResponse: {
        ok: false,
        status: 403,
        body: { message: "Resource not accessible by personal access token" },
      },
    });
    resetPromptCalls();
    const { stdout } = await captureOutput(() =>
      runInitCommand({
        keychain,
        configStore,
        createClient: createClientFactory(fetch),
        promptRepoName: createPromptFn(NEW_REPO_NAME),
      }),
    );
    assert.ok(stdout.length > 0, "should print some error message");
    assert.ok(!stdout.includes(TEST_TOKEN), "token must not appear in output");
    assert.equal(process.exitCode, 1);
    process.exitCode = undefined;
  });

  it("handles network failure with meaningful error (no token leaked)", async () => {
    const dir = await createTempDir();
    await seedToken(dir, TEST_TOKEN);
    const keychain = createMockKeychain({ token: TEST_TOKEN, configDir: dir });
    const configStore = new ConfigStore({ configDir: dir });
    resetPromptCalls();
    const { stdout } = await captureOutput(() =>
      runInitCommand({
        keychain,
        configStore,
        createClient: createClientFactory(createFailingFetch()),
        promptRepoName: createPromptFn(NEW_REPO_NAME),
      }),
    );
    assert.ok(stdout.includes("Could not connect"));
    assert.ok(!stdout.includes(TEST_TOKEN));
    assert.equal(process.exitCode, 1);
    process.exitCode = undefined;
  });
});
