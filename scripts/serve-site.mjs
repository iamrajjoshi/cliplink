import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getCommitSha, stampCommit } from "./build-site.mjs";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../site");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export function createSiteServer(root = siteRoot) {
  return createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      let target = resolve(root, `.${pathname}`);
      const resolvedRoot = await realpath(root);
      const withinRoot = (path) => path === resolvedRoot || path.startsWith(resolvedRoot + sep);
      if (!withinRoot(target)) throw new Error("Outside site");
      if ((await stat(target)).isDirectory()) target = resolve(target, "index.html");
      target = await realpath(target);
      if (!withinRoot(target)) throw new Error("Outside site");
      const file = await readFile(target);
      const content =
        extname(target) === ".html" ? stampCommit(file.toString(), getCommitSha(root)) : file;
      response.writeHead(200, {
        "Content-Type": mimeTypes[extname(target)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CLIPLINK_SITE_PORT ?? 4333);
  const server = createSiteServer();
  server.listen(port, "127.0.0.1", () => console.log(`Cliplink site: http://127.0.0.1:${port}/`));
}
