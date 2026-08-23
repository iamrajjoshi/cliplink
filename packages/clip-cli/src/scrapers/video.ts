export type VideoScrapeResult = {
  provider: "youtube" | "vimeo" | "other";
  title: string;
  channel?: string;
  thumbnailUrl?: string;
};

function getProvider(url: URL): VideoScrapeResult["provider"] {
  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtube.com" || host === "youtu.be") {
    return "youtube";
  }

  if (host === "vimeo.com") {
    return "vimeo";
  }

  return "other";
}

export async function scrapeVideo(url: string): Promise<VideoScrapeResult> {
  const parsed = new URL(url);
  const provider = getProvider(parsed);
  const endpoint =
    provider === "vimeo"
      ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
      : `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

  const response = await fetch(endpoint, {
    headers: {
      "user-agent": "clip.rajjoshi.me/1.0 (+https://clip.rajjoshi.me)",
    },
  });

  if (!response.ok) {
    return {
      provider,
      title: parsed.hostname.replace(/^www\./, ""),
    };
  }

  const data = (await response.json()) as {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
  };

  return {
    provider,
    title: data.title ?? parsed.hostname.replace(/^www\./, ""),
    channel: data.author_name,
    thumbnailUrl: data.thumbnail_url,
  };
}
