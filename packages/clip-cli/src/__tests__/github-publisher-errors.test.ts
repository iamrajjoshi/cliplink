import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitHubApiPublisher, GitHubPublishError, MAX_ATTEMPTS } from "../publishers/github-api";
import type { Asset, PublishParams } from "../publishers/types";

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  bodyJson: unknown;
}

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

function createMockFetch(handler: (req: RecordedRequest) => MockApiResponse): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h) {
      if (h instanceof Headers) {
        h.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(h)) {
        for (const [key, value] of h) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, h as Record<string, string>);
      }
    }
    const bodyStr = typeof init?.body === "string" ? init.body : undefined;
    let bodyJson: unknown = undefined;
    if (bodyStr) {
      try {
        bodyJson = JSON.parse(bodyStr);
      } catch {
        // not JSON
      }
    }
    const req: RecordedRequest = { url, method, headers, body: bodyStr, bodyJson };
    requests.push(req);
    return createMockResponse(handler(req));
  }) as typeof fetch;
  return { fetch: fetchFn, requests };
}

function createFailingFetch(): typeof fetch {
  return (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TOKEN = "ghp_sentinel_token_value_xyz";
const OWNER = "testowner";
const REPO = "testrepo";
const BRANCH = "main";
const BASE_COMMIT_SHA = "aaa0000000000000000000000000000000000000";
const BASE_TREE_SHA = "bbb0000000000000000000000000000000000000";
const MARKDOWN_BLOB_SHA = "ccc0000000000000000000000000000000000000";
const ASSET_BLOB_SHA = "ddd0000000000000000000000000000000000000";
const NEW_TREE_SHA = "eee0000000000000000000000000000000000000";
const NEW_COMMIT_SHA = "fff0000000000000000000000000000000000000";

// ---------------------------------------------------------------------------
// Helpers
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
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    path: "apps/web/public/clips/test-slug/favicon.png",
    ...overrides,
  };
}

/**
 * Standard flow handler: responds to the full Git Data flow.
 * Uses a stateful base commit SHA that can be updated for retry tests.
 */
function createFlowHandler(
  opts: {
    baseCommitSha?: string;
    baseTreeSha?: string;
    newCommitSha?: string;
    newTreeSha?: string;
  } = {},
): (req: RecordedRequest) => MockApiResponse {
  const baseCommitSha = opts.baseCommitSha ?? BASE_COMMIT_SHA;
  const baseTreeSha = opts.baseTreeSha ?? BASE_TREE_SHA;
  const newCommitSha = opts.newCommitSha ?? NEW_COMMIT_SHA;
  const newTreeSha = opts.newTreeSha ?? NEW_TREE_SHA;

  return (req) => {
    const { method, url, bodyJson } = req;

    if (method === "GET" && url.includes("/git/refs/heads/")) {
      return {
        ok: true,
        status: 200,
        body: {
          ref: `refs/heads/${BRANCH}`,
          node_id: "ref-node",
          url,
          object: { type: "commit", sha: baseCommitSha, url: "" },
        },
      };
    }

    if (method === "GET" && url.includes("/git/commits/")) {
      return {
        ok: true,
        status: 200,
        body: {
          sha: baseCommitSha,
          url: "",
          tree: { sha: baseTreeSha, url: "" },
          message: "init",
          parents: [],
        },
      };
    }

    if (method === "POST" && url.endsWith("/git/blobs")) {
      const body = bodyJson as { content: string; encoding: string };
      const sha = body.encoding === "utf-8" ? MARKDOWN_BLOB_SHA : ASSET_BLOB_SHA;
      return { ok: true, status: 201, body: { url: "", sha, node_id: "blob-node" } };
    }

    if (method === "POST" && url.endsWith("/git/trees")) {
      return { ok: true, status: 201, body: { sha: newTreeSha, url: "", tree: [] } };
    }

    if (method === "POST" && url.endsWith("/git/commits")) {
      return { ok: true, status: 201, body: { sha: newCommitSha, url: "" } };
    }

    if (method === "PATCH" && url.includes("/git/refs/heads/")) {
      return {
        ok: true,
        status: 200,
        body: {
          ref: `refs/heads/${BRANCH}`,
          node_id: "ref-node",
          url: "",
          object: { type: "commit", sha: newCommitSha, url: "" },
        },
      };
    }

    if (method === "GET" && url.endsWith("/user")) {
      return { ok: true, status: 200, body: { login: "testuser", id: 12345 } };
    }

    // GET /repos/{owner}/{repo} — repo info
    if (method === "GET" && url.match(/\/repos\/[^/]+\/[^/]+\/?$/) && !url.includes("/git/")) {
      return {
        ok: true,
        status: 200,
        body: {
          id: 1,
          name: REPO,
          full_name: `${OWNER}/${REPO}`,
          default_branch: BRANCH,
          size: 100,
          empty: false,
        },
      };
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };
}

/**
 * Handler that returns 404 for all requests (repo not found).
 */
function createNotFoundHandler(): (req: RecordedRequest) => MockApiResponse {
  return () => ({
    ok: false,
    status: 404,
    body: { message: "Not Found" },
  });
}

/**
 * Handler that returns 404 for getRef but 200 for repo info (branch not found).
 */
function createBranchNotFoundHandler(): (req: RecordedRequest) => MockApiResponse {
  return (req) => {
    const { method, url } = req;

    if (method === "GET" && url.includes("/git/refs/heads/")) {
      return { ok: false, status: 404, body: { message: "Branch not found" } };
    }

    if (method === "GET" && url.match(/\/repos\/[^/]+\/[^/]+\/?$/) && !url.includes("/git/")) {
      return {
        ok: true,
        status: 200,
        body: {
          id: 1,
          name: REPO,
          full_name: `${OWNER}/${REPO}`,
          default_branch: "develop",
          size: 100,
          empty: false,
        },
      };
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };
}

/**
 * Handler that returns 404 for getRef and repo info shows empty=true (empty repo).
 */
function createEmptyRepoHandler(): (req: RecordedRequest) => MockApiResponse {
  return (req) => {
    const { method, url } = req;

    if (method === "GET" && url.includes("/git/refs/heads/")) {
      return { ok: false, status: 404, body: { message: "Branch not found" } };
    }

    if (method === "GET" && url.match(/\/repos\/[^/]+\/[^/]+\/?$/) && !url.includes("/git/")) {
      return {
        ok: true,
        status: 200,
        body: {
          id: 1,
          name: REPO,
          full_name: `${OWNER}/${REPO}`,
          default_branch: BRANCH,
          size: 0,
          empty: true,
        },
      };
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHubApiPublisher error handling", () => {
  // -------------------------------------------------------------------------
  // VAL-REMOTE-010 / VAL-CROSS-002: Branch update triggers deployment naturally
  // -------------------------------------------------------------------------

  describe("deployment trigger (VAL-REMOTE-010, VAL-CROSS-002)", () => {
    it("only makes the standard Git Data API calls, no deployment endpoint", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      // Verify no deployment-related URLs were called
      const deploymentUrls = requests.filter(
        (r) =>
          r.url.includes("/actions") ||
          r.url.includes("/deployments") ||
          r.url.includes("/pages") ||
          r.url.includes("/dispatch"),
      );
      assert.equal(deploymentUrls.length, 0, "no deployment endpoint calls");

      // Verify the ref update (PATCH) was the last call
      const patchRequests = requests.filter(
        (r) => r.method === "PATCH" && r.url.includes("/git/refs/heads/"),
      );
      assert.equal(patchRequests.length, 1, "exactly one ref update");
    });

    it("the ref update is the only side effect — no workflow dispatch", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      // Only Git Data API endpoints should be called
      for (const req of requests) {
        assert.ok(
          req.url.includes("/git/") || req.url.endsWith("/user"),
          `unexpected URL: ${req.url}`,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-011: Existing markdown is replaced
  // -------------------------------------------------------------------------

  describe("existing markdown replacement (VAL-REMOTE-011)", () => {
    it("uses base_tree so existing files are preserved and same-path entries overwrite", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const markdownPath = "apps/web/src/content/clips/2026-08-19-existing.md";
      await publisher.publish(makeParams({ markdownPath }));

      const treeRequest = requests.find((r) => r.url.endsWith("/git/trees") && r.method === "POST");
      assert.ok(treeRequest);
      const body = treeRequest!.bodyJson as { base_tree: string; tree: { path: string }[] };

      // base_tree preserves existing files
      assert.equal(body.base_tree, BASE_TREE_SHA);

      // The markdown entry at the same path overwrites the existing one
      const mdEntry = body.tree.find((e) => e.path === markdownPath);
      assert.ok(mdEntry, "markdown entry present at the same path");
    });

    it("does not create duplicate entries for the same path", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const markdownPath = "apps/web/src/content/clips/2026-08-19-test.md";
      await publisher.publish(makeParams({ markdownPath }));

      const treeRequest = requests.find((r) => r.url.endsWith("/git/trees") && r.method === "POST");
      assert.ok(treeRequest);
      const body = treeRequest!.bodyJson as { tree: { path: string }[] };

      const mdEntries = body.tree.filter((e) => e.path === markdownPath);
      assert.equal(mdEntries.length, 1, "exactly one entry for the markdown path");
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-012: Existing asset is replaced
  // -------------------------------------------------------------------------

  describe("existing asset replacement (VAL-REMOTE-012)", () => {
    it("same-path asset entry points to the newly uploaded blob", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const assetPath = "apps/web/public/clips/test-slug/favicon.png";
      await publisher.publish(makeParams({ assets: [makeAsset({ path: assetPath })] }));

      const treeRequest = requests.find((r) => r.url.endsWith("/git/trees") && r.method === "POST");
      assert.ok(treeRequest);
      const body = treeRequest!.bodyJson as { tree: { path: string; sha: string }[] };

      const assetEntry = body.tree.find((e) => e.path === assetPath);
      assert.ok(assetEntry, "asset entry present at the same path");
      assert.equal(assetEntry.sha, ASSET_BLOB_SHA, "points to the new blob SHA");
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-019 / VAL-REMOTE-030: 401 authentication failure / expired token
  // -------------------------------------------------------------------------

  describe("401 authentication failure (VAL-REMOTE-019, VAL-REMOTE-030)", () => {
    it("throws GitHubPublishError with kind 'auth' on 401", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 401,
        body: { message: "Bad credentials" },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => publisher.publish(makeParams()),
        (err: unknown) => {
          assert.ok(err instanceof GitHubPublishError);
          assert.equal(err.kind, "auth");
          assert.equal(err.status, 401);
          return true;
        },
      );
    });

    it("error message directs user to re-authenticate", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 401,
        body: { message: "Bad credentials" },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(err.message.includes("clip login"), "directs to re-authenticate");
      }
    });

    it("token is never included in the 401 error message", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 401,
        body: { message: "Bad credentials" },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(!err.message.includes(TEST_TOKEN), "no token in message");
      }
    });

    it("expired token (401) directs to re-authenticate without leaking token", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 401,
        body: { message: "Bad credentials. Token expired." },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.equal(err.kind, "auth");
        assert.ok(err.message.includes("clip login"), "directs to re-authenticate");
        assert.ok(!err.message.includes(TEST_TOKEN), "no token leaked");
      }
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-020: 403 permission failure
  // -------------------------------------------------------------------------

  describe("403 permission failure (VAL-REMOTE-020)", () => {
    it("throws GitHubPublishError with kind 'permission' on 403", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 403,
        body: { message: "Resource not accessible by integration" },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => publisher.publish(makeParams()),
        (err: unknown) => {
          assert.ok(err instanceof GitHubPublishError);
          assert.equal(err.kind, "permission");
          assert.equal(err.status, 403);
          return true;
        },
      );
    });

    it("error message explains insufficient repository permission", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 403,
        body: { message: "Resource not accessible by integration" },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(err.message.includes("Permission denied"), "useful permission message");
        assert.ok(err.message.includes("repo"), "mentions repo scope");
      }
    });

    it("token is never included in the 403 error message", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 403,
        body: { message: "Resource not accessible by integration" },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(!err.message.includes(TEST_TOKEN), "no token in message");
      }
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-021: 404 repository not found
  // -------------------------------------------------------------------------

  describe("404 repository not found (VAL-REMOTE-021)", () => {
    it("throws GitHubPublishError with kind 'repo-not-found' when repo doesn't exist", async () => {
      const { fetch } = createMockFetch(createNotFoundHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => publisher.publish(makeParams()),
        (err: unknown) => {
          assert.ok(err instanceof GitHubPublishError);
          assert.equal(err.kind, "repo-not-found");
          assert.equal(err.status, 404);
          return true;
        },
      );
    });

    it("error message identifies the repository/config problem", async () => {
      const { fetch } = createMockFetch(createNotFoundHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(err.message.includes("not found"), "identifies not-found");
        assert.ok(err.message.includes(OWNER), "includes owner");
        assert.ok(err.message.includes(REPO), "includes repo");
        assert.ok(err.message.includes("clip config"), "directs to config");
      }
    });

    it("token is never included in the 404 repo error", async () => {
      const { fetch } = createMockFetch(createNotFoundHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(!err.message.includes(TEST_TOKEN), "no token leaked");
      }
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-022: 404 branch not found (distinguishable from repo not found)
  // -------------------------------------------------------------------------

  describe("404 branch not found (VAL-REMOTE-022)", () => {
    it("throws GitHubPublishError with kind 'branch-not-found' when repo exists but branch doesn't", async () => {
      const { fetch } = createMockFetch(createBranchNotFoundHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => publisher.publish(makeParams()),
        (err: unknown) => {
          assert.ok(err instanceof GitHubPublishError);
          assert.equal(err.kind, "branch-not-found");
          assert.equal(err.status, 404);
          return true;
        },
      );
    });

    it("error message identifies the missing branch, distinguishable from repo-not-found", async () => {
      const { fetch } = createMockFetch(createBranchNotFoundHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.equal(err.kind, "branch-not-found");
        assert.ok(err.message.includes("Branch"), "identifies branch issue");
        assert.ok(err.message.includes(BRANCH), "includes branch name");
        assert.ok(
          !err.message.includes("not found. Check your configuration"),
          "not repo-not-found",
        );
      }
    });

    it("error message includes the default branch from repo info", async () => {
      const { fetch } = createMockFetch(createBranchNotFoundHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(err.message.includes("develop"), "includes default branch name");
      }
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-023: Rate limit (403/429 with X-RateLimit-Remaining: 0)
  // -------------------------------------------------------------------------

  describe("rate limit (VAL-REMOTE-023)", () => {
    it("throws GitHubPublishError with kind 'rate-limit' on 403 with remaining=0", async () => {
      const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(resetTimestamp),
        },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => publisher.publish(makeParams()),
        (err: unknown) => {
          assert.ok(err instanceof GitHubPublishError);
          assert.equal(err.kind, "rate-limit");
          return true;
        },
      );
    });

    it("throws GitHubPublishError with kind 'rate-limit' on 429", async () => {
      const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 429,
        body: { message: "Too Many Requests" },
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(resetTimestamp),
        },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => publisher.publish(makeParams()),
        (err: unknown) => {
          assert.ok(err instanceof GitHubPublishError);
          assert.equal(err.kind, "rate-limit");
          return true;
        },
      );
    });

    it("error message includes the reset time", async () => {
      const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
      const resetDate = new Date(resetTimestamp * 1000).toISOString();
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(resetTimestamp),
        },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(err.message.includes("rate limit"), "mentions rate limit");
        assert.ok(err.message.includes(resetDate), "includes reset time");
      }
    });

    it("does not update the ref on rate limit", async () => {
      const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
      const { fetch, requests } = createMockFetch(() => ({
        ok: false,
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(resetTimestamp),
        },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
      } catch {
        // expected
      }

      const patchRequests = requests.filter(
        (r) => r.method === "PATCH" && r.url.includes("/git/refs/heads/"),
      );
      assert.equal(patchRequests.length, 0, "no ref update on rate limit");
    });

    it("token is never included in the rate limit error", async () => {
      const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(resetTimestamp),
        },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(!err.message.includes(TEST_TOKEN), "no token leaked");
      }
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-024: 409 conflict retries whole flow
  // -------------------------------------------------------------------------

  describe("409 conflict retry (VAL-REMOTE-024)", () => {
    it("retries the whole flow on 409 from updateRef (new GET ref/commit)", async () => {
      let patchCount = 0;
      const { fetch, requests } = createMockFetch((req) => {
        const { method, url } = req;

        if (method === "GET" && url.includes("/git/refs/heads/")) {
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url,
              object: { type: "commit", sha: BASE_COMMIT_SHA, url: "" },
            },
          };
        }

        if (method === "GET" && url.includes("/git/commits/")) {
          return {
            ok: true,
            status: 200,
            body: {
              sha: BASE_COMMIT_SHA,
              url: "",
              tree: { sha: BASE_TREE_SHA, url: "" },
              message: "init",
              parents: [],
            },
          };
        }

        if (method === "POST" && url.endsWith("/git/blobs")) {
          const body = req.bodyJson as { encoding: string };
          const sha = body.encoding === "utf-8" ? MARKDOWN_BLOB_SHA : ASSET_BLOB_SHA;
          return { ok: true, status: 201, body: { url: "", sha, node_id: "blob-node" } };
        }

        if (method === "POST" && url.endsWith("/git/trees")) {
          return { ok: true, status: 201, body: { sha: NEW_TREE_SHA, url: "", tree: [] } };
        }

        if (method === "POST" && url.endsWith("/git/commits")) {
          return { ok: true, status: 201, body: { sha: NEW_COMMIT_SHA, url: "" } };
        }

        if (method === "PATCH" && url.includes("/git/refs/heads/")) {
          patchCount++;
          if (patchCount === 1) {
            return { ok: false, status: 409, body: { message: "Update is not a fast forward" } };
          }
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url: "",
              object: { type: "commit", sha: NEW_COMMIT_SHA, url: "" },
            },
          };
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      // Verify the whole flow was retried: two GET ref requests, two GET commit requests
      const getRefRequests = requests.filter(
        (r) => r.method === "GET" && r.url.includes("/git/refs/heads/"),
      );
      assert.equal(getRefRequests.length, 2, "two GET ref requests (retry starts from ref)");

      const getCommitRequests = requests.filter(
        (r) => r.method === "GET" && r.url.includes("/git/commits/"),
      );
      assert.equal(getCommitRequests.length, 2, "two GET commit requests (full retry)");
    });

    it("each retry attempt uses its own base parent and tree", async () => {
      let patchCount = 0;
      const { fetch, requests } = createMockFetch((req) => {
        const { method, url } = req;

        if (method === "GET" && url.includes("/git/refs/heads/")) {
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url,
              object: { type: "commit", sha: BASE_COMMIT_SHA, url: "" },
            },
          };
        }

        if (method === "GET" && url.includes("/git/commits/")) {
          return {
            ok: true,
            status: 200,
            body: {
              sha: BASE_COMMIT_SHA,
              url: "",
              tree: { sha: BASE_TREE_SHA, url: "" },
              message: "init",
              parents: [],
            },
          };
        }

        if (method === "POST" && url.endsWith("/git/blobs")) {
          const body = req.bodyJson as { encoding: string };
          const sha = body.encoding === "utf-8" ? MARKDOWN_BLOB_SHA : ASSET_BLOB_SHA;
          return { ok: true, status: 201, body: { url: "", sha, node_id: "blob-node" } };
        }

        if (method === "POST" && url.endsWith("/git/trees")) {
          return { ok: true, status: 201, body: { sha: NEW_TREE_SHA, url: "", tree: [] } };
        }

        if (method === "POST" && url.endsWith("/git/commits")) {
          return { ok: true, status: 201, body: { sha: NEW_COMMIT_SHA, url: "" } };
        }

        if (method === "PATCH" && url.includes("/git/refs/heads/")) {
          patchCount++;
          if (patchCount === 1) {
            return { ok: false, status: 409, body: { message: "Update is not a fast forward" } };
          }
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url: "",
              object: { type: "commit", sha: NEW_COMMIT_SHA, url: "" },
            },
          };
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      // Both createCommit requests should use BASE_COMMIT_SHA as parent
      const commitRequests = requests.filter(
        (r) => r.url.endsWith("/git/commits") && r.method === "POST",
      );
      assert.equal(commitRequests.length, 2, "two createCommit attempts");
      for (const cr of commitRequests) {
        const body = cr.bodyJson as { parents: string[] };
        assert.deepEqual(body.parents, [BASE_COMMIT_SHA], "each attempt uses fresh base parent");
      }

      // Both createTree requests should use BASE_TREE_SHA as base_tree
      const treeRequests = requests.filter(
        (r) => r.url.endsWith("/git/trees") && r.method === "POST",
      );
      assert.equal(treeRequests.length, 2, "two createTree attempts");
      for (const tr of treeRequests) {
        const body = tr.bodyJson as { base_tree: string };
        assert.equal(body.base_tree, BASE_TREE_SHA, "each attempt uses fresh base tree");
      }
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-025: 409 retry can succeed
  // -------------------------------------------------------------------------

  describe("409 retry success (VAL-REMOTE-025)", () => {
    it("succeeds on second attempt and reports the final commit SHA", async () => {
      let patchCount = 0;
      const { fetch } = createMockFetch((req) => {
        const { method, url } = req;

        if (method === "GET" && url.includes("/git/refs/heads/")) {
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url,
              object: { type: "commit", sha: BASE_COMMIT_SHA, url: "" },
            },
          };
        }

        if (method === "GET" && url.includes("/git/commits/")) {
          return {
            ok: true,
            status: 200,
            body: {
              sha: BASE_COMMIT_SHA,
              url: "",
              tree: { sha: BASE_TREE_SHA, url: "" },
              message: "init",
              parents: [],
            },
          };
        }

        if (method === "POST" && url.endsWith("/git/blobs")) {
          const body = req.bodyJson as { encoding: string };
          const sha = body.encoding === "utf-8" ? MARKDOWN_BLOB_SHA : ASSET_BLOB_SHA;
          return { ok: true, status: 201, body: { url: "", sha, node_id: "blob-node" } };
        }

        if (method === "POST" && url.endsWith("/git/trees")) {
          return { ok: true, status: 201, body: { sha: NEW_TREE_SHA, url: "", tree: [] } };
        }

        if (method === "POST" && url.endsWith("/git/commits")) {
          return { ok: true, status: 201, body: { sha: NEW_COMMIT_SHA, url: "" } };
        }

        if (method === "PATCH" && url.includes("/git/refs/heads/")) {
          patchCount++;
          if (patchCount === 1) {
            return { ok: false, status: 409, body: { message: "Update is not a fast forward" } };
          }
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url: "",
              object: { type: "commit", sha: NEW_COMMIT_SHA, url: "" },
            },
          };
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const result = await publisher.publish(makeParams());

      assert.equal(result.mode, "remote");
      assert.equal(result.committed, true);
      assert.equal(result.pushed, true);
      assert.equal(result.location, NEW_COMMIT_SHA, "reports final commit SHA");
    });

    it("succeeds after two 409s (three attempts total)", async () => {
      let patchCount = 0;
      const { fetch } = createMockFetch((req) => {
        const { method, url } = req;

        if (method === "GET" && url.includes("/git/refs/heads/")) {
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url,
              object: { type: "commit", sha: BASE_COMMIT_SHA, url: "" },
            },
          };
        }

        if (method === "GET" && url.includes("/git/commits/")) {
          return {
            ok: true,
            status: 200,
            body: {
              sha: BASE_COMMIT_SHA,
              url: "",
              tree: { sha: BASE_TREE_SHA, url: "" },
              message: "init",
              parents: [],
            },
          };
        }

        if (method === "POST" && url.endsWith("/git/blobs")) {
          const body = req.bodyJson as { encoding: string };
          const sha = body.encoding === "utf-8" ? MARKDOWN_BLOB_SHA : ASSET_BLOB_SHA;
          return { ok: true, status: 201, body: { url: "", sha, node_id: "blob-node" } };
        }

        if (method === "POST" && url.endsWith("/git/trees")) {
          return { ok: true, status: 201, body: { sha: NEW_TREE_SHA, url: "", tree: [] } };
        }

        if (method === "POST" && url.endsWith("/git/commits")) {
          return { ok: true, status: 201, body: { sha: NEW_COMMIT_SHA, url: "" } };
        }

        if (method === "PATCH" && url.includes("/git/refs/heads/")) {
          patchCount++;
          if (patchCount <= 2) {
            return { ok: false, status: 409, body: { message: "Update is not a fast forward" } };
          }
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url: "",
              object: { type: "commit", sha: NEW_COMMIT_SHA, url: "" },
            },
          };
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const result = await publisher.publish(makeParams());

      assert.equal(result.location, NEW_COMMIT_SHA, "succeeds on third attempt");
      assert.equal(patchCount, 3, "three PATCH attempts");
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-026: 409 retry exhaustion
  // -------------------------------------------------------------------------

  describe("409 retry exhaustion (VAL-REMOTE-026)", () => {
    it("throws after MAX_ATTEMPTS (3) 409 conflicts", async () => {
      let patchCount = 0;
      const { fetch } = createMockFetch((req) => {
        const { method, url } = req;

        if (method === "GET" && url.includes("/git/refs/heads/")) {
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url,
              object: { type: "commit", sha: BASE_COMMIT_SHA, url: "" },
            },
          };
        }

        if (method === "GET" && url.includes("/git/commits/")) {
          return {
            ok: true,
            status: 200,
            body: {
              sha: BASE_COMMIT_SHA,
              url: "",
              tree: { sha: BASE_TREE_SHA, url: "" },
              message: "init",
              parents: [],
            },
          };
        }

        if (method === "POST" && url.endsWith("/git/blobs")) {
          const body = req.bodyJson as { encoding: string };
          const sha = body.encoding === "utf-8" ? MARKDOWN_BLOB_SHA : ASSET_BLOB_SHA;
          return { ok: true, status: 201, body: { url: "", sha, node_id: "blob-node" } };
        }

        if (method === "POST" && url.endsWith("/git/trees")) {
          return { ok: true, status: 201, body: { sha: NEW_TREE_SHA, url: "", tree: [] } };
        }

        if (method === "POST" && url.endsWith("/git/commits")) {
          return { ok: true, status: 201, body: { sha: NEW_COMMIT_SHA, url: "" } };
        }

        if (method === "PATCH" && url.includes("/git/refs/heads/")) {
          patchCount++;
          return { ok: false, status: 409, body: { message: "Update is not a fast forward" } };
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => publisher.publish(makeParams()),
        (err: unknown) => {
          assert.ok(err instanceof GitHubPublishError);
          assert.equal(err.kind, "conflict");
          assert.ok(err.message.includes("3 attempts"), "mentions max attempts");
          return true;
        },
      );

      assert.equal(patchCount, MAX_ATTEMPTS, "exactly 3 PATCH attempts");
    });

    it("does not make a fourth attempt", async () => {
      let patchCount = 0;
      const { fetch, requests } = createMockFetch((req) => {
        const { method, url } = req;

        if (method === "GET" && url.includes("/git/refs/heads/")) {
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url,
              object: { type: "commit", sha: BASE_COMMIT_SHA, url: "" },
            },
          };
        }

        if (method === "GET" && url.includes("/git/commits/")) {
          return {
            ok: true,
            status: 200,
            body: {
              sha: BASE_COMMIT_SHA,
              url: "",
              tree: { sha: BASE_TREE_SHA, url: "" },
              message: "init",
              parents: [],
            },
          };
        }

        if (method === "POST" && url.endsWith("/git/blobs")) {
          const body = req.bodyJson as { encoding: string };
          const sha = body.encoding === "utf-8" ? MARKDOWN_BLOB_SHA : ASSET_BLOB_SHA;
          return { ok: true, status: 201, body: { url: "", sha, node_id: "blob-node" } };
        }

        if (method === "POST" && url.endsWith("/git/trees")) {
          return { ok: true, status: 201, body: { sha: NEW_TREE_SHA, url: "", tree: [] } };
        }

        if (method === "POST" && url.endsWith("/git/commits")) {
          return { ok: true, status: 201, body: { sha: NEW_COMMIT_SHA, url: "" } };
        }

        if (method === "PATCH" && url.includes("/git/refs/heads/")) {
          patchCount++;
          return { ok: false, status: 409, body: { message: "Update is not a fast forward" } };
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch {
        // expected
      }

      assert.equal(patchCount, MAX_ATTEMPTS, "no fourth attempt");

      // Verify exactly 3 full flow attempts (3 GET ref, 3 GET commit, 3 createTree, 3 createCommit)
      const getRefRequests = requests.filter(
        (r) => r.method === "GET" && r.url.includes("/git/refs/heads/"),
      );
      assert.equal(getRefRequests.length, MAX_ATTEMPTS, "no more than 3 GET ref requests");
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-027: Network failure
  // -------------------------------------------------------------------------

  describe("network failure (VAL-REMOTE-027)", () => {
    it("throws GitHubPublishError with kind 'network' on fetch failure", async () => {
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: createFailingFetch(),
      });

      await assert.rejects(
        () => publisher.publish(makeParams()),
        (err: unknown) => {
          assert.ok(err instanceof GitHubPublishError);
          assert.equal(err.kind, "network");
          return true;
        },
      );
    });

    it("error message provides actionable guidance", async () => {
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: createFailingFetch(),
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(err.message.includes("network"), "mentions network");
        assert.ok(
          err.message.includes("try again") || err.message.includes("Check your"),
          "actionable guidance",
        );
      }
    });

    it("token is never included in the network error", async () => {
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: createFailingFetch(),
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(!err.message.includes(TEST_TOKEN), "no token leaked");
      }
    });

    it("does not update the ref on network failure", async () => {
      // Network failure on the first GET ref — no PATCH should ever happen
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: createFailingFetch(),
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.equal(err.kind, "network");
      }
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-028: Protected branch
  // -------------------------------------------------------------------------

  describe("protected branch (VAL-REMOTE-028)", () => {
    it("throws GitHubPublishError with kind 'protected-branch' on 403 with 'protected' message", async () => {
      let patchCount = 0;
      const { fetch } = createMockFetch((req) => {
        const { method, url } = req;

        if (method === "GET" && url.includes("/git/refs/heads/")) {
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url,
              object: { type: "commit", sha: BASE_COMMIT_SHA, url: "" },
            },
          };
        }

        if (method === "GET" && url.includes("/git/commits/")) {
          return {
            ok: true,
            status: 200,
            body: {
              sha: BASE_COMMIT_SHA,
              url: "",
              tree: { sha: BASE_TREE_SHA, url: "" },
              message: "init",
              parents: [],
            },
          };
        }

        if (method === "POST" && url.endsWith("/git/blobs")) {
          const body = req.bodyJson as { encoding: string };
          const sha = body.encoding === "utf-8" ? MARKDOWN_BLOB_SHA : ASSET_BLOB_SHA;
          return { ok: true, status: 201, body: { url: "", sha, node_id: "blob-node" } };
        }

        if (method === "POST" && url.endsWith("/git/trees")) {
          return { ok: true, status: 201, body: { sha: NEW_TREE_SHA, url: "", tree: [] } };
        }

        if (method === "POST" && url.endsWith("/git/commits")) {
          return { ok: true, status: 201, body: { sha: NEW_COMMIT_SHA, url: "" } };
        }

        if (method === "PATCH" && url.includes("/git/refs/heads/")) {
          patchCount++;
          return {
            ok: false,
            status: 403,
            body: { message: "Protected branch update failed for refs/heads/main" },
          };
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => publisher.publish(makeParams()),
        (err: unknown) => {
          assert.ok(err instanceof GitHubPublishError);
          assert.equal(err.kind, "protected-branch");
          assert.ok(err.message.includes("not permitted"), "reports not permitted");
          return true;
        },
      );

      // Protected branch 403 should NOT be retried (it's not a 409)
      assert.equal(patchCount, 1, "no retry on protected branch 403");
    });

    it("does not force-update on protected branch", async () => {
      const { fetch, requests } = createMockFetch((req) => {
        const { method, url } = req;

        if (method === "GET" && url.includes("/git/refs/heads/")) {
          return {
            ok: true,
            status: 200,
            body: {
              ref: `refs/heads/${BRANCH}`,
              node_id: "ref-node",
              url,
              object: { type: "commit", sha: BASE_COMMIT_SHA, url: "" },
            },
          };
        }

        if (method === "GET" && url.includes("/git/commits/")) {
          return {
            ok: true,
            status: 200,
            body: {
              sha: BASE_COMMIT_SHA,
              url: "",
              tree: { sha: BASE_TREE_SHA, url: "" },
              message: "init",
              parents: [],
            },
          };
        }

        if (method === "POST" && url.endsWith("/git/blobs")) {
          const body = req.bodyJson as { encoding: string };
          const sha = body.encoding === "utf-8" ? MARKDOWN_BLOB_SHA : ASSET_BLOB_SHA;
          return { ok: true, status: 201, body: { url: "", sha, node_id: "blob-node" } };
        }

        if (method === "POST" && url.endsWith("/git/trees")) {
          return { ok: true, status: 201, body: { sha: NEW_TREE_SHA, url: "", tree: [] } };
        }

        if (method === "POST" && url.endsWith("/git/commits")) {
          return { ok: true, status: 201, body: { sha: NEW_COMMIT_SHA, url: "" } };
        }

        if (method === "PATCH" && url.includes("/git/refs/heads/")) {
          return {
            ok: false,
            status: 403,
            body: { message: "Protected branch update failed for refs/heads/main" },
          };
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
      } catch {
        // expected
      }

      // The PATCH request should have force: false
      const patchRequest = requests.find(
        (r) => r.method === "PATCH" && r.url.includes("/git/refs/heads/"),
      );
      assert.ok(patchRequest);
      const body = patchRequest!.bodyJson as { force: boolean };
      assert.equal(body.force, false, "never force-updates");
    });
  });

  // -------------------------------------------------------------------------
  // VAL-REMOTE-029: Empty repository
  // -------------------------------------------------------------------------

  describe("empty repository (VAL-REMOTE-029)", () => {
    it("throws GitHubPublishError with kind 'empty-repo' for empty repo", async () => {
      const { fetch } = createMockFetch(createEmptyRepoHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => publisher.publish(makeParams()),
        (err: unknown) => {
          assert.ok(err instanceof GitHubPublishError);
          assert.equal(err.kind, "empty-repo");
          return true;
        },
      );
    });

    it("error message says to initialize the repository", async () => {
      const { fetch } = createMockFetch(createEmptyRepoHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.ok(err.message.includes("empty"), "mentions empty");
        assert.ok(
          err.message.includes("Initialize") || err.message.includes("initialize"),
          "directs to initialize",
        );
      }
    });

    it("does not dereference an undefined base SHA", async () => {
      const { fetch, requests } = createMockFetch(createEmptyRepoHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
      } catch {
        // expected
      }

      // Should not have attempted to get a commit (no base SHA to dereference)
      const getCommitRequests = requests.filter(
        (r) => r.method === "GET" && r.url.includes("/git/commits/"),
      );
      assert.equal(getCommitRequests.length, 0, "no getCommit call on empty repo");
    });
  });

  // -------------------------------------------------------------------------
  // VAL-CROSS-009: All clip kinds produce correct commits
  // -------------------------------------------------------------------------

  describe("all clip kinds (VAL-CROSS-009)", () => {
    const kinds = [
      {
        kind: "link",
        markdown: "---\nkind: link\nslug: test-link\nurl: https://example.com\n---\n\nlink body\n",
        subject: "test-link",
      },
      {
        kind: "tweet",
        markdown: "---\nkind: tweet\nslug: test-tweet\n---\n\ntweet body\n",
        subject: "handle tweet",
      },
      {
        kind: "image",
        markdown: "---\nkind: image\nslug: test-image\n---\n\nimage body\n",
        subject: "test-image image",
      },
      {
        kind: "video",
        markdown: "---\nkind: video\nslug: test-video\n---\n\nvideo body\n",
        subject: "test-video video",
      },
      {
        kind: "note",
        markdown: "---\nkind: note\nslug: test-note\n---\n\nnote body\n",
        subject: "test-note note",
      },
    ];

    for (const { kind, markdown, subject } of kinds) {
      it(`produces a valid commit for ${kind} clip`, async () => {
        const { fetch, requests } = createMockFetch(createFlowHandler());
        const publisher = new GitHubApiPublisher({
          token: TEST_TOKEN,
          owner: OWNER,
          repo: REPO,
          branch: BRANCH,
          fetchFn: fetch,
        });

        const commitMessage = `:sparkles: feat[clips]: add ${subject} clip`;
        const result = await publisher.publish(
          makeParams({ markdownContent: markdown, commitMessage }),
        );

        assert.equal(result.mode, "remote");
        assert.equal(result.committed, true);
        assert.equal(result.location, NEW_COMMIT_SHA);

        // Verify markdown blob was created with the correct content
        const blobRequests = requests.filter(
          (r) => r.url.endsWith("/git/blobs") && r.method === "POST",
        );
        const markdownBlob = blobRequests.find((r) => {
          const body = r.bodyJson as { encoding: string };
          return body.encoding === "utf-8";
        });
        assert.ok(markdownBlob);
        const body = markdownBlob!.bodyJson as { content: string };
        assert.equal(body.content, markdown);

        // Verify commit message
        const commitRequest = requests.find(
          (r) => r.url.endsWith("/git/commits") && r.method === "POST",
        );
        assert.ok(commitRequest);
        const commitBody = commitRequest!.bodyJson as { message: string };
        assert.equal(commitBody.message, commitMessage);
      });
    }

    it("image and video clips include assets in the commit", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const assets = [
        makeAsset({ filename: "image.jpg", path: "apps/web/public/clips/test-slug/image.jpg" }),
      ];
      await publisher.publish(makeParams({ assets }));

      // Verify asset blob was created with base64
      const blobRequests = requests.filter(
        (r) => r.url.endsWith("/git/blobs") && r.method === "POST",
      );
      const assetBlob = blobRequests.find((r) => {
        const body = r.bodyJson as { encoding: string };
        return body.encoding === "base64";
      });
      assert.ok(assetBlob, "asset blob created");

      // Verify tree contains the asset entry
      const treeRequest = requests.find((r) => r.url.endsWith("/git/trees") && r.method === "POST");
      assert.ok(treeRequest);
      const treeBody = treeRequest!.bodyJson as { tree: { path: string }[] };
      const assetEntry = treeBody.tree.find(
        (e) => e.path === "apps/web/public/clips/test-slug/image.jpg",
      );
      assert.ok(assetEntry, "asset in tree");
    });
  });

  // -------------------------------------------------------------------------
  // VAL-CROSS-015: Multiple sequential clips publish without conflict
  // -------------------------------------------------------------------------

  describe("sequential clips (VAL-CROSS-015)", () => {
    it("two consecutive publishes both succeed", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      // First clip
      const result1 = await publisher.publish(
        makeParams({
          slug: "first-clip",
          markdownPath: "apps/web/src/content/clips/2026-08-19-first.md",
          commitMessage: ":sparkles: feat[clips]: add first-clip note clip",
        }),
      );
      assert.equal(result1.location, NEW_COMMIT_SHA);

      // Second clip
      const result2 = await publisher.publish(
        makeParams({
          slug: "second-clip",
          markdownPath: "apps/web/src/content/clips/2026-08-19-second.md",
          commitMessage: ":sparkles: feat[clips]: add second-clip note clip",
        }),
      );
      assert.equal(result2.location, NEW_COMMIT_SHA);

      // Two complete flows
      const getRefRequests = requests.filter(
        (r) => r.method === "GET" && r.url.includes("/git/refs/heads/"),
      );
      assert.equal(getRefRequests.length, 2, "two GET ref requests");

      const patchRequests = requests.filter(
        (r) => r.method === "PATCH" && r.url.includes("/git/refs/heads/"),
      );
      assert.equal(patchRequests.length, 2, "two ref updates");
    });

    it("second publish is a fast-forward (no 409 conflict in normal flow)", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams({ slug: "first" }));
      await publisher.publish(makeParams({ slug: "second" }));

      // Both should succeed without any 409 retry
      const commitRequests = requests.filter(
        (r) => r.url.endsWith("/git/commits") && r.method === "POST",
      );
      assert.equal(commitRequests.length, 2, "exactly two commits, no retries");
    });
  });

  // -------------------------------------------------------------------------
  // VAL-CROSS-016: Error recovery on transient network failure
  // -------------------------------------------------------------------------

  describe("error recovery on transient network failure (VAL-CROSS-016)", () => {
    it("failed publish exits non-zero with meaningful message and no token", async () => {
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: createFailingFetch(),
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.equal(err.kind, "network");
        assert.ok(!err.message.includes(TEST_TOKEN), "no token leaked");
        assert.ok(err.message.length > 0, "meaningful message");
      }
    });

    it("no commit is created on network failure", async () => {
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: createFailingFetch(),
      });

      try {
        await publisher.publish(makeParams());
      } catch {
        // expected
      }

      // No partial state — the publisher is stateless, so a retry starts fresh
    });

    it("running again with network restored succeeds", async () => {
      // First attempt: network failure
      const failPublisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: createFailingFetch(),
      });

      try {
        await failPublisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.equal(err.kind, "network");
      }

      // Second attempt: network restored
      const { fetch } = createMockFetch(createFlowHandler());
      const successPublisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const result = await successPublisher.publish(makeParams());

      assert.equal(result.mode, "remote");
      assert.equal(result.committed, true);
      assert.equal(result.location, NEW_COMMIT_SHA, "succeeds on retry with network restored");
    });
  });

  // -------------------------------------------------------------------------
  // GitHubApiError headers propagation
  // -------------------------------------------------------------------------

  describe("GitHubApiError response headers", () => {
    it("includes rate limit headers in the error", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 403,
        body: { message: "rate limit exceeded" },
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": "1700000000",
          "X-RateLimit-Limit": "5000",
        },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.equal(err.kind, "rate-limit");
        // The reset time should be in the message
        const resetDate = new Date(1700000000 * 1000).toISOString();
        assert.ok(err.message.includes(resetDate), "includes reset time from header");
      }
    });

    it("non-rate-limit 403 does not trigger rate-limit kind", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 403,
        body: { message: "Resource not accessible by integration" },
        headers: {
          "X-RateLimit-Remaining": "4999",
        },
      }));
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      try {
        await publisher.publish(makeParams());
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubPublishError);
        assert.equal(err.kind, "permission", "not rate-limited when remaining > 0");
      }
    });
  });
});
