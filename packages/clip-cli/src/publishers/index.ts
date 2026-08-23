import { GitHubApiPublisher } from "./github-api";
import { LocalGitPublisher } from "./local-git";
import type { Publisher } from "./types";

export interface PublisherFactoryOptions {
  repoRoot: string;
  /** True when --local flag is passed (forces local mode). */
  local: boolean;
  /** GitHub access token or null when not logged in. */
  token: string | null;
  /** GitHub repository configuration (required for remote mode). */
  github?: { owner: string; repo: string; branch: string };
}

/**
 * Selects a publisher based on mode and token availability.
 *
 * - No token or --local flag → LocalGitPublisher (existing git behavior)
 * - Token and no --local → GitHubApiPublisher (remote mode)
 */
export function createPublisher(options: PublisherFactoryOptions): Publisher {
  const useLocal = options.local || !options.token;

  if (useLocal) {
    return new LocalGitPublisher({ repoRoot: options.repoRoot });
  }

  if (!options.github) {
    throw new Error(
      "GitHub configuration (owner, repo, branch) is required for remote mode. " +
        "Run 'clip config set github.owner <owner>', 'clip config set github.repo <repo>', " +
        "and 'clip config set github.branch <branch>'.",
    );
  }

  if (!options.github.repo) {
    throw new Error(
      "No repository configured. Run `clip init` to create one from a template, or `clip config set github.repo <name>` to use an existing repo.",
    );
  }

  return new GitHubApiPublisher({
    token: options.token as string,
    owner: options.github.owner,
    repo: options.github.repo,
    branch: options.github.branch,
  });
}

export { GitHubApiPublisher, GitHubPublishError, MAX_ATTEMPTS } from "./github-api";
export type { GitHubApiPublisherOptions, PublishErrorKind } from "./github-api";
export { LocalGitPublisher } from "./local-git";
export type { GitExec, LocalGitPublisherOptions } from "./local-git";
export type { Publisher, PublishParams, PublishResult, Asset } from "./types";
