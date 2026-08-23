export type TweetScrapeResult = {
  platform: "x";
  text: string;
  postedAt: Date;
  author: {
    name: string;
    handle: string;
    avatarUrl?: string;
  };
  media: Array<{
    url: string;
    alt?: string;
  }>;
};

function tweetIdFromUrl(url: URL) {
  const match = url.pathname.match(/\/status\/(\d+)/);
  return match?.[1];
}

function getToken(id: string) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export async function scrapeTweet(url: string): Promise<TweetScrapeResult> {
  const parsed = new URL(url);
  const id = tweetIdFromUrl(parsed);

  if (!id) {
    throw new Error(`Could not determine tweet id from ${url}`);
  }

  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${getToken(id)}`;
  const response = await fetch(endpoint, {
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tweet metadata: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, any>;

  if (!data?.id_str || !data?.text || !data?.user?.screen_name) {
    throw new Error("Tweet metadata response was missing required fields.");
  }

  const mediaDetails = Array.isArray(data.mediaDetails) ? data.mediaDetails : [];
  const photos = Array.isArray(data.photos) ? data.photos : [];
  const media = mediaDetails.length
    ? mediaDetails
        .map((item) => ({
          url: item.media_url_https,
          alt: item.ext_alt_text,
        }))
        .filter((item) => Boolean(item.url))
    : photos
        .map((item) => ({
          url: item.url,
          alt: undefined,
        }))
        .filter((item) => Boolean(item.url));

  return {
    platform: "x",
    text: data.text,
    postedAt: new Date(data.created_at),
    author: {
      name: data.user.name,
      handle: data.user.screen_name,
      avatarUrl: data.user.profile_image_url_https,
    },
    media,
  };
}
