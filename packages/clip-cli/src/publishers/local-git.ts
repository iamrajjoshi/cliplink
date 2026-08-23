import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Publisher, PublishParams, PublishResult } from "./types";

/**
 * Function that executes a git command. Mirrors spawnSync's return shape so it
 * can be injected in tests.
 */
export type GitExec = (
  args: string[],
  cwd: string,
  options?: { stdio?: "ignore" | "inherit" },
) => { status: number | null };

export function defaultGitExec(
  args: string[],
  cwd: string,
  options?: { stdio?: "ignore" | "inherit" },
): { status: number | null } {
  return spawnSync("git", args, { cwd, stdio: options?.stdio ?? "inherit" });
}

export interface LocalGitPublisherOptions {
  repoRoot: string;
  gitExec?: GitExec;
}

/**
 * Writes markdown and assets to disk, then stages, commits, and pushes via the
 * local git CLI. Preserves the behavior previously inlined in src/git.ts.
 */
export class LocalGitPublisher implements Publisher {
  private readonly repoRoot: string;
  private readonly gitExec: GitExec;

  constructor(options: LocalGitPublisherOptions) {
    this.repoRoot = options.repoRoot;
    this.gitExec = options.gitExec ?? defaultGitExec;
  }

  async publish(params: PublishParams): Promise<PublishResult> {
    const markdownFullPath = path.join(this.repoRoot, params.markdownPath);

    if (params.dryRun) {
      console.log("dry run: skipping file writes and git add/commit/push");
      return {
        mode: "local",
        committed: false,
        pushed: false,
        location: markdownFullPath,
      };
    }

    // Write markdown file
    await mkdir(path.dirname(markdownFullPath), { recursive: true });
    await writeFile(markdownFullPath, params.markdownContent, "utf8");

    // Write asset files
    for (const asset of params.assets) {
      const assetFullPath = path.join(this.repoRoot, asset.path);
      await mkdir(path.dirname(assetFullPath), { recursive: true });
      await writeFile(assetFullPath, asset.buffer);
    }

    // git add — stage the markdown file and every asset path
    const pathsToStage = [params.markdownPath, ...params.assets.map((a) => a.path)];
    this.runGit(["add", "--", ...pathsToStage], this.repoRoot);

    // git commit
    this.runGit(["commit", "-m", params.commitMessage], this.repoRoot);

    // git push (unless noPush)
    let pushed = false;
    if (!params.noPush) {
      const upstreamCheck = this.gitExec(
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        this.repoRoot,
        { stdio: "ignore" },
      );

      if (upstreamCheck.status === 0) {
        this.runGit(["push"], this.repoRoot);
      } else {
        this.runGit(["push", "-u", "origin", "HEAD"], this.repoRoot);
      }
      pushed = true;
    }

    return {
      mode: "local",
      committed: true,
      pushed,
      location: markdownFullPath,
    };
  }

  private runGit(args: string[], cwd: string): void {
    const result = this.gitExec(args, cwd, { stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed`);
    }
  }
}
