import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KeychainStore } from "../auth";
import { ConfigStore, type ClipConfig } from "../config";
import { getDefaultTagsForUrl } from "../default-tags";
import { detectInput } from "../detect";
import { detectMode, type PublishMode } from "../mode";
import { serializeClip } from "../markdown";
import { resolveProjectPaths } from "../paths";
import { collectPrompts } from "../prompts";
import { createPublisher } from "../publishers";
import type { Publisher, PublishResult, Asset, PublishParams } from "../publishers/types";
import { clipFrontmatterSchema, type ClipFrontmatter } from "../schema";
import { inspectImage } from "../scrapers/image";
import { scrapeLink } from "../scrapers/og";
import { scrapeTweet } from "../scrapers/tweet";
import { scrapeVideo } from "../scrapers/video";
import { baseSlugFromText, datedFilename, ensureUniqueSlug } from "../slug";
import type { CliOptions } from "../types";
import {
  expandHomeDirectory,
  extFromContentType,
  fetchBuffer,
  pathExtFromUrl,
  sanitizeFilename,
  slugify,
} from "../utils";
import { printHelp } from "./help";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    noPush: false,
    help: false,
    local: false,
  };

  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--") {
      continue;
    }

    if (arg === "--repo") {
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --repo");
      }

      options.repo = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--repo=")) {
      const value = arg.slice("--repo=".length);

      if (!value) {
        throw new Error("Missing value for --repo");
      }

      options.repo = value;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--local") {
      options.local = true;
      continue;
    }

    if (arg === "--no-push") {
      options.noPush = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 1) {
    throw new Error("Only a single input value is supported.");
  }

  options.input = positionals[0];
  return options;
}

async function downloadOptionalAsset({
  slug,
  url,
  fallbackName,
  dryRun,
  clipsAssetRelDir,
}: {
  slug: string;
  url?: string;
  fallbackName: string;
  dryRun: boolean;
  clipsAssetRelDir: string;
}): Promise<{ url: string; asset?: Asset } | undefined> {
  if (!url) {
    return undefined;
  }

  const guessedExt = pathExtFromUrl(url);
  const safeBase =
    sanitizeFilename(path.basename(fallbackName, path.extname(fallbackName))) || "asset";

  if (dryRun) {
    const ext = guessedExt || path.extname(fallbackName);
    return { url: `/clips/${slug}/${safeBase}${ext}` };
  }

  try {
    const { buffer, contentType } = await fetchBuffer(url);
    const resolvedExt =
      guessedExt || extFromContentType(contentType) || path.extname(fallbackName) || ".bin";
    const filename = `${safeBase}${resolvedExt}`;
    return {
      url: `/clips/${slug}/${filename}`,
      asset: {
        filename,
        buffer,
        path: path.join(clipsAssetRelDir, slug, filename),
      },
    };
  } catch (error) {
    console.warn(
      `warning: could not download ${url}:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

function commitSubject(frontmatter: ClipFrontmatter) {
  switch (frontmatter.kind) {
    case "link":
      return frontmatter.slug;
    case "tweet":
      return `${frontmatter.author.handle} tweet`;
    case "image":
      return `${frontmatter.slug} image`;
    case "video":
      return `${frontmatter.slug} video`;
    case "note":
      return `${frontmatter.slug} note`;
  }
}

function commitMessage(frontmatter: ClipFrontmatter) {
  return `:sparkles: feat[clips]: add ${commitSubject(frontmatter)} clip`;
}

/**
 * Prepared clip data — the result of detect → scrape → prompt → validate →
 * generate, ready to be published.
 */
export interface PreparedClip {
  frontmatter: ClipFrontmatter;
  markdown: string;
  filename: string;
  markdownPath: string;
  assets: Asset[];
}

/**
 * Injectable dependencies for the clip command. Used in tests to mock the
 * token store, config store, and publisher factory without touching real
 * Keychain, config files, or network.
 */
export interface ClipCommandDeps {
  keychain?: { read(): Promise<string | null> };
  configStore?: { read(): Promise<ClipConfig> };
  createPublisherFn?: typeof createPublisher;
}

/**
 * Executes the publishing step: determines the mode (local vs remote), reads
 * config for remote mode, handles dry-run previews, warns about --no-push in
 * remote mode, and reports the mode in the output.
 *
 * Extracted from runClipCommand so the mode-detection and publishing logic can
 * be tested independently of the detect/scrape/prompt flow.
 */
export async function executePublishing(
  prepared: PreparedClip,
  options: Pick<CliOptions, "dryRun" | "noPush" | "local">,
  repoRoot: string,
  deps?: ClipCommandDeps,
): Promise<PublishResult> {
  // Check for token to determine publishing mode (local vs remote)
  let token: string | null = null;
  try {
    const keychain = deps?.keychain ?? new KeychainStore();
    token = await keychain.read();
  } catch {
    // If token check fails, default to local mode
    token = null;
  }

  const mode: PublishMode = detectMode({ local: options.local, token });

  // --no-push is only meaningful in local mode; warn in remote mode
  if (mode === "remote" && options.noPush) {
    console.warn("warning: --no-push is only meaningful in local mode; ignored in remote mode");
  }

  if (options.dryRun) {
    console.log(`mode: ${mode}`);
    console.log(`# ${prepared.filename}\n`);
    console.log(prepared.markdown);
    return { mode, committed: false, pushed: false, location: "" };
  }

  // Read config for remote mode (owner, repo, branch)
  let github: { owner: string; repo: string; branch: string } | undefined;
  if (mode === "remote") {
    const configStore = deps?.configStore ?? new ConfigStore();
    const config = await configStore.read();
    github = config.github;
  }

  const factory = deps?.createPublisherFn ?? createPublisher;
  const publisher: Publisher = factory({
    repoRoot,
    local: options.local,
    token,
    github,
  });

  const publishParams: PublishParams = {
    slug: prepared.frontmatter.slug,
    markdownContent: prepared.markdown,
    markdownFilename: prepared.filename,
    markdownPath: prepared.markdownPath,
    assets: prepared.assets,
    commitMessage: commitMessage(prepared.frontmatter),
    dryRun: options.dryRun,
    noPush: options.noPush,
  };

  const result = await publisher.publish(publishParams);

  console.log(
    `saved ${prepared.frontmatter.kind} clip: ${prepared.filename} (mode: ${result.mode})`,
  );
  return result;
}

/** Run the clip command: detect → scrape → prompt → validate → publish. */
export async function runClipCommand(args: string[], deps?: ClipCommandDeps): Promise<void> {
  const options = parseArgs(args);
  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  const cliDir = path.dirname(fileURLToPath(import.meta.url));

  if (options.help || !options.input) {
    printHelp();
    return;
  }

  const explicitRepo = options.repo ?? process.env.CLIP_REPO;
  const paths = explicitRepo
    ? await resolveProjectPaths({
        start: path.resolve(expandHomeDirectory(explicitRepo)),
      })
    : await resolveProjectPaths({
        start: cliDir,
        fallbackStarts: [invocationCwd],
      });
  const detection = await detectInput(options.input, invocationCwd);
  const clipsAssetRelDir = path.relative(paths.repoRoot, paths.clipsAssetDir);
  const clippedAt = new Date();

  let frontmatter: ClipFrontmatter;
  let body: string;
  let assets: Asset[] = [];

  if (detection.kind === "link") {
    const scraped = await scrapeLink(detection.url.toString());
    const initialSlug = slugify(scraped.title) || slugify(detection.url.hostname) || "link";
    const slug = await ensureUniqueSlug(initialSlug, paths.contentDir);
    const prompts = await collectPrompts();
    const favicon = await downloadOptionalAsset({
      slug,
      url: scraped.faviconUrl,
      fallbackName: "favicon.png",
      dryRun: options.dryRun,
      clipsAssetRelDir,
    });
    const ogImage = await downloadOptionalAsset({
      slug,
      url: scraped.ogImageUrl,
      fallbackName: "og-image.png",
      dryRun: options.dryRun,
      clipsAssetRelDir,
    });

    if (favicon?.asset) assets.push(favicon.asset);
    if (ogImage?.asset) assets.push(ogImage.asset);

    frontmatter = clipFrontmatterSchema.parse({
      kind: "link",
      slug,
      clippedAt,
      tags: getDefaultTagsForUrl(detection.url),
      url: detection.url.toString(),
      title: scraped.title,
      description: scraped.description,
      siteName: scraped.siteName,
      favicon: favicon?.url,
      ogImage: ogImage?.url,
    });
    body = prompts.body;
  } else if (detection.kind === "tweet") {
    const scraped = await scrapeTweet(detection.url.toString());
    const initialSlug =
      slugify(`${scraped.author.handle}-${scraped.text.slice(0, 40)}`) ||
      `${scraped.author.handle}-tweet`;
    const slug = await ensureUniqueSlug(initialSlug, paths.contentDir);
    const prompts = await collectPrompts();
    const avatar = await downloadOptionalAsset({
      slug,
      url: scraped.author.avatarUrl,
      fallbackName: "avatar.jpg",
      dryRun: options.dryRun,
      clipsAssetRelDir,
    });
    const media = [];

    for (const [index, item] of scraped.media.entries()) {
      const stored = await downloadOptionalAsset({
        slug,
        url: item.url,
        fallbackName: `media-${index + 1}.jpg`,
        dryRun: options.dryRun,
        clipsAssetRelDir,
      });

      if (stored) {
        media.push({
          src: stored.url,
          alt: item.alt,
        });
        if (stored.asset) assets.push(stored.asset);
      }
    }

    if (avatar?.asset) assets.push(avatar.asset);

    frontmatter = clipFrontmatterSchema.parse({
      kind: "tweet",
      slug,
      clippedAt,
      tags: [],
      platform: "x",
      url: detection.url.toString(),
      author: {
        name: scraped.author.name,
        handle: scraped.author.handle,
        avatar: avatar?.url,
      },
      text: scraped.text,
      postedAt: scraped.postedAt,
      media: media.length ? media : undefined,
    });
    body = prompts.body;
  } else if (detection.kind === "video") {
    const scraped = await scrapeVideo(detection.url.toString());
    const initialSlug = slugify(scraped.title) || `${scraped.provider}-video`;
    const slug = await ensureUniqueSlug(initialSlug, paths.contentDir);
    const prompts = await collectPrompts();
    const thumbnail = await downloadOptionalAsset({
      slug,
      url: scraped.thumbnailUrl,
      fallbackName: "thumbnail.jpg",
      dryRun: options.dryRun,
      clipsAssetRelDir,
    });

    if (thumbnail?.asset) assets.push(thumbnail.asset);

    frontmatter = clipFrontmatterSchema.parse({
      kind: "video",
      slug,
      clippedAt,
      tags: [],
      url: detection.url.toString(),
      provider: scraped.provider,
      title: scraped.title,
      channel: scraped.channel,
      thumbnail: thumbnail?.url,
    });
    body = prompts.body;
  } else if (detection.kind === "image") {
    const inspected = await inspectImage(detection.filePath);
    const initialSlug = slugify(inspected.stem) || "image";
    const slug = await ensureUniqueSlug(initialSlug, paths.contentDir);
    const prompts = await collectPrompts();
    const filename = `${sanitizeFilename(path.basename(inspected.filename, path.extname(inspected.filename))) || "image"}${path.extname(inspected.filename)}`;
    const src = `/clips/${slug}/${filename}`;

    if (!options.dryRun) {
      const buffer = await readFile(detection.filePath);
      assets.push({
        filename,
        buffer,
        path: path.join(clipsAssetRelDir, slug, filename),
      });
    }

    frontmatter = clipFrontmatterSchema.parse({
      kind: "image",
      slug,
      clippedAt,
      tags: [],
      src,
      width: inspected.width,
      height: inspected.height,
      alt: slug.replace(/-/g, " "),
    });
    body = prompts.body;
  } else if (detection.kind === "note") {
    const initialSlug = baseSlugFromText(detection.stdinText, "note");
    const slug = await ensureUniqueSlug(initialSlug, paths.contentDir);
    const prompts = await collectPrompts(detection.stdinText);

    frontmatter = clipFrontmatterSchema.parse({
      kind: "note",
      slug,
      clippedAt,
      tags: [],
    });
    body = prompts.body;
  } else {
    throw new Error(`Unsupported detection kind: ${String(detection)}`);
  }

  const filename = datedFilename(frontmatter.clippedAt, frontmatter.slug);
  const markdown = serializeClip(frontmatter, body);
  const markdownPath = path.relative(paths.repoRoot, path.join(paths.contentDir, filename));

  await executePublishing(
    { frontmatter, markdown, filename, markdownPath, assets },
    options,
    paths.repoRoot,
    deps,
  );
}
