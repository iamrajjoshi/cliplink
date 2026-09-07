# Cliplink

**Good finds. Kept close.**

Save links, images, X posts, video references, and notes as Markdown in your own GitHub repository. The [Cliplink template](https://github.com/iamrajjoshi/cliplink-template) turns your collection into a website with search, individual pages, and RSS.

[Website](https://cliplink.dev/) · [Quick start](https://github.com/iamrajjoshi/cliplink#quick-start) · [CLI guide](https://github.com/iamrajjoshi/cliplink/blob/main/docs/cli.md) · [Example collection](https://clips.rajjoshi.me/)

## Install

Use Node.js 24 (recommended), Git, and a GitHub account.

```sh
npm install --global cliplink
```

The package installs the `clip` command. Run `clip login`, then `clip init` to create a **public** repository from the template. Choose any available name; Cliplink remembers it.

With **0.2.0**, remote publishing works from any directory after setup. Use a local clone to edit the site or publish with `--local`.

Configure the template and GitHub Pages separately to put the website online. Remote publishing rejects existing destination paths to protect saved clips and assets. The [CLI guide](https://github.com/iamrajjoshi/cliplink/blob/main/docs/cli.md) covers publishing, authentication, and troubleshooting.

## Try a clip

```sh
clip https://developer.mozilla.org/en-US/docs/Web/CSS \
  --title "CSS reference" --tags css,reference --note "Check grid examples."
clip ./screenshot.png --alt "A two-column search layout" --tag design
clip - --tag notes < note.md
```

Add `--dry-run` to print the Markdown without writing files or publishing. Tags and notes apply to all clip kinds; title applies to links and videos, description to links, and alt text to images. Run `clip --help` for available commands and flags.
