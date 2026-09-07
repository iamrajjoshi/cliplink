# Contributing to Cliplink

Start with the setup below, then run the checks that cover your change.

## Development setup

Use Node.js 24 and pnpm 10.25.0. If you don't already have that pnpm version:

```sh
npm install --global pnpm@10.25.0
```

Clone the repository and install its dependencies:

```sh
git clone https://github.com/iamrajjoshi/cliplink.git
cd cliplink
pnpm install --frozen-lockfile
pnpm --filter cliplink clip --help
```

Check [release status](docs/cli.md#release-status) before updating user-facing examples, and test commands against the packaged CLI before a release.

## Where things live

| Path                               | Contents                                                         |
| ---------------------------------- | ---------------------------------------------------------------- |
| `packages/clip-cli/src/`           | Commands, metadata scrapers, authentication, and publishers      |
| `packages/clip-cli/src/__tests__/` | CLI tests                                                        |
| `packages/clip-schema/src/`        | The content schema shared with the template                      |
| `site/`                            | The static product page at [cliplink.dev](https://cliplink.dev/) |
| `scripts/`                         | Landing-page build, preview, and tests                           |

The collection website lives in [cliplink-template](https://github.com/iamrajjoshi/cliplink-template). Keep template rendering changes there and CLI behavior changes here.

## Check your changes

```sh
pnpm test
pnpm check
pnpm lint
pnpm build
pnpm package:check
pnpm format:check
```

For landing-page changes, also run:

```sh
pnpm site:check
pnpm site:build
pnpm exec eslint site scripts
```

Use `pnpm site:dev` to preview the landing page at `http://127.0.0.1:4333/`. See [landing-page development](docs/site.md) for browser checks and deployment details.

## Before opening a pull request

Keep the change focused and explain what it fixes. Add tests when you change CLI behavior; when you change a command or default, update its documentation too. Check both GitHub API and local Git publishing when touching shared code.

For a bug report, include the CLI and Node versions, the command you ran, and the error output with tokens and private content removed. A small reproducible example helps more than a full checkout.

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Please use the [private reporting route](SECURITY.md) for vulnerabilities and keep ordinary questions in [Support](SUPPORT.md).

## Licensing and releases

Contributions to this repository use the [MIT license](LICENSE). If you add third-party code or assets, preserve their licenses and update [the notices](THIRD_PARTY_NOTICES.md). Each npm package includes a copy of the root license; `pnpm package:check` verifies those copies and the files that will ship.

For a release, update only the packages that changed and add a changelog entry. Run the checks above, including the package check after building, before tagging `v<cliplink-version>`. The tag starts the npm workflow through GitHub's trusted publishing; it skips package versions already on npm. See [the changelog](CHANGELOG.md) for released versions.
