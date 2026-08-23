import { input } from "@inquirer/prompts";
import { KeychainStore } from "../auth/keychain";
import { ConfigStore } from "../config/store";
import { GitHubApiError, GitHubClient } from "../github/client";
import { GitDataApi } from "../github/git-data";
import type { GeneratedRepo } from "../github/git-data";

/** Template repository the new clip site is generated from. */
export const TEMPLATE_OWNER = "iamrajjoshi";
export const TEMPLATE_REPO = "clip";

export type RepoNamePromptFn = (options: { message: string; default?: string }) => Promise<string>;

export interface InitCommandOptions {
  keychain?: KeychainStore;
  configStore?: Pick<ConfigStore, "get" | "set">;
  /** Builds the GitHubClient used for the generate call. */
  createClient?: (token: string) => GitHubClient;
  /** Injectable prompt function (defaults to @inquirer/prompts input). */
  promptRepoName?: RepoNamePromptFn;
}

/**
 * Run the `clip init` command: create a new GitHub repository from the
 * `iamrajjoshi/clip` template and auto-configure `github.repo` in config.
 *
 * Flow:
 * 1. Check for a stored token. If none, exit with "Run `clip login` first."
 * 2. Prompt for a repo name (default "clip").
 * 3. POST /repos/{TEMPLATE_OWNER}/{TEMPLATE_REPO}/generate with the name.
 * 4. On success: auto-set `github.repo` and print the new repo URL.
 * 5. On 422 (repo exists): exit with "Repository already exists. ..."
 * 6. On other errors: exit with a meaningful error (no token leaked).
 */
export async function runInitCommand(options?: InitCommandOptions): Promise<void> {
  const keychain = options?.keychain ?? new KeychainStore();
  const configStore = options?.configStore ?? new ConfigStore();
  const promptRepoName = options?.promptRepoName ?? defaultPromptRepoName;
  const createClient = options?.createClient ?? defaultCreateClient;

  // 1. Require authentication.
  const token = await keychain.read();
  if (!token) {
    console.log("Run `clip login` first.");
    process.exitCode = 1;
    return;
  }

  // 2. Prompt for the repo name.
  const name = await promptRepoName({
    message: "Repository name:",
    default: TEMPLATE_REPO,
  });

  // 3. Create the repo from the template.
  const client = createClient(token);
  const gitData = new GitDataApi(client);

  let repo: GeneratedRepo;
  try {
    repo = await gitData.generateRepo(TEMPLATE_OWNER, TEMPLATE_REPO, {
      name,
      private: false,
    });
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 422) {
      console.log("Repository already exists. Try a different name.");
    } else {
      // Meaningful error without leaking the token.
      const message = err instanceof Error ? err.message : "Failed to create repository.";
      console.log(message.includes(token) ? "Failed to create repository." : message);
    }
    process.exitCode = 1;
    return;
  }

  // 4. Auto-set github.repo in config.
  await configStore.set("github.repo", repo.name);

  // 5. Print success with the new repo URL.
  console.log(`Created repository: ${repo.html_url}`);
}

async function defaultPromptRepoName(opts: { message: string; default?: string }): Promise<string> {
  return input({ message: opts.message, default: opts.default });
}

function defaultCreateClient(token: string): GitHubClient {
  return new GitHubClient({ token, owner: TEMPLATE_OWNER, repo: TEMPLATE_REPO });
}
