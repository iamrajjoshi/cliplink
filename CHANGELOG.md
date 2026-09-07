# Changelog

## 0.2.1

- Add MIT licensing to the repository and both npm packages, including Zod's bundled license notice.
- Add package metadata and a schema README. Publish `cliplink-schema@0.1.2` with no schema changes.
- Add contributor checks, package-content validation, issue forms, and security/support policies.
- Schedule dependency updates and document third-party font licenses.
- Update Sharp to fix the upstream libvips vulnerabilities described in [GHSA-f88m-g3jw-g9cj](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj).

Commands and flags are unchanged from 0.2.0.

## 0.2.0 · 2026-09-06

- Add `--tag`, `--tags`, `--title`, `--description`, `--alt`, and `--note` flags. Tags and notes work with every clip kind; the CLI validates the other fields against the clip type. Both spaced and `--flag=value` syntax work.
- Publish through GitHub from any directory after login and repository setup. `clip init` accepts a custom repository name and saves it in the configuration.
- Check remote destination paths before writing. Existing clips and assets stay untouched when a new save would collide with them, including after a concurrent branch update.
- Document setup and metadata flags in the README and CLI guide. Node.js 24 is recommended; the package now declares the runtime versions its prompt dependencies support.

The release also includes the updated Cliplink landing page, with clearer headline spacing, fewer dividers, and the commit link on the footer's main row. The shared schema remains at 0.1.1.
