function normalizeHostname(url: URL) {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

export function getDefaultTagsForUrl(url: URL) {
  const hostname = normalizeHostname(url);

  if (hostname === "github.com") {
    return ["github"];
  }

  return [];
}
