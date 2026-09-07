# Changelog

## 0.2.0 · 2026-09-06

- Add `--tag`, `--tags`, `--title`, `--description`, `--alt`, and `--note` flags. Tags and notes work with every clip kind; the CLI validates the other fields against the clip type. Both spaced and `--flag=value` syntax work.
- Publish through GitHub from any directory after login and repository setup. `clip init` accepts a custom repository name and saves it in the configuration.
- Check remote destination paths before writing. Existing clips and assets stay untouched when a new save would collide with them, including after a concurrent branch update.
- Document setup and metadata flags in the README and CLI guide. Node.js 24 is recommended; the package now declares the runtime versions its prompt dependencies support.

The release also includes the updated Cliplink landing page, with clearer headline spacing, fewer dividers, and the commit link on the footer's main row. The shared schema remains at 0.1.1.
