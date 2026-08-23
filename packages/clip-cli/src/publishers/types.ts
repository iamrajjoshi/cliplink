/**
 * Publisher abstraction for writing clips to a target (local git repo or remote GitHub API).
 */

export interface Asset {
  /** Base filename, e.g. "favicon.png" */
  filename: string;
  /** Raw file content (binary for images, UTF-8 for text) */
  buffer: Buffer;
  /** Repo-relative path, e.g. "apps/web/public/clips/<slug>/image.jpg" */
  path: string;
}

export interface PublishParams {
  slug: string;
  markdownContent: string;
  /** Markdown filename, e.g. "2026-08-18-example.md" */
  markdownFilename: string;
  /** Repo-relative markdown path, e.g. "apps/web/src/content/clips/2026-08-18-example.md" */
  markdownPath: string;
  assets: Asset[];
  commitMessage: string;
  dryRun: boolean;
  /** Only meaningful in local mode — commit without pushing. */
  noPush: boolean;
}

export interface PublishResult {
  mode: "local" | "remote";
  committed: boolean;
  pushed: boolean;
  /** File path (local) or commit SHA (remote). */
  location: string;
}

export interface Publisher {
  publish(params: PublishParams): Promise<PublishResult>;
}
