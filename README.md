# Cliplink

Save a link, image, video reference, X post, or note to a Markdown file in your own GitHub repository. The [Cliplink template](https://github.com/iamrajjoshi/cliplink-template) turns those files into a static website with a feed, permalinks, and RSS.

The npm package is `cliplink`; the command is `clip`. See [Raj's clips](https://clip.rajjoshi.me) for a working collection. The product landing page lives in `site/`, targets [cliplink.dev](https://cliplink.dev/), and has its own [preview and deployment instructions](docs/site.md).

## Get started

You need Node.js 20 or newer, Git, and a GitHub account.

```sh
npm install -g cliplink
clip login
clip init
```

`clip login` prints a GitHub verification URL and code. Authorize in your browser, then run `clip init` and enter `clip` as the repository name. It creates a **public** repository from the template and saves that repository in your CLI configuration. Choose another name if you already have a repository called `clip`.

Clone your new repository, replacing `YOUR_GITHUB_USERNAME` and the repository name if needed:

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/clip.git
cd clip
clip https://example.com/article
```

The published npm version, **0.1.1**, still needs this local checkout, even when it publishes through the GitHub API. The source in this repository fixes that limitation and supports remote publishing without a clone; that fix hasn't shipped to npm yet. The source also changes the default repository name from `cliplink-template` to `clip`.

Creating the repository doesn't make the website live. Follow the [template's deployment instructions](https://github.com/iamrajjoshi/cliplink-template#quick-start) to configure your site and GitHub Pages. Once that setup works, publishing to `main` triggers the included build and deployment workflow.

## Save something

```sh
clip https://example.com/article
clip https://x.com/someone/status/123
clip ./screenshot.png
clip 'https://www.youtube.com/watch?v=VIDEO_ID'
printf 'A note worth keeping.\n' | clip - --local
```

The CLI detects the input type, fetches available metadata, and saves a Markdown file plus any downloaded images. Video clips contain a reference and thumbnail, not a downloaded video. X posts depend on X's syndication endpoint; unavailable or private posts may fail.

For interactive commands, you can add a note using `$VISUAL` or `$EDITOR`. Set one of those before choosing the editor prompt. GitHub links receive a `github` tag automatically; the CLI doesn't currently prompt for custom tags.

Preview the generated Markdown without writing files or publishing:

```sh
clip https://example.com/article --dry-run
```

Metadata requests can still happen during a dry run.

## Publishing

When a stored GitHub token is available, `clip` uses the GitHub API to commit the Markdown and assets together. Otherwise it uses local Git. `--local` always selects local Git, even after login.

```sh
clip https://example.com/article --local
clip https://example.com/article --local --no-push
clip --repo ~/code/clip https://example.com/article --local
```

`--no-push` still makes a local commit; it only skips the push. It has no effect in remote mode. You can set `CLIP_REPO` instead of passing `--repo` each time.

Remote publishing checks slug collisions against local content, not the remote repository. Keep your checkout current when saving repeated items; saving the same slug on the same day can otherwise replace its existing Markdown file.

## Configuration and authentication

`clip login` records your GitHub username, and `clip init` records the new repository. To use an existing compatible site or change the branch:

```sh
clip config
clip config set github.owner YOUR_GITHUB_USERNAME
clip config set github.repo clip
clip config set github.branch main
clip config get github.repo
```

Configuration lives at `~/.config/clip/config.json`, or `$XDG_CONFIG_HOME/clip/config.json` when set. Local Git mode uses the checkout's current branch and remote.

GitHub login requests the OAuth `repo` scope. Your account needs write access to the destination repository, and protected branches may prevent direct publishing. The CLI keeps the token outside your repository: in macOS Keychain during interactive use, or in an owner-readable credentials file when Keychain isn't available. Non-interactive commands don't read macOS Keychain; use local Git for piped notes if your token only lives there.

To switch accounts or replace an expired token:

```sh
clip logout
clip login
```

If you see `Could not find the clip workspace root`, run the installed CLI from your cloned site or pass `--repo /path/to/clip`. If publishing succeeds but the site doesn't update, inspect the destination repository's Actions run and Pages settings.

## Files and development

The CLI and template share the [`cliplink-schema` schema](packages/clip-schema/src/index.ts). Each clip uses one of five kinds: `link`, `tweet`, `image`, `video`, or `note`.

```text
your-site/
└── apps/web/
    ├── src/content/clips/YYYY-MM-DD-slug.md
    └── public/clips/slug/
```

Content includes YAML frontmatter and an optional Markdown body. The template owns rendering and deployment; this repository owns the CLI and shared schema.

Use pnpm 10.25.0 for development:

```sh
npx pnpm@10.25.0 install --frozen-lockfile
pnpm --filter cliplink clip --help
pnpm test
pnpm check
pnpm lint
pnpm build
pnpm format:check
```

Source: [commands](packages/clip-cli/src/commands), [publishers](packages/clip-cli/src/publishers), [template](https://github.com/iamrajjoshi/cliplink-template). The CLI has no required application server or database; GitHub handles repository storage and the template's default hosting.
