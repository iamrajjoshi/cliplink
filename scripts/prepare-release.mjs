import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const registry = "https://registry.npmjs.org";

export async function isPublished(pkg, fetchImpl = fetch) {
  const spec = `${pkg.name}@${pkg.version}`;
  const response = await fetchImpl(
    `${registry}/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`,
    { redirect: "error", signal: AbortSignal.timeout(30_000) },
  );

  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Cannot check ${spec}: npm registry returned HTTP ${response.status}`);
  }

  const published = await response.json();
  if (published.name !== pkg.name || published.version !== pkg.version) {
    throw new Error(`Cannot check ${spec}: npm registry returned unexpected package metadata`);
  }
  return true;
}

export async function prepareRelease({ cli, schema, tag }, fetchImpl = fetch) {
  if (tag !== `v${cli.version}`) {
    throw new Error(`Release tag must be v${cli.version}; received ${tag || "no tag"}`);
  }

  const [schemaPublished, cliPublished] = await Promise.all([
    isPublished(schema, fetchImpl),
    isPublished(cli, fetchImpl),
  ]);
  return { schemaPublish: !schemaPublished, cliPublish: !cliPublished };
}

async function main() {
  const [cli, schema] = await Promise.all(
    ["clip-cli", "clip-schema"].map(async (directory) =>
      JSON.parse(await readFile(new URL(`../packages/${directory}/package.json`, import.meta.url))),
    ),
  );
  const plan = await prepareRelease({ cli, schema, tag: process.argv[2] });
  console.log(
    `${schema.name}@${schema.version}: ${plan.schemaPublish ? "publish" : "already published"}`,
  );
  console.log(`${cli.name}@${cli.version}: ${plan.cliPublish ? "publish" : "already published"}`);

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `schema_publish=${plan.schemaPublish}\ncli_publish=${plan.cliPublish}\n`,
    );
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
