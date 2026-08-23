// GitHubApiPublisher — publishes clips to a remote GitHub repository via
// the Git Data API (blobs → tree → commit → ref update). One coherent commit
// contains the markdown file and all assets. The ref update is fast-forward
// only (force: false).

import { GitHubApiError, GitHubClient, GitDataApi } from "../github";
import type { RepoInfo, TreeEntry } from "../github";
import type { Publisher, PublishParams, PublishResult } from "./types";

export interface GitHubApiPublisherOptions {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

/** Maximum number of publish attempts (initial + retries) for 409 conflicts. */
export const MAX_ATTEMPTS = 3;

/**
 * Error thrown when remote publishing fails. The token is never included in
 * the error message. The `kind` field identifies the category of failure so
 * callers can provide targeted guidance.
 */
export type PublishErrorKind =
  | "auth"
  | "permission"
  | "repo-not-found"
  | "branch-not-found"
  | "rate-limit"
  | "conflict"
  | "network"
  | "protected-branch"
  | "empty-repo"
  | "unknown";

export class GitHubPublishError extends Error {
  readonly status: number;
  readonly kind: PublishErrorKind;

  constructor(message: string, status: number, kind: PublishErrorKind) {
    super(message);
    this.name = "GitHubPublishError";
    this.status = status;
    this.kind = kind;
  }
}

/**
 * Publishes clips to a GitHub repository via the Git Data REST API.
 *
 * Flow:
 *   1. GET branch ref → base commit SHA
 *   2. GET base commit → base tree SHA
 *   3. POST blobs for markdown (UTF-8) and each asset (base64)
 *   4. POST tree with all entries (base_tree, 100644 mode, nested paths)
 *   5. POST commit with the new tree and the base commit as parent
 *   6. PATCH branch ref (force: false — fast-forward only)
 *
 * On 409 from the ref update (branch moved), the entire flow is retried
 * up to MAX_ATTEMPTS times. All other errors are translated into
 * GitHubPublishError with actionable, token-safe messages.
 */
export class GitHubApiPublisher implements Publisher {
  private readonly gitData: GitDataApi;
  private readonly branch: string;
  private readonly owner: string;
  private readonly repo: string;

  constructor(options: GitHubApiPublisherOptions) {
    const client = new GitHubClient({
      token: options.token,
      owner: options.owner,
      repo: options.repo,
      fetchFn: options.fetchFn,
      baseUrl: options.baseUrl,
    });
    this.gitData = new GitDataApi(client);
    this.branch = options.branch;
    this.owner = options.owner;
    this.repo = options.repo;
  }

  async publish(params: PublishParams): Promise<PublishResult> {
    if (params.dryRun) {
      console.log("dry run: skipping GitHub API calls");
      return {
        mode: "remote",
        committed: false,
        pushed: false,
        location: "",
      };
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let isUpdateRefStep = false;
      try {
        // 1. Resolve the branch ref to get the base commit SHA
        const ref = await this.gitData.getRef(this.branch);
        const baseCommitSha = ref.object.sha;

        // 2. Get the base commit to find its tree SHA
        const baseCommit = await this.gitData.getCommit(baseCommitSha);
        const baseTreeSha = baseCommit.tree.sha;

        // 3. Create blobs and collect tree entries
        const entries: TreeEntry[] = [];

        // Markdown is always UTF-8 text
        const markdownBlob = await this.gitData.createBlob(params.markdownContent, "utf-8");
        entries.push({
          path: params.markdownPath,
          mode: "100644",
          type: "blob",
          sha: markdownBlob.sha,
        });

        // Assets are binary — encode as base64
        for (const asset of params.assets) {
          const base64Content = asset.buffer.toString("base64");
          const blob = await this.gitData.createBlob(base64Content, "base64");
          entries.push({
            path: asset.path,
            mode: "100644",
            type: "blob",
            sha: blob.sha,
          });
        }

        // 4. Create a tree with all entries, preserving existing files via base_tree
        const tree = await this.gitData.createTree(baseTreeSha, entries);

        // 5. Create a commit with the new tree and the base commit as parent
        const commit = await this.gitData.createCommit(
          tree.sha,
          [baseCommitSha],
          params.commitMessage,
        );

        // 6. Update the branch ref (fast-forward only — force: false)
        isUpdateRefStep = true;
        await this.gitData.updateRef(this.branch, commit.sha, false);

        return {
          mode: "remote",
          committed: true,
          pushed: true,
          location: commit.sha,
        };
      } catch (error) {
        // Only retry 409 conflicts from the ref update step
        if (isUpdateRefStep && error instanceof GitHubApiError && error.status === 409) {
          if (attempt < MAX_ATTEMPTS) {
            continue; // retry the whole flow
          }
          // Last attempt exhausted — throw the retry-exhausted message
          throw new GitHubPublishError(
            `Branch conflict: could not update '${this.branch}' after ${MAX_ATTEMPTS} attempts. ` +
              "The branch may have been updated concurrently. Try again.",
            409,
            "conflict",
          );
        }
        throw await this.translateError(error);
      }
    }

    // Unreachable: the for loop always returns or throws, but TypeScript
    // needs a return or throw here to satisfy the PublishResult return type.
    throw new GitHubPublishError("Publishing failed after exhausting all attempts.", 0, "unknown");
  }

  /**
   * Translate a GitHubApiError (or any error) into a GitHubPublishError with
   * an actionable, token-safe message. The token is never included.
   */
  private async translateError(error: unknown): Promise<GitHubPublishError> {
    if (error instanceof GitHubPublishError) {
      return error;
    }

    if (!(error instanceof GitHubApiError)) {
      return new GitHubPublishError(
        error instanceof Error ? error.message : "An unexpected error occurred during publishing.",
        0,
        "unknown",
      );
    }

    const status = error.status;

    // 404 — needs repo existence check to distinguish repo vs branch
    if (status === 404) {
      return await this.translateNotFound();
    }

    // Network failure (status 0 — fetch threw)
    if (status === 0) {
      return new GitHubPublishError(
        "Could not connect to GitHub. Check your network connection and try again.",
        0,
        "network",
      );
    }

    // 401 — authentication failure / expired token
    if (status === 401) {
      return new GitHubPublishError(
        "Authentication failed. Your GitHub token may be invalid or expired. " +
          "Run 'clip login' to authenticate again.",
        401,
        "auth",
      );
    }

    // Rate limit — 403 or 429 with X-RateLimit-Remaining: 0
    const remaining = error.responseHeaders["x-ratelimit-remaining"];
    if ((status === 403 || status === 429) && remaining === "0") {
      const reset = error.responseHeaders["x-ratelimit-reset"];
      let resetTime = "soon";
      if (reset) {
        const resetSeconds = Number(reset);
        if (!Number.isNaN(resetSeconds) && resetSeconds > 0) {
          resetTime = new Date(resetSeconds * 1000).toISOString();
        }
      }
      return new GitHubPublishError(
        `GitHub API rate limit exceeded. The limit will reset at ${resetTime}. Try again later.`,
        status,
        "rate-limit",
      );
    }

    // 403 — permission failure or protected branch
    if (status === 403) {
      const bodyMessage = this.extractBodyMessage(error);
      const combined = `${bodyMessage} ${error.message}`.toLowerCase();
      if (combined.includes("protected")) {
        return new GitHubPublishError(
          `Direct publishing to branch '${this.branch}' is not permitted. ` +
            "The branch may be protected. Use a different branch or create a pull request.",
          403,
          "protected-branch",
        );
      }
      return new GitHubPublishError(
        `Permission denied. Ensure your GitHub token has the 'repo' scope and ` +
          `you have write access to '${this.owner}/${this.repo}'.`,
        403,
        "permission",
      );
    }

    // 409 — conflict (from non-updateRef steps, or already exhausted retries)
    if (status === 409) {
      return new GitHubPublishError(
        `Branch conflict: could not update '${this.branch}'. ` +
          "The branch may have been updated concurrently. Try again.",
        409,
        "conflict",
      );
    }

    // Other errors
    const bodyMessage = this.extractBodyMessage(error);
    return new GitHubPublishError(
      `GitHub API error (${status}): ${bodyMessage || error.message}`,
      status,
      "unknown",
    );
  }

  /**
   * On 404, check whether the repo exists to distinguish repo-not-found from
   * branch-not-found. Also detects empty repositories.
   */
  private async translateNotFound(): Promise<GitHubPublishError> {
    try {
      const repoInfo: RepoInfo = await this.gitData.getRepoInfo();

      // Repo exists → branch not found or empty repo
      if (repoInfo.empty || repoInfo.size === 0) {
        return new GitHubPublishError(
          `Repository '${this.owner}/${this.repo}' is empty. ` +
            "Initialize it with at least one commit before publishing clips remotely.",
          404,
          "empty-repo",
        );
      }

      return new GitHubPublishError(
        `Branch '${this.branch}' not found in repository '${this.owner}/${this.repo}'. ` +
          `Check your branch configuration with 'clip config set github.branch <branch>'. ` +
          `The default branch is '${repoInfo.default_branch}'.`,
        404,
        "branch-not-found",
      );
    } catch {
      // Repo doesn't exist (or another error) → repo not found
      return new GitHubPublishError(
        `Repository '${this.owner}/${this.repo}' not found. ` +
          "Check your configuration with 'clip config set github.owner <owner>' and " +
          "'clip config set github.repo <repo>'.",
        404,
        "repo-not-found",
      );
    }
  }

  /** Extract the `message` field from the error response body, if available. */
  private extractBodyMessage(error: GitHubApiError): string {
    const body = error.responseBody;
    if (typeof body === "object" && body !== null) {
      const msg = (body as Record<string, unknown>)["message"];
      if (typeof msg === "string") {
        return msg;
      }
    }
    return "";
  }
}
