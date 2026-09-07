# Security

## Supported releases

Security fixes target the latest published versions of `cliplink` and `cliplink-schema`. Older releases don't receive separate backports. Check your CLI version with `clip --version` and update with `npm install --global cliplink@latest`.

## Report a vulnerability privately

Use [GitHub's private vulnerability reporting](https://github.com/iamrajjoshi/cliplink/security/advisories/new). Please keep suspected vulnerabilities out of public issues and pull requests.

Include the affected package and version, your operating system, and a small example that explains the problem and its impact. Remove tokens, credentials, private repository names, and personal content before sharing logs or screenshots. Use placeholder values when possible.

For ordinary bugs or setup questions, see [Support](SUPPORT.md).

## Before saving a clip

- `clip init` creates a **public** GitHub repository. Saved Markdown and assets become part of its Git history; removing a file later doesn't erase earlier commits.
- `clip login` requests GitHub's `repo` OAuth scope. The [CLI guide](docs/cli.md#authentication) explains token storage and local Git authentication.
- A dry run can fetch metadata from the supplied URL, though it doesn't publish or write clip files.
- If you expose a token, revoke it in GitHub's settings. `clip logout` removes the locally stored token; it doesn't revoke it on GitHub.
