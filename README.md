# clipit

A small `clip` CLI for saving links, tweets, images, videos, and notes into repo-backed markdown for [clip.rajjoshi.me](https://clip.rajjoshi.me).

The `clip` CLI is published as the public npm package **`clipit`**. After a one-time `npm install -g clipit` and `clip login`, you can run `clip <url>` from any directory to publish a clip directly to the GitHub repository through the GitHub REST API, no local clone required. The original local-repo workflow (write files, commit, push via local git) remains fully supported.

## Table of Contents

- [Install](#install)
- [Authentication](#authentication)
- [Configuration](#configuration)
- [Creating a Repository with `clip init`](#creating-a-repository-with-clip-init)
- [Usage](#usage)
  - [Remote mode](#remote-mode)
  - [Local mode](#local-mode)
- [Required GitHub Permissions](#required-github-permissions)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Command and Flag Reference](#command-and-flag-reference)
- [Workspace Development](#workspace-development)

## Install

Install the CLI globally from npm:

```bash
npm install -g clipit
```

Requires Node.js >= 20. After install, the `clip` command is available on your PATH.

Verify the install:

```bash
clip --version
```

## Authentication

Remote publishing authenticates with GitHub using the **OAuth Device Flow**, so you never paste a token or enter your GitHub password into the CLI.

```bash
clip login
```

What happens:

1. The CLI requests a device code from GitHub.
2. It prints a **user code** and a **verification URL** to the terminal.
3. Open the verification URL in a browser, sign in to GitHub if needed, and enter the user code.
4. The CLI polls GitHub until you authorize (or the code expires).
5. On success, GitHub returns an access token scoped to `repo`.
6. The CLI verifies the token with `GET /user` and prints `Logged in as <login>`.
7. The CLI automatically records your GitHub login as `github.owner` in [configuration](#configuration), so remote publishing targets your own account without any manual setup.
8. The token is stored securely (see [Security](#security)).

The token is never printed, logged, or written to the repository.

If you are already logged in, `clip login` tells you and exits without re-running the flow. Run `clip logout` first to switch accounts.

### clip logout

Remove the stored token:

```bash
clip logout
```

This deletes the token from macOS Keychain (and the credentials file fallback if present) and prints `Logged out.` If you were not logged in, it prints `Not logged in.` and exits cleanly.

After logout, `clip <url>` falls back to [local mode](#local-mode).

## Configuration

The CLI stores non-secret configuration in a JSON file. The token is **not** stored here, it lives in Keychain or the credentials file (see [Security](#security)).

Config file location:

- `$XDG_CONFIG_HOME/clip/config.json` if `XDG_CONFIG_HOME` is set
- otherwise `~/.config/clip/config.json`

The config directory is created with `0700` permissions and the file with `0600` (owner read/write only).

Default configuration:

```json
{
  "mode": "remote",
  "github": {
    "owner": "",
    "repo": "",
    "branch": "main"
  }
}
```

`github.owner` is left empty by default and is **automatically set during `clip login`** from the authenticated user's GitHub login (see [Authentication](#authentication)). `github.repo` is empty by default and is set automatically by `clip init` (see [Creating a Repository with `clip init`](#creating-a-repository-with-clip-init)) or manually with `clip config set github.repo <name>`.

### clip config

Show the current configuration (defaults are printed when no file exists; sensitive keys are redacted):

```bash
clip config
```

### clip config get <key>

Print a single value. Dot-notation is supported for nested keys:

```bash
clip config get github.owner
clip config get github.branch
```

### clip config set <key> <value>

Set a value. Dot-notation updates nested keys without overwriting siblings. Only defined keys are accepted: `mode`, `github.owner`, `github.repo`, `github.branch`.

```bash
clip config set github.owner iamrajjoshi
clip config set github.repo clip
clip config set github.branch develop
```

The config file is written atomically (temp file + rename) so an interrupted write leaves the previous file intact.

## Creating a Repository with `clip init`

`clip init` creates a brand-new clip site repository on your GitHub account from the [`iamrajjoshi/clip`](https://github.com/iamrajjoshi/clip) template, so you can go from `clip login` to publishing clips without manually forking or cloning anything.

```bash
clip init
```

What happens:

1. The CLI checks that you are logged in. If no token is stored, it exits with `Run \`clip login\` first.`
2. It prompts for a repository name (default `clip`).
3. It calls GitHub's "create from template" API (`POST /repos/iamrajjoshi/clip/generate`) with `{ name: <repo-name>, private: false }`, creating a **public** repository under your account that inherits the full Astro site structure, content directories, and deploy workflow.
4. On success, it **auto-configures `github.repo`** in [configuration](#configuration) to the new repo name, so the very next `clip <url>` publishes to it.
5. It prints the new repository's URL.

If a repository with that name already exists on your account, GitHub returns `422` and the CLI exits with `Repository already exists. Try a different name.` Any other error (network, permissions, etc.) exits non-zero with a meaningful message and never leaks your token.

After `clip init`, your config looks like:

```json
{
  "mode": "remote",
  "github": {
    "owner": "<your-login>",
    "repo": "<chosen-name>",
    "branch": "main"
  }
}
```

`github.owner` is set automatically by `clip login`; `clip init` only needs to set `github.repo`.

## Usage

`clip <url | path | ->` runs the full flow: detect input kind, scrape metadata, download assets, prompt for tags and an optional note, validate against the Zod schema, generate markdown, then publish.

The CLI selects a publishing mode automatically:

- **Remote mode** is the default when you are logged in (a token is available) and `--local` is not passed.
- **Local mode** is used when you are not logged in, or when you pass `--local`.

The chosen mode is reported in the command output (`mode: remote` or `mode: local`).

### Remote mode

When logged in, `clip <url>` publishes directly to the configured GitHub repository through the GitHub REST API (Git Data API). No local clone is needed.

```bash
clip https://example.com/article
```

The CLI creates one coherent commit containing the generated markdown and all downloaded assets on the configured branch, then the existing GitHub Actions deployment builds and deploys the site naturally from that commit.

The repository owner, name, and branch come from [configuration](#configuration). To publish to a different branch:

```bash
clip config set github.branch develop
clip https://example.com/article
```

`--dry-run` works in remote mode and prints a preview without making any GitHub API calls.

### Local mode

Local mode writes files into a local checkout of the clip site repository and commits/pushes via the local `git` CLI. Use it when you are not logged in, or when you explicitly want to work against a local clone.

Force local mode even when logged in:

```bash
clip https://example.com/article --local
```

Without a token, `clip <url>` defaults to local mode automatically:

```bash
clip https://example.com/article
```

When running from outside the workspace, point the CLI at your local checkout:

```bash
clip --repo ~/code/clip https://example.com/article
# or via environment variable
CLIP_REPO=~/code/clip clip https://example.com/article
```

`--no-push` commits locally but skips `git push` (only meaningful in local mode; ignored with a warning in remote mode). `--dry-run` prints a preview without writing files or running any git operations.

Examples for all input kinds:

```bash
clip https://example.com/article          # link
clip https://x.com/someone/status/123     # tweet
clip ~/Pictures/screenshot.png            # image (local file)
clip https://www.youtube.com/watch?v=...  # video
echo "a quick note" | clip -              # note (stdin)
```

## Required GitHub Permissions

Remote mode needs a GitHub token with:

- **OAuth scope `repo`** — requested by `clip login` during the Device Flow. This grants read/write access to your repositories (public and private).
- **Contents: write** repository permission — the Git Data API calls (create blobs, trees, commits, and update branch refs) require write access to the repository contents.

Ensure the account you log in with has write access to the configured repository (`github.owner`/`github.repo`). If the repository belongs to an organization, the token may need organization approval for OAuth Apps.

## Security

- **Token storage:** On macOS the access token is stored in the system Keychain via the `security` CLI (`security add-generic-password -s clip -a github -w <token>`). No native module dependency is used.
- **File fallback:** If the Keychain is unavailable (non-macOS, non-interactive/CI environments, or a denied Keychain prompt), the token is written to `$XDG_CONFIG_HOME/clip/credentials.json` (or `~/.config/clip/credentials.json`) with `0600` permissions (owner read/write only). The directory is created with `0700`.
- **Token never exposed:** The token is never printed to stdout or stderr, never logged, and never included in error messages. Authentication failures produce generic messages (for example, `Authentication failed. Your GitHub token may be invalid or expired.`).
- **No token in config:** The token is stored separately from `config.json`. The config file never contains a `token` field or any credential. `clip config` and `clip config get` redact any key that looks sensitive.
- **No secrets in the repository:** Config and credentials files live under `~/.config/clip/`, outside the repo, so they are never committed.
- **OAuth Device Flow:** No client secret is used. You authorize in a browser; the CLI never sees your password.

## Troubleshooting

### Not logged in

If you run `clip <url>` without a token, the CLI silently falls back to local mode and expects a local checkout. If you meant to publish remotely, run:

```bash
clip login
```

Check whether a token is stored by running `clip login` (it reports `Already logged in.` if a token exists).

### Token expired or invalid

If the GitHub API returns `401`, the CLI exits non-zero with:

```
Authentication failed. Your GitHub token may be invalid or expired. Run 'clip login' to authenticate again.
```

Fix it by logging in again:

```bash
clip logout
clip login
```

### Permissions denied

A `403` from the GitHub API (not a rate limit) means the token lacks the `repo` scope or the account lacks write access to the repository. The CLI prints:

```
Permission denied. Ensure your GitHub token has the 'repo' scope and you have write access to '<owner>/<repo>'.
```

Re-authorize the OAuth App with the `repo` scope (`clip logout` then `clip login`), or point configuration at a repository you can write to:

```bash
clip config set github.owner <your-owner>
clip config set github.repo <your-repo>
```

### Branch conflict

If the branch moves while the CLI is publishing (a `409` from the ref update), it automatically retries the entire flow up to three times. If all attempts conflict, it exits non-zero with a message to try again. You usually do not need to do anything; simply re-run the command.

### Branch not found

A `404` for the configured branch prints:

```
Branch '<branch>' not found in repository '<owner>/<repo>'. Check your branch configuration with 'clip config set github.branch <branch>'.
```

Set the branch to an existing one (the message also reports the repository's default branch):

```bash
clip config set github.branch main
```

### Repository not found

A `404` for the repository itself prints:

```
Repository '<owner>/<repo>' not found. Check your configuration with 'clip config set github.owner <owner>' and 'clip config set github.repo <repo>'.
```

Confirm the owner and repo names, and that your token has access.

### Rate limit exceeded

When the GitHub API rate limit is exhausted, the CLI stops before completing and reports when the limit resets:

```
GitHub API rate limit exceeded. The limit will reset at <ISO timestamp>. Try again later.
```

Wait until the reset time and retry. Authenticated requests have a higher limit than anonymous ones, so ensure you are logged in.

### Protected branch

If the target branch is protected and rejects direct pushes, the CLI reports:

```
Direct publishing to branch '<branch>' is not permitted. The branch may be protected. Use a different branch or create a pull request.
```

Publish to an unprotected branch instead:

```bash
clip config set github.branch develop
```

### Network error

If GitHub is unreachable, the CLI exits non-zero with `Could not connect to GitHub. Check your network connection and try again.` and never leaks the token. Restore connectivity and re-run the command.

## Command and Flag Reference

### Commands

| Command                         | Description                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `clip login`                    | Authenticate with GitHub via OAuth Device Flow and store the token.                                                                   |
| `clip logout`                   | Delete the stored token from Keychain and/or the credentials file.                                                                    |
| `clip config`                   | Show the current configuration (sensitive keys redacted).                                                                             |
| `clip config get <key>`         | Print a config value (dot-notation supported, e.g. `github.branch`).                                                                  |
| `clip config set <key> <value>` | Set a config value (dot-notation supported; only defined keys accepted).                                                              |
| `clip init`                     | Create a new clip site repository from the `iamrajjoshi/clip` template and auto-configure `github.repo`. Requires `clip login` first. |
| `clip <url>`                    | Clip a URL (link, tweet, or video) and publish it.                                                                                    |
| `clip <path>`                   | Clip a local image file and publish it.                                                                                               |
| `clip -`                        | Clip a note from stdin and publish it.                                                                                                |
| `clip` (no args)                | Print help and exit 0.                                                                                                                |

### Flags

| Flag            | Description                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--local`       | Force local mode (write files, commit, push via local git) even when logged in.                                                 |
| `--dry-run`     | Print the clip that would be written without changing the repo (no file writes, no git ops, no API calls). Works in both modes. |
| `--no-push`     | Commit locally but skip `git push`. Only meaningful in local mode; ignored with a warning in remote mode.                       |
| `--repo <path>` | Target a local clip repo when running from outside the workspace. Overrides `CLIP_REPO`.                                        |
| `--help`, `-h`  | Show help text and exit 0.                                                                                                      |
| `--version`     | Print the installed CLI version and exit 0.                                                                                     |

### Environment variables

| Variable          | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `CLIP_REPO`       | Path to the local clip repo for local mode (overridden by `--repo`).  |
| `XDG_CONFIG_HOME` | Directory for config and credentials files (defaults to `~/.config`). |

### Help and version

```bash
clip --help     # show help
clip -h         # show help
clip --version  # print the version
```

## Workspace Development

For contributors working inside this monorepo:

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
pnpm check
pnpm format:check
```

### Publishing

This repo publishes two packages to npm:

- `clipit-schema` — the shared Zod schema (published first)
- `clipit` — the CLI itself (depends on `clipit-schema`)

Publishing is automated via GitHub Actions on tag push (`v*`). The workflow builds, tests, then publishes `clipit-schema` before `clipit`.
