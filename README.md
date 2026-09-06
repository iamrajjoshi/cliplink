<p align="center">
  <a href="https://cliplink.dev/">
    <img src="site/favicon.svg" width="64" height="64" alt="Cliplink logo" />
  </a>
</p>

<h1 align="center">Cliplink</h1>

<p align="center">
  <strong>Good finds. Kept close.</strong><br />
  Save things from your terminal to a website of your own.
</p>

<p align="center">
  <a href="https://cliplink.dev/">Website</a> ·
  <a href="https://github.com/iamrajjoshi/cliplink-template">Default template</a> ·
  <a href="https://clips.rajjoshi.me/">Example collection</a> ·
  <a href="docs/cli.md">CLI guide</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cliplink">
    <img src="https://img.shields.io/npm/v/cliplink?style=flat-square&amp;labelColor=352d31&amp;color=9d274b" alt="Latest version on npm" />
  </a>
</p>

Cliplink saves links, images, X posts, video references, and notes as Markdown in your GitHub repository. Add a note about why you kept something; the [Astro template](https://github.com/iamrajjoshi/cliplink-template) gives your collection a searchable feed, individual pages, and RSS.

Your clips and images stay in your repository. Edit the files directly, change the design, or build your own site around them.

## Quick start

You'll need **Node.js 24** (recommended), Git, and a GitHub account. The package is `cliplink`; the command is `clip`.

```sh
npm install --global cliplink
clip login
clip init
```

Follow the browser login, then enter **`clip`** as the repository name when `clip init` asks. This creates a **public** copy of the template. Pick another name if you already have a `clip` repository.

Clone it, replacing `YOUR_GITHUB_USERNAME` with your username:

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/clip.git
cd clip
```

> [!IMPORTANT]
> Run the published CLI, **0.1.1**, from your cloned site. The no-clone workflow on `main` hasn't shipped to npm yet. If you chose a different repository name, use that name in the clone command and directory.

To put the site online, edit `site.config.mjs`, choose **GitHub Actions** in your repository's **Settings → Pages**, then commit and push the configuration. The [template setup guide](https://github.com/iamrajjoshi/cliplink-template#quick-start) covers deployment and custom domains.

Once you've pushed the configuration, save your first clip:

```sh
clip https://developer.mozilla.org/en-US/docs/Web/CSS
```

## What will you keep?

```sh
# A link, with its title and description
clip https://developer.mozilla.org/en-US/docs/Web/CSS

# An image from your computer
clip ./screenshot.png

# A video reference
clip 'https://www.youtube.com/watch?v=VIDEO_ID'

# A note from stdin, using local Git
printf 'Give the useful things enough space.\n' | clip - --local
```

X posts work too: pass a public post URL to `clip`. For interactive clips, you can add your own note through `$VISUAL` or `$EDITOR`.

Want to see the Markdown first?

```sh
clip https://developer.mozilla.org/en-US/docs/Web/CSS --dry-run
```

A dry run can fetch metadata, but it doesn't write files or publish. Video clips save a reference and an available thumbnail; the video stays at its source.

## Your files, your site

```text
your-site/
└── apps/web/
    ├── src/content/clips/   Markdown entries with YAML frontmatter
    └── public/clips/        Saved images and thumbnails
```

The CLI gathers content and commits it. The template handles how it looks and deploys through GitHub Pages. You can customize the template independently; both projects use the same [`cliplink-schema`](packages/clip-schema/src/index.ts).

After `clip login`, publishing uses the GitHub API. Use `--local` to write through your checkout and local Git instead; add `--no-push` to make a local commit without pushing.

> [!WARNING]
> GitHub API publishing doesn't refresh your checkout. Keep it current: collision checks use local filenames, so repeated slugs can overwrite existing remote content. See [publishing behavior](docs/cli.md#publishing) before saving repeated items.

## Documentation

| Looking for                                | Start here                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| Flags, authentication, and troubleshooting | [CLI guide](docs/cli.md)                                                       |
| Your collection's design and deployment    | [Template setup](https://github.com/iamrajjoshi/cliplink-template#quick-start) |
| Local development and checks               | [Contributing](CONTRIBUTING.md)                                                |
| The Cliplink product website               | [Landing page development](docs/site.md)                                       |

## Contributing

Bug reports and pull requests are welcome. Include the command you ran, your CLI and Node versions, and what you expected to happen. Leave tokens and private content out of reports.

See [Contributing](CONTRIBUTING.md) for the development setup, or [open an issue](https://github.com/iamrajjoshi/cliplink/issues).

<p align="center">
  Made by <a href="https://rajjoshi.me/">Raj Joshi</a>
</p>
