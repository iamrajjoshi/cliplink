# CLI guide

[← Cliplink](../README.md)

Install the npm package as `cliplink`; run it with `clip`. See the [quick start](../README.md#quick-start) for login, repository creation, and website setup.

## Release status

The published version, **0.1.1**, requires a local checkout even when publishing through the GitHub API. Run it inside your cloned site or pass `--repo /path/to/your/site`.

Source `main` supports remote publishing without a clone, but that change hasn't shipped to npm. Its `clip init` default is `clip`; npm 0.1.1 defaults to `cliplink-template`. Enter `clip` explicitly to follow the quick start.

## Commands and flags

| Command                         | What it does                                            |
| ------------------------------- | ------------------------------------------------------- |
| `clip <url \| path \| ->`       | Save a URL, local image, or stdin note                  |
| `clip login`                    | Authenticate through GitHub's browser verification flow |
| `clip logout`                   | Remove the stored token                                 |
| `clip init`                     | Create a public repository from the template            |
| `clip config`                   | Show the CLI configuration                              |
| `clip config get <key>`         | Read a setting                                          |
| `clip config set <key> <value>` | Change a setting                                        |

Run `clip --help` for built-in help or `clip --version` to check the installed release.

| Flag            | Behavior                                                                               |
| --------------- | -------------------------------------------------------------------------------------- |
| `--local`       | Write files, commit, and push through local Git                                        |
| `--repo <path>` | Use a local site directory; this is a path, not `owner/repo`                           |
| `--dry-run`     | Print Markdown without writing files or publishing; metadata requests can still happen |
| `--no-push`     | Skip pushing in local mode; still create a commit. Ignored in GitHub API mode          |

You can set `CLIP_REPO` instead of supplying `--repo` each time.

## Saving content

Cliplink detects the input type and fetches the available metadata. It supports five kinds: `link`, `tweet`, `image`, `video`, and `note`.

```sh
clip https://example.com/article
clip https://x.com/someone/status/123
clip ./screenshot.png
clip 'https://www.youtube.com/watch?v=VIDEO_ID'
printf 'A note worth keeping.\n' | clip - --local
```

Set `$VISUAL` or `$EDITOR` before choosing the interactive editor prompt. The CLI prefers `$VISUAL` when both exist. Prompts require terminal input and output; piped notes work without a prompt.

GitHub links receive a `github` tag automatically. There isn't a custom-tags prompt; edit the generated frontmatter to add your own tags.

Video clips contain a reference and an available thumbnail, not a downloaded video. X posts depend on X's syndication endpoint; private or unavailable posts may fail.

## Publishing

With a stored token available, `clip` uses the GitHub API to commit Markdown and assets together. Without one, it uses local Git. `--local` always selects local Git, even after login.

```sh
clip https://example.com/article --local
clip https://example.com/article --local --no-push
clip --repo ~/code/clip https://example.com/article --local
```

Local mode uses the checkout's current branch and upstream. Configure Git's commit identity and push authentication separately; `clip login` doesn't configure them.

### Keep your checkout current

Remote publishing checks slug collisions against local content, not the remote repository, and it doesn't update local files after a successful publish. Pull the latest changes before saving another item:

```sh
git pull --ff-only
```

An existing slug that your checkout hasn't seen can replace same-day Markdown. Asset directories use the slug without the date, so repeated slugs can also replace images across dates. If you save repeated items, review their filenames and assets; don't assume each remote save will create a separate copy.

### Website deployment

`clip init` creates a public repository and records it in the CLI configuration. It doesn't finish the website setup. Follow the [template instructions](https://github.com/iamrajjoshi/cliplink-template#quick-start) to set your identity in `site.config.mjs`, select GitHub Actions for Pages, and deploy.

After setup, commits to `main` trigger the template's build and deployment workflow. A successful CLI publish confirms the Git commit, not a completed Pages deployment.

## Configuration

`clip login` records your GitHub username, and `clip init` records your new repository. To target an existing compatible site or another branch:

```sh
clip config
clip config set github.owner YOUR_GITHUB_USERNAME
clip config set github.repo clip
clip config set github.branch main
clip config get github.repo
```

Configuration lives at `~/.config/clip/config.json`, or `$XDG_CONFIG_HOME/clip/config.json` when set. The `github.branch` setting controls GitHub API publishing; local Git uses the checkout's current branch.

## Authentication

GitHub login requests the OAuth `repo` scope. Your account needs write access to the destination repository, and protected branches may block direct publishing.

The CLI stores tokens outside your repository. On macOS it tries Keychain when stdout is a terminal and CI is not enabled, then checks an owner-readable credentials file (mode `0600`) if Keychain has no token. Login also falls back to that file if Keychain storage fails. Other environments use the file directly. Piping a note into `clip` doesn't by itself disable Keychain access; redirecting stdout does.

Use `--local` for a Git-authenticated workflow that doesn't depend on the CLI's stored token.

To switch accounts or replace an expired token:

```sh
clip logout
clip login
```

## File format

The CLI and template share the [`cliplink-schema` contract](../packages/clip-schema/src/index.ts). Entries contain YAML frontmatter and an optional Markdown body.

```text
your-site/
└── apps/web/
    ├── src/content/clips/YYYY-MM-DD-slug.md
    └── public/clips/slug/
```

The template owns rendering and deployment; this repository owns the CLI and shared schema.

## Troubleshooting

**“Could not find the clip workspace root”**

Run npm 0.1.1 from your cloned site or pass `--repo /path/to/clip`. See [release status](#release-status) for the difference between npm and source `main`.

**The publish succeeded, but the website hasn't changed**

Check the destination repository's Actions run and Pages settings. Also confirm that the CLI targets the branch the website deploys from.

**`--no-push` still published a clip**

That flag only affects local Git. Use `--local --no-push` together. This still writes files and creates a commit.

**A command can't find my stored token**

macOS Keychain access depends on terminal output and skips CI. Use local Git when running in that environment, or log in through the credential backend you intend to use. Don't put tokens in your site repository or issue reports.
