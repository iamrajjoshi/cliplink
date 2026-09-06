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

The source CLI and the npm release differ in a few places. Read [release status](docs/cli.md#release-status) before updating user-facing examples.

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
