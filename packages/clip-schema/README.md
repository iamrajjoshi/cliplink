# cliplink-schema

Zod schemas for the Markdown frontmatter used by [Cliplink](https://cliplink.dev/) and its [Astro template](https://github.com/iamrajjoshi/cliplink-template).

```sh
npm install cliplink-schema
```

```ts
import { clipDataSchema } from "cliplink-schema";

const clip = clipDataSchema.parse({
  kind: "link",
  url: "https://example.com/",
  title: "Example",
  clippedAt: new Date(),
  tags: ["reference"],
});
```

`clipDataSchema` accepts link, tweet, image, video, and note metadata. `clipFrontmatterSchema` also requires a slug. Individual schemas and the `ClipFrontmatter` and `ClipKind` TypeScript types are available as named exports.

This package exports TypeScript source for bundlers and TypeScript-aware runtimes. For the terminal command, install [`cliplink`](https://www.npmjs.com/package/cliplink) instead.

## License and support

[MIT](LICENSE). Report bugs in the [Cliplink repository](https://github.com/iamrajjoshi/cliplink/issues); follow the [security policy](https://github.com/iamrajjoshi/cliplink/blob/main/SECURITY.md) for sensitive reports.
