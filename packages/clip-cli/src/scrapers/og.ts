import { parse } from "node-html-parser";

export type LinkScrapeResult = {
  title: string;
  description?: string;
  siteName?: string;
  faviconUrl?: string;
  ogImageUrl?: string;
};

function resolveAgainst(base: string, maybeRelative: string | null | undefined) {
  if (!maybeRelative) {
    return undefined;
  }

  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return undefined;
  }
}

function readMeta(document: ReturnType<typeof parse>, selector: string, attribute = "content") {
  return document.querySelector(selector)?.getAttribute(attribute) ?? undefined;
}

export async function scrapeLink(url: string): Promise<LinkScrapeResult> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "clip.rajjoshi.me/1.0 (+https://clip.rajjoshi.me)",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const document = parse(html);
    const parsedUrl = new URL(url);
    const title =
      readMeta(document, 'meta[property="og:title"]') ??
      readMeta(document, 'meta[name="twitter:title"]') ??
      document.querySelector("title")?.text.trim() ??
      parsedUrl.hostname.replace(/^www\./, "");
    const description =
      readMeta(document, 'meta[property="og:description"]') ??
      readMeta(document, 'meta[name="twitter:description"]') ??
      readMeta(document, 'meta[name="description"]');
    const siteName =
      readMeta(document, 'meta[property="og:site_name"]') ??
      parsedUrl.hostname.replace(/^www\./, "");

    const faviconHref =
      document.querySelector('link[rel="icon"]')?.getAttribute("href") ??
      document.querySelector('link[rel="shortcut icon"]')?.getAttribute("href") ??
      document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href");
    const ogImageHref =
      readMeta(document, 'meta[property="og:image"]') ??
      readMeta(document, 'meta[name="twitter:image"]');

    return {
      title,
      description,
      siteName,
      faviconUrl: resolveAgainst(url, faviconHref ?? "/favicon.ico"),
      ogImageUrl: resolveAgainst(url, ogImageHref),
    };
  } catch {
    const parsedUrl = new URL(url);

    return {
      title: parsedUrl.hostname.replace(/^www\./, ""),
      siteName: parsedUrl.hostname.replace(/^www\./, ""),
      faviconUrl: resolveAgainst(url, "/favicon.ico"),
    };
  }
}
