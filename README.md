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
  <a href="docs/cli.md">CLI guide</a> ·
  <a href="#use-with-an-agent">Agent skill</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cliplink">
    <img src="https://img.shields.io/npm/v/cliplink?style=flat-square&amp;labelColor=352d31&amp;color=9d274b" alt="Latest version on npm" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-9d274b?style=flat-square&amp;labelColor=352d31" alt="MIT license" />
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

Follow the browser login, then choose a repository name when `clip init` asks. This creates a **public** copy of the template and remembers your choice.

Clone it to customize the site, replacing `YOUR_GITHUB_USERNAME` and `YOUR_REPO`:

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

With Cliplink 0.2.0, you can save clips from any directory after login and setup. A local clone is only required for editing the site or using `--local`.

To put the site online, edit `site.config.mjs`, choose **GitHub Actions** in your repository's **Settings → Pages**, then commit and push the configuration. The [template setup guide](https://github.com/iamrajjoshi/cliplink-template#quick-start) covers deployment and custom domains.

Once you've pushed the configuration, save your first clip:

```sh
clip https://developer.mozilla.org/en-US/docs/Web/CSS
```

## What will you keep?

```sh
# A link with your own title, tags, and note
clip https://developer.mozilla.org/en-US/docs/Web/CSS \
  --title "CSS reference" --tags css,reference \
  --note "Useful when I remember what a property does but forget its name."

# An image from your computer
clip ./screenshot.png

# A video reference
clip 'https://www.youtube.com/watch?v=VIDEO_ID'

# A Markdown note from a file
clip - --tag notes < note.md
```

X posts work too: pass a public post URL to `clip`. Use `--note` to add your own words directly, or use `$VISUAL` or `$EDITOR` through the interactive prompt. See the [metadata flags](docs/cli.md#metadata-flags) for descriptions, image alt text, and supported clip kinds.

Want to see the Markdown first?

```sh
clip https://developer.mozilla.org/en-US/docs/Web/CSS --dry-run
```

A dry run can fetch metadata, but it doesn't write files or publish. Video clips save a reference and an available thumbnail; the video stays at its source.

## Use with an agent

The [Cliplink skill](skills/cliplink/SKILL.md) teaches your coding agent how to save clips, add metadata, preview Markdown, and check the publishing destination.

Install it with the [Skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add iamrajjoshi/cliplink --skill cliplink
```

Choose your agent and installation scope when prompted. You'll still need the Cliplink CLI installed and your collection configured.

Then ask your agent:

> Save this link to my Cliplink collection with the tags css and reference. Preview the Markdown first.

The skill covers setup and failed-save recovery too, including the difference between previewing, making a local commit, and publishing to GitHub.

## Your files, your site

```text
your-site/
└── apps/web/
    ├── src/content/clips/   Markdown entries with YAML frontmatter
    └── public/clips/        Saved images and thumbnails
```

The CLI gathers content and commits it. The template handles how it looks and deploys through GitHub Pages. You can customize the template independently; both projects use the same [`cliplink-schema`](packages/clip-schema/src/index.ts).

After `clip login`, publishing uses the GitHub API. Use `--local` to write through your checkout and local Git instead; add `--no-push` to make a local commit without pushing.

GitHub API publishing doesn't refresh your checkout. It checks the remote paths before writing and stops if a clip or asset already exists. See [publishing behavior](docs/cli.md#publishing) before saving repeated items.

## Documentation

| Looking for                                | Start here                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| Flags, authentication, and troubleshooting | [CLI guide](docs/cli.md)                                                       |
| Saving clips with a coding agent           | [Agent skill](skills/cliplink/SKILL.md)                                        |
| Your collection's design and deployment    | [Template setup](https://github.com/iamrajjoshi/cliplink-template#quick-start) |
| Local development and checks               | [Contributing](CONTRIBUTING.md)                                                |
| The Cliplink product website               | [Landing page development](docs/site.md)                                       |

## Contributing

Bug reports and pull requests are welcome. Include the command you ran, your CLI and Node versions, and what you expected to happen. Leave tokens and private content out of reports.

See [Contributing](CONTRIBUTING.md) for the development setup, or [open an issue](https://github.com/iamrajjoshi/cliplink/issues).

For questions, see [Support](SUPPORT.md). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and send sensitive reports through the [security policy](SECURITY.md).

## License

[MIT](LICENSE), copyright 2026 Raj Joshi. Bundled dependencies and fonts retain their [third-party licenses](THIRD_PARTY_NOTICES.md).

<p align="center">
  Made by <a href="https://rajjoshi.me/">Raj Joshi</a>
</p>
