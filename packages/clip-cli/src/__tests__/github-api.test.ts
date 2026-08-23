import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitHubApiError, GitHubClient } from "../github/client";
import { GitDataApi } from "../github/git-data";
import type { TreeEntry } from "../github/git-data";
import { GitHubApiPublisher, GitHubPublishError } from "../publishers/github-api";
import { createPublisher } from "../publishers/index";
import { LocalGitPublisher } from "../publishers/local-git";
import type { Asset, PublishParams, Publisher } from "../publishers/types";

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
// Constants used across tests
// ---------------------------------------------------------------------------

const TEST_TOKEN = "ghp_sentinel_token_value";
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
// PublishParams / Asset helpers
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
 * Creates a mock fetch handler that responds to the full Git Data flow:
 * getRef → getCommit → createBlob(s) → createTree → createCommit → updateRef.
 * Also supports GET /user.
 */
function createFlowHandler(): (req: RecordedRequest) => MockApiResponse {
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
      const body = bodyJson as { content: string; encoding: string };
      const sha = body.encoding === "utf-8" ? MARKDOWN_BLOB_SHA : ASSET_BLOB_SHA;
      return {
        ok: true,
        status: 201,
        body: { url: "", sha, node_id: "blob-node" },
      };
    }

    if (method === "POST" && url.endsWith("/git/trees")) {
      return {
        ok: true,
        status: 201,
        body: { sha: NEW_TREE_SHA, url: "", tree: [] },
      };
    }

    if (method === "POST" && url.endsWith("/git/commits")) {
      return {
        ok: true,
        status: 201,
        body: { sha: NEW_COMMIT_SHA, url: "" },
      };
    }

    if (method === "PATCH" && url.includes("/git/refs/heads/")) {
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

    if (method === "GET" && url.endsWith("/user")) {
      return {
        ok: true,
        status: 200,
        body: { login: "testuser", id: 12345 },
      };
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };
}

// ---------------------------------------------------------------------------
// GitHubClient
// ---------------------------------------------------------------------------

describe("GitHubClient", () => {
  describe("headers", () => {
    it("sends Authorization Bearer token header", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await client.requestRepoJson<unknown>("GET", "/git/refs/heads/main");

      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.headers["Authorization"], `Bearer ${TEST_TOKEN}`);
    });

    it("sends Accept: application/vnd.github+json header", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await client.requestRepoJson<unknown>("GET", "/git/refs/heads/main");

      assert.equal(requests[0]!.headers["Accept"], "application/vnd.github+json");
    });

    it("sends X-GitHub-Api-Version header", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await client.requestRepoJson<unknown>("GET", "/git/refs/heads/main");

      assert.equal(requests[0]!.headers["X-GitHub-Api-Version"], "2022-11-28");
    });

    it("sends User-Agent: clip-cli header", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await client.requestRepoJson<unknown>("GET", "/git/refs/heads/main");

      assert.equal(requests[0]!.headers["User-Agent"], "clip-cli");
    });

    it("sends Content-Type: application/json when body is provided", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await client.requestRepoJson<unknown>("POST", "/git/blobs", {
        content: "hello",
        encoding: "utf-8",
      });

      assert.equal(requests[0]!.headers["Content-Type"], "application/json");
    });

    it("does not send Content-Type for GET requests without body", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await client.requestRepoJson<unknown>("GET", "/git/refs/heads/main");

      assert.equal(requests[0]!.headers["Content-Type"], undefined);
    });
  });

  describe("URL construction", () => {
    it("constructs repo-scoped URLs with owner and repo", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await client.requestRepoJson<unknown>("GET", "/git/refs/heads/main");

      assert.equal(
        requests[0]!.url,
        `https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/main`,
      );
    });

    it("constructs root-scoped URLs for non-repo paths", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await client.requestJson<unknown>("GET", "/user");

      assert.equal(requests[0]!.url, "https://api.github.com/user");
    });

    it("supports a custom base URL", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
        baseUrl: "https://api.github.example.com",
      });

      await client.requestJson<unknown>("GET", "/user");

      assert.equal(requests[0]!.url, "https://api.github.example.com/user");
    });
  });

  describe("error handling", () => {
    it("throws GitHubApiError on non-OK response with status in message", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 404,
        body: { message: "Not Found" },
      }));
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => client.requestRepoJson<unknown>("GET", "/git/refs/heads/main"),
        (err: unknown) => {
          assert.ok(err instanceof GitHubApiError);
          assert.equal(err.status, 404);
          assert.ok(err.message.includes("404"));
          assert.ok(err.message.includes("Not Found"));
          return true;
        },
      );
    });

    it("includes the API message in the error when available", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 403,
        body: { message: "Resource not accessible by integration" },
      }));
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => client.requestRepoJson<unknown>("GET", "/git/refs/heads/main"),
        (err: unknown) => {
          assert.ok(err instanceof GitHubApiError);
          assert.ok(err.message.includes("Resource not accessible by integration"));
          return true;
        },
      );
    });

    it("falls back to status-based message when body has no message", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 500,
        body: {},
      }));
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => client.requestRepoJson<unknown>("GET", "/git/refs/heads/main"),
        (err: unknown) => {
          assert.ok(err instanceof GitHubApiError);
          assert.ok(err.message.includes("500"));
          return true;
        },
      );
    });

    it("falls back to status-based message when body is not JSON", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 502,
        body: "Bad Gateway",
      }));
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      await assert.rejects(
        () => client.requestRepoJson<unknown>("GET", "/git/refs/heads/main"),
        (err: unknown) => {
          assert.ok(err instanceof GitHubApiError);
          assert.ok(err.message.includes("502"));
          return true;
        },
      );
    });

    it("throws GitHubApiError on network failure", async () => {
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: createFailingFetch(),
      });

      await assert.rejects(
        () => client.requestRepoJson<unknown>("GET", "/git/refs/heads/main"),
        (err: unknown) => {
          assert.ok(err instanceof GitHubApiError);
          assert.ok(err.message.includes("Could not connect"));
          return true;
        },
      );
    });

    it("never includes the token in error messages", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 401,
        body: { message: "Bad credentials" },
      }));
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      try {
        await client.requestRepoJson<unknown>("GET", "/git/refs/heads/main");
        assert.fail("should have thrown");
      } catch (err) {
        assert.ok(err instanceof GitHubApiError);
        assert.ok(!err.message.includes(TEST_TOKEN));
        assert.ok(!String(err.responseBody).includes(TEST_TOKEN));
      }
    });

    it("request() returns raw response without throwing on non-OK", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 404,
        body: { message: "Not Found" },
      }));
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });

      const response = await client.request("GET", "/git/refs/heads/main");
      assert.equal(response.ok, false);
      assert.equal(response.status, 404);
    });
  });
});

// ---------------------------------------------------------------------------
// GitDataApi
// ---------------------------------------------------------------------------

describe("GitDataApi", () => {
  describe("getRef", () => {
    it("sends GET /repos/{owner}/{repo}/git/refs/heads/{branch}", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      const ref = await api.getRef(BRANCH);

      assert.equal(ref.object.sha, BASE_COMMIT_SHA);
      assert.equal(requests[0]!.method, "GET");
      assert.ok(requests[0]!.url.includes(`/git/refs/heads/${BRANCH}`));
    });
  });

  describe("getCommit", () => {
    it("sends GET /repos/{owner}/{repo}/git/commits/{sha} and returns tree SHA", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      const commit = await api.getCommit(BASE_COMMIT_SHA);

      assert.equal(commit.sha, BASE_COMMIT_SHA);
      assert.equal(commit.tree.sha, BASE_TREE_SHA);
      assert.equal(requests[0]!.method, "GET");
      assert.ok(requests[0]!.url.includes(`/git/commits/${BASE_COMMIT_SHA}`));
    });
  });

  describe("createBlob", () => {
    it("sends POST /repos/{owner}/{repo}/git/blobs with content and encoding", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      const blob = await api.createBlob("hello world", "utf-8");

      assert.ok(blob.sha);
      assert.equal(requests[0]!.method, "POST");
      assert.ok(requests[0]!.url.endsWith("/git/blobs"));
      const body = requests[0]!.bodyJson as { content: string; encoding: string };
      assert.equal(body.content, "hello world");
      assert.equal(body.encoding, "utf-8");
    });

    it("accepts base64 encoding for binary content", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      const base64 = Buffer.from([0x89, 0x50]).toString("base64");
      await api.createBlob(base64, "base64");

      const body = requests[0]!.bodyJson as { content: string; encoding: string };
      assert.equal(body.encoding, "base64");
      assert.equal(body.content, base64);
    });
  });

  describe("createTree", () => {
    it("sends POST /repos/{owner}/{repo}/git/trees with base_tree and tree", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      const entries: TreeEntry[] = [
        {
          path: "apps/web/src/content/clips/test.md",
          mode: "100644",
          type: "blob",
          sha: MARKDOWN_BLOB_SHA,
        },
      ];
      const tree = await api.createTree(BASE_TREE_SHA, entries);

      assert.ok(tree.sha);
      assert.equal(requests[0]!.method, "POST");
      assert.ok(requests[0]!.url.endsWith("/git/trees"));
      const body = requests[0]!.bodyJson as {
        base_tree: string;
        tree: TreeEntry[];
      };
      assert.equal(body.base_tree, BASE_TREE_SHA);
      assert.equal(body.tree.length, 1);
      assert.equal(body.tree[0]!.mode, "100644");
    });

    it("accepts nested paths with 100644 mode", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      const entries: TreeEntry[] = [
        {
          path: "apps/web/public/clips/test-slug/favicon.png",
          mode: "100644",
          type: "blob",
          sha: ASSET_BLOB_SHA,
        },
      ];
      await api.createTree(BASE_TREE_SHA, entries);

      const body = requests[0]!.bodyJson as { tree: TreeEntry[] };
      assert.equal(body.tree[0]!.path, "apps/web/public/clips/test-slug/favicon.png");
      assert.equal(body.tree[0]!.mode, "100644");
    });
  });

  describe("createCommit", () => {
    it("sends POST /repos/{owner}/{repo}/git/commits with tree and parents", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      const commit = await api.createCommit(
        NEW_TREE_SHA,
        [BASE_COMMIT_SHA],
        ":sparkles: feat[clips]: add test clip",
      );

      assert.ok(commit.sha);
      assert.equal(requests[0]!.method, "POST");
      assert.ok(requests[0]!.url.endsWith("/git/commits"));
      const body = requests[0]!.bodyJson as {
        tree: string;
        parents: string[];
        message: string;
      };
      assert.equal(body.tree, NEW_TREE_SHA);
      assert.deepEqual(body.parents, [BASE_COMMIT_SHA]);
      assert.equal(body.message, ":sparkles: feat[clips]: add test clip");
    });
  });

  describe("updateRef", () => {
    it("sends PATCH /repos/{owner}/{repo}/git/refs/heads/{branch} with sha and force", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      await api.updateRef(BRANCH, NEW_COMMIT_SHA, false);

      assert.equal(requests[0]!.method, "PATCH");
      assert.ok(requests[0]!.url.includes(`/git/refs/heads/${BRANCH}`));
      const body = requests[0]!.bodyJson as { sha: string; force: boolean };
      assert.equal(body.sha, NEW_COMMIT_SHA);
      assert.equal(body.force, false);
    });

    it("sends force: false for fast-forward only updates (VAL-REMOTE-016)", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      await api.updateRef(BRANCH, NEW_COMMIT_SHA, false);

      const body = requests[0]!.bodyJson as { force: boolean };
      assert.equal(body.force, false);
    });
  });

  describe("getUser", () => {
    it("sends GET /user and returns the user object", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      const user = await api.getUser();

      assert.equal(user.login, "testuser");
      assert.equal(user.id, 12345);
      assert.equal(requests[0]!.method, "GET");
      assert.ok(requests[0]!.url.endsWith("/user"));
    });

    it("throws GitHubApiError on 401 (invalid token)", async () => {
      const { fetch } = createMockFetch(() => ({
        ok: false,
        status: 401,
        body: { message: "Bad credentials" },
      }));
      const client = new GitHubClient({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        fetchFn: fetch,
      });
      const api = new GitDataApi(client);

      await assert.rejects(
        () => api.getUser(),
        (err: unknown) => {
          assert.ok(err instanceof GitHubApiError);
          assert.equal(err.status, 401);
          assert.ok(!err.message.includes(TEST_TOKEN));
          return true;
        },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// GitHubApiPublisher
// ---------------------------------------------------------------------------

describe("GitHubApiPublisher", () => {
  describe("Publisher interface (VAL-REMOTE-003)", () => {
    it("implements the Publisher interface", () => {
      const publisher: Publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: createMockFetch(createFlowHandler()).fetch,
      });
      assert.ok(publisher instanceof GitHubApiPublisher);
      assert.equal(typeof publisher.publish, "function");
    });

    it("returns mode: remote, committed: true, pushed: true, location: commit SHA", async () => {
      const { fetch } = createMockFetch(createFlowHandler());
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
      assert.equal(result.location, NEW_COMMIT_SHA);
    });
  });

  describe("full Git Data flow", () => {
    it("performs getRef → getCommit → createBlob → createTree → createCommit → updateRef", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      const methods = requests.map(
        (r) =>
          `${r.method} ${r.url.replace(/https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+/, "")}`,
      );
      // No assets: getRef, getCommit, 1 blob (markdown), createTree, createCommit, updateRef = 6
      assert.equal(methods.length, 6);
      assert.ok(methods[0]!.includes("GET /git/refs/heads/"));
      assert.ok(methods[1]!.includes("GET /git/commits/"));
      assert.ok(methods[2]!.includes("POST /git/blobs"));
      assert.ok(methods[3]!.includes("POST /git/trees"));
      assert.ok(methods[4]!.includes("POST /git/commits"));
      assert.ok(methods[5]!.includes("PATCH /git/refs/heads/"));
    });

    it("uses the base commit SHA from getRef as the parent in createCommit", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      const commitRequest = requests.find(
        (r) => r.url.endsWith("/git/commits") && r.method === "POST",
      );
      assert.ok(commitRequest);
      const body = commitRequest!.bodyJson as {
        tree: string;
        parents: string[];
      };
      assert.deepEqual(body.parents, [BASE_COMMIT_SHA]);
    });

    it("uses the base tree SHA from getCommit as base_tree in createTree", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      const treeRequest = requests.find((r) => r.url.endsWith("/git/trees") && r.method === "POST");
      assert.ok(treeRequest);
      const body = treeRequest!.bodyJson as { base_tree: string };
      assert.equal(body.base_tree, BASE_TREE_SHA);
    });

    it("uses the new tree SHA in createCommit", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      const commitRequest = requests.find(
        (r) => r.url.endsWith("/git/commits") && r.method === "POST",
      );
      assert.ok(commitRequest);
      const body = commitRequest!.bodyJson as { tree: string };
      assert.equal(body.tree, NEW_TREE_SHA);
    });

    it("uses the new commit SHA in updateRef", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      const patchRequest = requests.find(
        (r) => r.method === "PATCH" && r.url.includes("/git/refs/heads/"),
      );
      assert.ok(patchRequest);
      const body = patchRequest!.bodyJson as { sha: string };
      assert.equal(body.sha, NEW_COMMIT_SHA);
    });
  });

  describe("markdown encoding (VAL-REMOTE-015)", () => {
    it("sends markdown as UTF-8 text with encoding: utf-8", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const markdown = "---\nkind: note\nslug: unicode-test\n---\n\nHéllo Wörld 🌍\n";
      await publisher.publish(makeParams({ markdownContent: markdown }));

      const blobRequests = requests.filter(
        (r) => r.url.endsWith("/git/blobs") && r.method === "POST",
      );
      assert.ok(blobRequests.length >= 1);

      const markdownBlob = blobRequests.find((r) => {
        const body = r.bodyJson as { encoding: string };
        return body.encoding === "utf-8";
      });
      assert.ok(markdownBlob);
      const body = markdownBlob!.bodyJson as { content: string; encoding: string };
      assert.equal(body.encoding, "utf-8");
      assert.equal(body.content, markdown);
    });

    it("round-trips Unicode content exactly", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const unicode = "---\nkind: note\n---\n\n日本語テスト — café — naïve\n";
      await publisher.publish(makeParams({ markdownContent: unicode }));

      const blobRequests = requests.filter(
        (r) => r.url.endsWith("/git/blobs") && r.method === "POST",
      );
      const markdownBlob = blobRequests.find((r) => {
        const body = r.bodyJson as { encoding: string };
        return body.encoding === "utf-8";
      });
      assert.ok(markdownBlob);
      const body = markdownBlob!.bodyJson as { content: string };
      assert.equal(body.content, unicode);
    });
  });

  describe("binary asset encoding (VAL-REMOTE-014)", () => {
    it("sends binary assets as base64 with encoding: base64", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const assetBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await publisher.publish(makeParams({ assets: [makeAsset({ buffer: assetBuffer })] }));

      const blobRequests = requests.filter(
        (r) => r.url.endsWith("/git/blobs") && r.method === "POST",
      );
      // 1 markdown (utf-8) + 1 asset (base64)
      assert.equal(blobRequests.length, 2);

      const assetBlob = blobRequests.find((r) => {
        const body = r.bodyJson as { encoding: string };
        return body.encoding === "base64";
      });
      assert.ok(assetBlob);
      const body = assetBlob!.bodyJson as { content: string; encoding: string };
      assert.equal(body.encoding, "base64");
      assert.equal(body.content, assetBuffer.toString("base64"));
    });

    it("base64 content decodes byte-for-byte to the original buffer", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const assetBuffer = Buffer.from([0x00, 0xff, 0x80, 0x7f, 0x01, 0x02, 0x03, 0xfe]);
      await publisher.publish(makeParams({ assets: [makeAsset({ buffer: assetBuffer })] }));

      const blobRequests = requests.filter(
        (r) => r.url.endsWith("/git/blobs") && r.method === "POST",
      );
      const assetBlob = blobRequests.find((r) => {
        const body = r.bodyJson as { encoding: string };
        return body.encoding === "base64";
      });
      assert.ok(assetBlob);
      const body = assetBlob!.bodyJson as { content: string };
      const decoded = Buffer.from(body.content, "base64");
      assert.deepEqual(decoded, assetBuffer);
    });
  });

  describe("createTree entries (VAL-REMOTE-013)", () => {
    it("uses base_tree and includes markdown with 100644 mode", async () => {
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
      const body = treeRequest!.bodyJson as {
        base_tree: string;
        tree: TreeEntry[];
      };
      assert.equal(body.base_tree, BASE_TREE_SHA);
      const mdEntry = body.tree.find((e) => e.path === markdownPath);
      assert.ok(mdEntry);
      assert.equal(mdEntry.mode, "100644");
      assert.equal(mdEntry.type, "blob");
      assert.equal(mdEntry.sha, MARKDOWN_BLOB_SHA);
    });

    it("accepts nested asset paths with 100644 mode", async () => {
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
      const body = treeRequest!.bodyJson as { tree: TreeEntry[] };
      const assetEntry = body.tree.find((e) => e.path === assetPath);
      assert.ok(assetEntry);
      assert.equal(assetEntry.mode, "100644");
      assert.equal(assetEntry.type, "blob");
      assert.equal(assetEntry.sha, ASSET_BLOB_SHA);
    });
  });

  describe("updateRef fast-forward (VAL-REMOTE-016)", () => {
    it("sends force: false in the ref update", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      const patchRequest = requests.find(
        (r) => r.method === "PATCH" && r.url.includes("/git/refs/heads/"),
      );
      assert.ok(patchRequest);
      const body = patchRequest!.bodyJson as { sha: string; force: boolean };
      assert.equal(body.force, false);
    });

    it("never sends force: true", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams());

      const patchRequest = requests.find(
        (r) => r.method === "PATCH" && r.url.includes("/git/refs/heads/"),
      );
      assert.ok(patchRequest);
      const body = patchRequest!.bodyJson as { force: boolean };
      assert.equal(body.force, false);
    });
  });

  describe("no-assets clip (VAL-REMOTE-017)", () => {
    it("publishes with only a markdown blob, no asset blob requests", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const result = await publisher.publish(makeParams({ assets: [] }));

      const blobRequests = requests.filter(
        (r) => r.url.endsWith("/git/blobs") && r.method === "POST",
      );
      assert.equal(blobRequests.length, 1); // only markdown

      const body = blobRequests[0]!.bodyJson as { encoding: string };
      assert.equal(body.encoding, "utf-8");

      assert.equal(result.mode, "remote");
      assert.equal(result.location, NEW_COMMIT_SHA);
    });

    it("creates a valid tree with only the markdown entry", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams({ assets: [] }));

      const treeRequest = requests.find((r) => r.url.endsWith("/git/trees") && r.method === "POST");
      assert.ok(treeRequest);
      const body = treeRequest!.bodyJson as { tree: TreeEntry[] };
      assert.equal(body.tree.length, 1);
    });
  });

  describe("multiple assets (VAL-REMOTE-018)", () => {
    it("creates blobs for all assets and includes them in one tree and one commit", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const assets = [
        makeAsset({ filename: "favicon.png", path: "apps/web/public/clips/slug/favicon.png" }),
        makeAsset({ filename: "og-image.png", path: "apps/web/public/clips/slug/og-image.png" }),
        makeAsset({ filename: "thumbnail.jpg", path: "apps/web/public/clips/slug/thumbnail.jpg" }),
      ];
      await publisher.publish(makeParams({ assets }));

      // 1 markdown + 3 assets = 4 blob requests
      const blobRequests = requests.filter(
        (r) => r.url.endsWith("/git/blobs") && r.method === "POST",
      );
      assert.equal(blobRequests.length, 4);

      // 1 tree with 4 entries
      const treeRequest = requests.find((r) => r.url.endsWith("/git/trees") && r.method === "POST");
      assert.ok(treeRequest);
      const treeBody = treeRequest!.bodyJson as { tree: TreeEntry[] };
      assert.equal(treeBody.tree.length, 4);

      // 1 commit
      const commitRequests = requests.filter(
        (r) => r.url.endsWith("/git/commits") && r.method === "POST",
      );
      assert.equal(commitRequests.length, 1);

      // 1 ref update
      const patchRequests = requests.filter(
        (r) => r.method === "PATCH" && r.url.includes("/git/refs/heads/"),
      );
      assert.equal(patchRequests.length, 1);
    });

    it("all assets use base64 encoding", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const assets = [
        makeAsset({ filename: "a.png", path: "apps/web/public/clips/slug/a.png" }),
        makeAsset({ filename: "b.png", path: "apps/web/public/clips/slug/b.png" }),
      ];
      await publisher.publish(makeParams({ assets }));

      const blobRequests = requests.filter(
        (r) => r.url.endsWith("/git/blobs") && r.method === "POST",
      );
      const base64Blobs = blobRequests.filter((r) => {
        const body = r.bodyJson as { encoding: string };
        return body.encoding === "base64";
      });
      assert.equal(base64Blobs.length, 2);
    });
  });

  describe("dry run", () => {
    it("makes no API calls on dry run", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      await publisher.publish(makeParams({ dryRun: true }));

      assert.equal(requests.length, 0);
    });

    it("returns committed: false and pushed: false on dry run", async () => {
      const { fetch } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const result = await publisher.publish(makeParams({ dryRun: true }));

      assert.equal(result.mode, "remote");
      assert.equal(result.committed, false);
      assert.equal(result.pushed, false);
    });
  });

  describe("token safety", () => {
    it("never includes the token in error messages", async () => {
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
        assert.ok(!err.message.includes(TEST_TOKEN));
      }
    });

    it("never includes the token in 403 error messages", async () => {
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
        assert.ok(!err.message.includes(TEST_TOKEN));
      }
    });
  });

  describe("commit message", () => {
    it("passes the commit message through to createCommit", async () => {
      const { fetch, requests } = createMockFetch(createFlowHandler());
      const publisher = new GitHubApiPublisher({
        token: TEST_TOKEN,
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        fetchFn: fetch,
      });

      const message = ":sparkles: feat[clips]: add test-slug note clip";
      await publisher.publish(makeParams({ commitMessage: message }));

      const commitRequest = requests.find(
        (r) => r.url.endsWith("/git/commits") && r.method === "POST",
      );
      assert.ok(commitRequest);
      const body = commitRequest!.bodyJson as { message: string };
      assert.equal(body.message, message);
    });
  });
});

// ---------------------------------------------------------------------------
// Publisher factory (updated for GitHubApiPublisher)
// ---------------------------------------------------------------------------

describe("createPublisher factory with GitHubApiPublisher", () => {
  it("returns LocalGitPublisher when no token", () => {
    const publisher = createPublisher({
      repoRoot: "/tmp/fake",
      local: false,
      token: null,
    });
    assert.ok(publisher instanceof LocalGitPublisher);
  });

  it("returns LocalGitPublisher when --local flag is set even with a token", () => {
    const publisher = createPublisher({
      repoRoot: "/tmp/fake",
      local: true,
      token: TEST_TOKEN,
    });
    assert.ok(publisher instanceof LocalGitPublisher);
  });

  it("returns GitHubApiPublisher when token and github config are provided (VAL-REMOTE-004)", () => {
    const publisher = createPublisher({
      repoRoot: "/tmp/fake",
      local: false,
      token: TEST_TOKEN,
      github: { owner: OWNER, repo: REPO, branch: BRANCH },
    });
    assert.ok(publisher instanceof GitHubApiPublisher);
  });

  it("throws when token is present but github config is missing", () => {
    assert.throws(
      () =>
        createPublisher({
          repoRoot: "/tmp/fake",
          local: false,
          token: TEST_TOKEN,
        }),
      /GitHub configuration/i,
    );
  });

  it("returned GitHubApiPublisher can be used as the Publisher interface", async () => {
    const publisher: Publisher = createPublisher({
      repoRoot: "/tmp/fake",
      local: false,
      token: TEST_TOKEN,
      github: { owner: OWNER, repo: REPO, branch: BRANCH },
    });

    // Verify the interface shape via dryRun (no API calls)
    const result = await publisher.publish(makeParams({ dryRun: true }));
    assert.equal(result.mode, "remote");
    assert.equal(result.committed, false);
    assert.equal(result.pushed, false);
  });
});
