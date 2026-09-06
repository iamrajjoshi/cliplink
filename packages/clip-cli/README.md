# Cliplink

**Good finds. Kept close.**

Save links, images, X posts, video references, and notes as Markdown in your own GitHub repository. The [Cliplink template](https://github.com/iamrajjoshi/cliplink-template) turns your collection into a website with search, individual pages, and RSS.

[Website](https://cliplink.dev/) · [Quick start](https://github.com/iamrajjoshi/cliplink#quick-start) · [CLI guide](https://github.com/iamrajjoshi/cliplink/blob/main/docs/cli.md) · [Example collection](https://clips.rajjoshi.me/)

## Install

Use Node.js 24 (recommended), Git, and a GitHub account.

```sh
npm install --global cliplink
```

The package installs the `clip` command. Run `clip login`, then `clip init` to create a **public** repository from the template. Enter `clip` as its name to follow the [quick start](https://github.com/iamrajjoshi/cliplink#quick-start).

**npm 0.1.1 requires a local clone of your site**, including for GitHub API publishing. Run commands from that checkout or pass `--repo /path/to/your/site`. Source `main` includes a no-clone workflow that hasn't shipped yet.

Configure the template and GitHub Pages separately to put the website online. Keep your checkout current: remote publishing checks local filenames for collisions, so repeated slugs can overwrite remote content. The [CLI guide](https://github.com/iamrajjoshi/cliplink/blob/main/docs/cli.md) covers publishing, authentication, and troubleshooting.

## Try a clip

From your cloned site:

```sh
clip https://developer.mozilla.org/en-US/docs/Web/CSS
clip ./screenshot.png
```

Add `--dry-run` to print the Markdown without writing files or publishing. Run `clip --help` for available commands and flags.
