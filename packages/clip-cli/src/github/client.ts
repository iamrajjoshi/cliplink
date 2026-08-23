// GitHub REST API client wrapping fetch with proper headers.
// The token is never printed, logged, or included in error messages.

export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const USER_AGENT = "clip-cli";

export interface GitHubClientOptions {
  token: string;
  owner: string;
  repo: string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export interface GitHubUser {
  login: string;
  id: number;
  name?: string;
  avatar_url?: string;
  html_url?: string;
}

/**
 * Error thrown when a GitHub API request fails.
 * The token is never included in the error message.
 */
export class GitHubApiError extends Error {
  readonly status: number;
  readonly responseBody: unknown;
  readonly responseHeaders: Record<string, string | null>;

  constructor(
    message: string,
    status: number,
    responseBody?: unknown,
    responseHeaders?: Record<string, string | null>,
  ) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.responseBody = responseBody;
    this.responseHeaders = responseHeaders ?? {};
  }
}

/**
 * Low-level GitHub REST API client. Wraps `fetch` with the required headers
 * (Authorization Bearer, Accept, X-GitHub-Api-Version, User-Agent) and
 * provides repo-scoped and root-scoped request helpers.
 *
 * The `request` method returns the raw Response (it does not throw on
 * non-OK status), so callers can inspect headers (e.g. rate-limit) before
 * deciding how to handle the response. The `requestJson` and
 * `requestRepoJson` helpers parse the JSON body and throw `GitHubApiError`
 * on non-OK responses.
 */
export class GitHubClient {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this.owner = options.owner;
    this.repo = options.repo;
    this.fetchFn = options.fetchFn ?? fetch;
    this.baseUrl = options.baseUrl ?? GITHUB_API_BASE;
  }

  getOwner(): string {
    return this.owner;
  }

  getRepo(): string {
    return this.repo;
  }

  /**
   * Make an authenticated request to the GitHub API.
   * `path` is relative to the base URL (e.g. "/repos/owner/repo/git/refs/heads/main").
   * Returns the raw Response — does NOT throw on non-OK status.
   * Throws `GitHubApiError` only on network failures.
   */
  async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": USER_AGENT,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubApiError(
        "Could not connect to GitHub. Check your network connection.",
        0,
        undefined,
        {},
      );
    }

    return response;
  }

  /**
   * Make a request and parse the JSON response body.
   * Throws `GitHubApiError` on non-OK responses.
   * The token is never included in the error message.
   */
  async requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.request(method, path, body);
    return this.parseResponse<T>(response);
  }

  /**
   * Make a repo-scoped request (path is relative to /repos/{owner}/{repo}).
   * Throws `GitHubApiError` on non-OK responses.
   */
  async requestRepoJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.requestJson<T>(method, `/repos/${this.owner}/${this.repo}${path}`, body);
  }

  /**
   * Parse a response body as JSON, throwing `GitHubApiError` on non-OK
   * responses. The error message includes the HTTP status and the
   * `message` field from the response body when available. The token is
   * never included in the error message.
   */
  async parseResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      try {
        return (await response.json()) as T;
      } catch {
        throw new GitHubApiError("Received an invalid response from GitHub.", response.status);
      }
    }

    let errorBody: unknown;
    let errorMessage = `GitHub API request failed (HTTP ${response.status})`;

    try {
      errorBody = await response.json();
      if (typeof errorBody === "object" && errorBody !== null) {
        const msg = (errorBody as Record<string, unknown>)["message"];
        if (typeof msg === "string" && msg.length > 0) {
          errorMessage = `GitHub API error (${response.status}): ${msg}`;
        }
      }
    } catch {
      // Response body is not JSON — use the generic status-based message
    }

    const responseHeaders: Record<string, string | null> = {
      "x-ratelimit-remaining": response.headers.get("x-ratelimit-remaining"),
      "x-ratelimit-reset": response.headers.get("x-ratelimit-reset"),
      "x-ratelimit-limit": response.headers.get("x-ratelimit-limit"),
    };

    throw new GitHubApiError(errorMessage, response.status, errorBody, responseHeaders);
  }
}
