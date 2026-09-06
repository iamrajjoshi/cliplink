# Cliplink landing page

The product page lives in `site/` in this repository. It is plain HTML, CSS, and JavaScript, with self-hosted Gabarito and no runtime dependencies. A small Node build script adds the centered footer commit link. The CLI remains independent of it.

## Preview

```sh
pnpm site:dev
```

Open `http://127.0.0.1:4333/`. Set `CLIPLINK_SITE_PORT` if that port is occupied. The server is a loopback-only development helper, not a production server.

```sh
pnpm site:check
pnpm exec eslint site scripts
```

The tests check local assets, commit links, response types, and static-server boundaries. Browser review should cover 320px/mobile and desktop, light/dark mode, keyboard controls, example selection/save, copy success/failure, and reduced motion.

The preview inserts the current checkout's commit SHA as it serves the page. It doesn't write that SHA into `site/index.html` or fetch it from GitHub. Uncommitted edits still show the checkout's HEAD commit.

## Build

```sh
pnpm site:build
```

The build copies the page and assets into `dist/site/` and inserts a seven-character commit label linking to the full commit. It uses `GITHUB_SHA` in CI, with local `git rev-parse HEAD` as the fallback. If neither supplies a commit, the footer links to the repository as **Source**. Generated files stay out of version control.

## Publish

No deployment happens merely because these files are present. After reviewing and pushing them:

1. In this repository's **Settings → Pages**, select **GitHub Actions** as the source.
2. Run **Deploy Cliplink landing page** from Actions. It validates, builds, and uploads only `dist/site/`.
3. Use the successful run's `page_url` as the actual public URL. No custom domain is assumed.

The workflow is manual. The page's assets use relative paths, so GitHub's repository subpath works. Other static hosts should run `pnpm site:build` and serve `dist/site/`. Keep its `fonts/` folder and license notice together. Opening the source HTML directly still works, with a **Source** link instead of a stamped commit.

Publish the updated template before the landing page: the setup text describes the new `site.config.mjs` and base-path-aware Pages workflow. The landing's CLI examples deliberately retain the clone step required by npm 0.1.1; the no-clone fix in this repository is unreleased. Publishing this page does **not** publish a new npm version.

## Editing

- `site/index.html`: copy, example structure, setup instructions.
- `site/styles.css`: the mulberry/yellow palette, spacing, responsive layout, and motion.
- `site/theme.js`: stored preference before the first paint, with system fallback.
- `site/main.js`: theme control, illustrative clip interactions, and copy feedback.

The template and landing share Gabarito, the mulberry/yellow palette, and a single-stroke folded-loop mark. The font is self-hosted with its OFL notice included. There is no cross-repo runtime dependency. Their presentation differs deliberately: the template has a quiet chronological feed; the landing has a broad yellow introduction and a flat, folder-tab example. The short save feedback stays inside that example, with no entrance animation delaying the page.

The example uses the “Try a clip” label and confirms “Added to this example.” It does not fetch metadata, write files, or publish anything. Don't present edited sample titles, notes, or tags as automatically generated CLI output.

Keep descriptions direct. Avoid contrast slogans such as “X, not Y.” The footer author link should remain visibly underlined, and the README link should sit on its own line below the setup note.

See [Design direction](design-direction.md) for the research and decisions.
