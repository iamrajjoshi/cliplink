# CLI guide

[← Cliplink](../README.md)

Install the npm package as `cliplink`; run it with `clip`. See the [quick start](../README.md#quick-start) for login, repository creation, and website setup.

## Release status

**0.2.1** adds MIT licensing, package notices, and an image-processing dependency security update. Commands and flags match 0.2.0. See the [changelog](../CHANGELOG.md) for release details.

**0.2.0** adds metadata flags and remote publishing without a local clone. Run `clip login`, then `clip init` or configure an existing collection. `clip init` accepts any available repository name and remembers it; the default is `clip`.

Use Node.js 24 (recommended). Supported versions are Node.js 20.17+, 22.13+, or 23.5 and later; Node.js 21 and earlier 22.x releases aren't supported by the prompt dependencies. Upgrade an older CLI with `npm install --global cliplink@latest`.

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

### Metadata flags

| Flag                   | Applies to       | Behavior                                                   |
| ---------------------- | ---------------- | ---------------------------------------------------------- |
| `--tag <tag>`          | All clips        | Add one tag; repeat to add more                            |
| `--tags <a,b>`         | All clips        | Add comma-separated tags; repeat to add more               |
| `--title <text>`       | Links and videos | Replace the fetched title and use it for the filename slug |
| `--description <text>` | Links            | Replace the fetched description                            |
| `--alt <text>`         | Images           | Set the image's alt text                                   |
| `--note <text>`        | All clips        | Add a Markdown note without opening an editor              |

Both `--title "My title"` and `--title="My title"` work. Tags are trimmed and deduplicated case-sensitively; automatic tags come first, followed by your tags in command order. `--tag` treats commas literally, while `--tags` splits on commas. Empty values and flags that don't apply to the clip kind produce an error before fetching content or publishing. Repeating a title, description, alt text, or note flag uses the last value.

```sh
clip https://developer.mozilla.org/en-US/docs/Web/CSS \
  --title "CSS reference" --tags css,reference --note "Check grid examples."
clip ./screenshot.png --alt "A two-column search layout" --tag design
clip - --tags notes,ideas --note "Follow up next week." < note.md
```

For a stdin note, `--note` appends to the original content with a blank line between them. It doesn't replace the piped text. Notes use their Markdown content for the title; `--title` is only for links and videos. Use `--` to end option parsing if your input starts with a dash.

## Saving content

Cliplink detects the input type and fetches the available metadata. It supports five kinds: `link`, `tweet`, `image`, `video`, and `note`.

```sh
clip https://example.com/article
clip https://x.com/someone/status/123
clip ./screenshot.png
clip 'https://www.youtube.com/watch?v=VIDEO_ID'
clip - < note.md
```

Set `$VISUAL` or `$EDITOR` before choosing the interactive editor prompt. The CLI prefers `$VISUAL` when both exist. Prompts require terminal input and output; piped notes work without a prompt.

GitHub links receive a `github` tag automatically. Add your own with `--tag` or `--tags`, or edit the generated frontmatter later.

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

Remote publishing doesn't update local files after a successful publish. It checks each destination path against the current remote tree and stops before writing if Markdown or assets would replace existing content. Pull the latest changes into your clone before saving a repeated item so the CLI can choose an unused slug:

```sh
git pull --ff-only
```

Without a clone, give a repeated link or video a different `--title`, or use an up-to-date checkout to generate the next available slug. The CLI also stops if GitHub can't return a complete tree for the collision check. It never forces a branch update.

### Website deployment

`clip init` creates a public repository and records it in the CLI configuration. It doesn't finish the website setup. Follow the [template instructions](https://github.com/iamrajjoshi/cliplink-template#quick-start) to set your identity in `site.config.mjs`, select GitHub Actions for Pages, and deploy.

After setup, commits to `main` trigger the template's build and deployment workflow. A successful CLI publish confirms the Git commit, not a completed Pages deployment.

## Configuration

`clip login` records your GitHub username, and `clip init` records your new repository. To target an existing compatible site or another branch:

```sh
clip config
clip config set github.owner YOUR_GITHUB_USERNAME
clip config set github.repo YOUR_REPO
clip config set github.branch main
clip config get github.repo
```

Configuration lives at `~/.config/clip/config.json`, or `$XDG_CONFIG_HOME/clip/config.json` when set. The `github.branch` setting controls GitHub API publishing; local Git uses the checkout's current branch.

After renaming a GitHub repository, update `github.repo` to the new name and update your clone's `origin` URL. Check its Pages deployment and custom domain separately.

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

Local mode requires a site checkout. Run from it or pass `--repo /path/to/your/site`. For remote publishing without a clone, upgrade to 0.2.0 or later and run `clip login` and `clip init` (or configure your existing repository).

**The publish succeeded, but the website hasn't changed**

Check the destination repository's Actions run and Pages settings. Also confirm that the CLI targets the branch the website deploys from.

**`--no-push` still published a clip**

That flag only affects local Git. Use `--local --no-push` together. This still writes files and creates a commit.

**A command can't find my stored token**

macOS Keychain access depends on terminal output and skips CI. Use local Git when running in that environment, or log in through the credential backend you intend to use. Don't put tokens in your site repository or issue reports.
