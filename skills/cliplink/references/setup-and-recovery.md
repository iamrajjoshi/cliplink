# Setup and recovery

Read this when installation, authentication, repository setup, or a failed save needs attention. Reuse the user's existing collection where possible.

## Install and sign in

Cliplink recommends Node.js 24. Check `node --version`, then install when installation is within the user's request:

```sh
npm install --global cliplink
clip --version
clip --help
clip login
```

`clip login` uses browser-based GitHub authorization with the `repo` scope. Let the user complete it. Do not request, read, copy, or print tokens. Cliplink manages storage itself: macOS Keychain in an interactive non-CI session, otherwise a credential file with restricted permissions. `clip logout` removes the locally stored token; it does not revoke GitHub authorization.

The published package is `cliplink`, even though the command is `clip`. If the command or help does not match, inspect the executable path and installed package version before upgrading or changing unrelated tools.

## Use an existing repository

Read the current non-secret values before changing them. These settings select the API destination and persist for future saves:

```sh
clip config set github.owner YOUR_GITHUB_USERNAME
clip config set github.repo YOUR_REPO
clip config set github.branch main
```

Replace all placeholders with verified values, including the actual branch. Login records the owner; init records the chosen repository. An existing repository can have any valid name. Do not silently repoint someone's default collection for a one-off save. For an authorized local target, use `--local --repo /absolute/path/to/collection` instead.

Repository renames may require updating these settings and the local Git remote. Check the repository's canonical name and branch before changing anything. Do not assume that repository redirects also fix a website deployment or custom domain.

## Create a collection

**`clip init` creates a public GitHub repository.** Run it only when the user has authorized creating a public collection. Otherwise ask whether a public repository is intended. It prompts for a name; there is no `--name` or `--private` flag.

```sh
clip init
```

Use the chosen name in subsequent clone commands. Init saves that name in configuration, but does not finish GitHub Pages setup. The [template guide](https://github.com/iamrajjoshi/cliplink-template#quick-start) covers `site.config.mjs`, the Pages workflow, and custom domains. Do not broaden a CLI setup request into DNS changes or repository visibility changes.

## Local publishing checks

Before a local write, inspect the chosen checkout:

```sh
git -C /absolute/path/to/collection status --short --branch
git -C /absolute/path/to/collection diff --cached --name-only
git -C /absolute/path/to/collection branch -vv
```

Inspect remote destinations through a tool that redacts embedded credentials before producing output; do not dump raw remote URLs. Require an empty index and check for overlapping worktree changes. Cliplink stages its paths, then makes an ordinary Git commit that also includes any previously staged files.

Local mode uses the checkout's branch/upstream; without an upstream, it can push `HEAD` to `origin`. GitHub API branch configuration does not control this. Local Git push authentication is separate from `clip login`. Check that an intended push reaches the right repository and branch.

When the user requests a fresh checkout, use a separate directory. Only fast-forward an existing clean checkout when synchronizing it is in scope. Preserve unrelated work and never force-push to make a save succeed.

## Recover without duplicating a clip

| Symptom                                                          | Check and next action                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API authentication fails or unexpectedly falls back to local Git | Check terminal/CI context and the configured owner/repository. Let the user complete `clip login` if needed. Do not extract credentials or switch destinations silently.                                                                                                                  |
| Local push fails after a commit                                  | Inspect the latest local commit and remote history. If the intended clip is already committed, fix the authorized push path and push that commit; do not run `clip` again to recreate it.                                                                                                 |
| API request times out or reports an uncertain result             | Read the destination branch and clip paths to determine whether the commit arrived. Retry only after resolving that uncertainty.                                                                                                                                                          |
| API rejects an existing Markdown or asset path                   | It prevents overwriting existing clips. Inspect the existing item. For an intentionally separate link/video save, a different user-approved title changes the slug. An up-to-date local checkout can generate a unique slug. Do not use either option to hide an uncertain previous save. |
| API cannot obtain a complete remote tree                         | It stops rather than skipping collision checks. Use an authorized, up-to-date local checkout with explicit `--local` or resolve the API error. There is no force bypass.                                                                                                                  |
| Source metadata or image processing fails                        | Check input accessibility and supported kind. Report missing content; do not fabricate source text. Do not turn private content into a public paste to make scraping work.                                                                                                                |
| Save succeeds but the page is missing                            | Verify the saved commit, then inspect the collection's deployment. Saving and deploying are separate operations.                                                                                                                                                                          |

Use the [CLI guide](https://github.com/iamrajjoshi/cliplink/blob/main/docs/cli.md) for the full command reference. Redact credentials, private content, and sensitive URLs from bug reports.
