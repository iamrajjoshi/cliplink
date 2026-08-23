// Git Data API methods built on top of GitHubClient.
// Implements the blob → tree → commit → ref flow used by GitHubApiPublisher.

import type { GitHubClient, GitHubUser } from "./client";

// ---------------------------------------------------------------------------
// Response types (subset of GitHub API response fields used by the CLI)
// ---------------------------------------------------------------------------

export interface GitRef {
  ref: string;
  node_id: string;
  url: string;
  object: {
    type: string;
    sha: string;
    url: string;
  };
}

export interface GitCommit {
  sha: string;
  url: string;
  tree: {
    sha: string;
    url: string;
  };
  message: string;
  parents: { sha: string; url: string }[];
}

export interface GitBlob {
  url: string;
  sha: string;
  node_id: string;
}

export type TreeEntryMode = "100644" | "100755" | "040000" | "160000" | "120000";
export type TreeEntryType = "blob" | "tree" | "commit";

export interface TreeEntry {
  path: string;
  mode: TreeEntryMode;
  type: TreeEntryType;
  sha?: string;
  content?: string;
}

export interface GitTree {
  sha: string;
  url: string;
  tree: TreeEntry[];
}

export interface CreateCommitResponse {
  sha: string;
  url: string;
}

export type BlobEncoding = "utf-8" | "base64";

export interface RepoInfo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  size: number;
  empty: boolean;
}

// ---------------------------------------------------------------------------
// GitDataApi
// ---------------------------------------------------------------------------

/**
 * Wraps the GitHub Git Data API endpoints used for remote publishing.
 * Each method maps to a single REST call and returns the parsed JSON body.
 */
export class GitDataApi {
  private readonly client: GitHubClient;

  constructor(client: GitHubClient) {
    this.client = client;
  }

  /** GET /repos/{owner}/{repo}/git/refs/heads/{branch} — resolve a branch ref. */
  async getRef(branch: string): Promise<GitRef> {
    return this.client.requestRepoJson<GitRef>("GET", `/git/refs/heads/${branch}`);
  }

  /** GET /repos/{owner}/{repo}/git/commits/{sha} — get a commit (with its tree SHA). */
  async getCommit(sha: string): Promise<GitCommit> {
    return this.client.requestRepoJson<GitCommit>("GET", `/git/commits/${sha}`);
  }

  /**
   * POST /repos/{owner}/{repo}/git/blobs — create a blob.
   * Use `encoding: "utf-8"` for text content and `encoding: "base64"` for
   * binary content.
   */
  async createBlob(content: string, encoding: BlobEncoding): Promise<GitBlob> {
    return this.client.requestRepoJson<GitBlob>("POST", "/git/blobs", {
      content,
      encoding,
    });
  }

  /**
   * POST /repos/{owner}/{repo}/git/trees — create a tree.
   * `baseTreeSha` is used as `base_tree` so existing files are preserved.
   * Entries with nested paths (e.g. "apps/web/public/clips/slug/image.jpg")
   * are accepted; GitHub creates intermediate tree objects automatically.
   */
  async createTree(baseTreeSha: string, entries: TreeEntry[]): Promise<GitTree> {
    return this.client.requestRepoJson<GitTree>("POST", "/git/trees", {
      base_tree: baseTreeSha,
      tree: entries,
    });
  }

  /**
   * POST /repos/{owner}/{repo}/git/commits — create a commit.
   * `treeSha` is the new tree; `parents` is the list of parent commit SHAs
   * (typically the previous branch tip for a fast-forward commit).
   */
  async createCommit(
    treeSha: string,
    parents: string[],
    message: string,
  ): Promise<CreateCommitResponse> {
    return this.client.requestRepoJson<CreateCommitResponse>("POST", "/git/commits", {
      tree: treeSha,
      parents,
      message,
    });
  }

  /**
   * PATCH /repos/{owner}/{repo}/git/refs/heads/{branch} — update a branch ref.
   * `force` should be `false` for fast-forward-only updates.
   */
  async updateRef(branch: string, sha: string, force: boolean): Promise<GitRef> {
    return this.client.requestRepoJson<GitRef>("PATCH", `/git/refs/heads/${branch}`, {
      sha,
      force,
    });
  }

  /** GET /user — verify the token and return the authenticated user. */
  async getUser(): Promise<GitHubUser> {
    return this.client.requestJson<GitHubUser>("GET", "/user");
  }

  /** GET /repos/{owner}/{repo} — check if the repo exists and get its info. */
  async getRepoInfo(): Promise<RepoInfo> {
    return this.client.requestRepoJson<RepoInfo>("GET", "");
  }

  /**
   * POST /repos/{templateOwner}/{templateRepo}/generate — create a new
   * repository from a template. The request is made against the root API
   * (not the configured repo scope) because the template owner/repo differ
   * from the client's configured `owner`/`repo`.
   *
   * `templateOwner`/`templateRepo` identify the source template repository,
   * and `body` carries the new repo options (e.g. `name`, `private`).
   * Returns the newly created repository's info.
   */
  async generateRepo(
    templateOwner: string,
    templateRepo: string,
    body: { name: string; private?: boolean; description?: string },
  ): Promise<GeneratedRepo> {
    return this.client.requestJson<GeneratedRepo>(
      "POST",
      `/repos/${templateOwner}/${templateRepo}/generate`,
      body,
    );
  }
}

/** Response from POST /repos/{owner}/{repo}/generate (created repository). */
export interface GeneratedRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
  private: boolean;
}
