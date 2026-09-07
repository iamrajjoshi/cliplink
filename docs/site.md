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

The landing page targets **https://cliplink.dev/**. The workflow deploys site, script, and workflow changes pushed to `main`; it also supports manual runs. Domain setup happens once:

1. In this repository's **Settings → Pages**, select **GitHub Actions** as the source and set the custom domain to `cliplink.dev` before pointing DNS at GitHub.
2. Configure Cloudflare DNS for GitHub Pages, then enable **Enforce HTTPS** in Pages once its certificate is ready.
3. Run **Deploy Cliplink landing page** from Actions if no deployment has run yet. It validates, builds, and uploads only `dist/site/`. Confirm the successful run's `page_url` and test `https://cliplink.dev/` before treating the launch as complete.

GitHub stores the custom domain in Pages settings. This custom Actions workflow doesn't need a `CNAME` file; GitHub ignores that file for this publishing method. See [GitHub's domain setup instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

The page's canonical and Open Graph URLs point to `https://cliplink.dev/`. Assets use relative paths, so previews and GitHub's repository subpath still work. Other static hosts should run `pnpm site:build` and serve `dist/site/`. Keep its `fonts/` folder and license notice together. Opening the source HTML directly still works, with a **Source** link instead of a stamped commit.

Publish the updated template before changing setup instructions that depend on it. The landing keeps a clone step for editing `site.config.mjs`; Cliplink 0.2.0 can publish remotely without a clone after login and configuration. Publishing the landing page and publishing to npm use separate workflows.

## Editing

- `site/index.html`: copy, example structure, setup instructions.
- `site/styles.css`: the mulberry/yellow palette, spacing, responsive layout, and motion.
- `site/theme.js`: stored preference before the first paint, with system fallback.
- `site/main.js`: theme control, illustrative clip interactions, and copy feedback.

The template and landing share Gabarito, the mulberry/yellow palette, and a single-stroke folded-loop mark. The font is self-hosted with its OFL notice included. There is no cross-repo runtime dependency. Their presentation differs deliberately: the template has a quiet chronological feed; the landing has a broad yellow introduction and a flat, folder-tab example. The short save feedback stays inside that example, with no entrance animation delaying the page.

The example uses the “Try a clip” label and confirms “Added to this example.” It does not fetch metadata, write files, or publish anything. Don't present edited sample titles, notes, or tags as automatically generated CLI output.

Keep descriptions direct. Avoid contrast slogans such as “X, not Y.” The footer author link should remain visibly underlined, and the README link should sit on its own line below the setup note.

See [Design direction](design-direction.md) for the research and decisions.
