import { execFileSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoUrl = "https://github.com/iamrajjoshi/cliplink";

function validSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null;
}

export function getCommitSha(cwd = repoRoot, githubSha = process.env.GITHUB_SHA) {
  const sha = validSha(githubSha);
  if (sha) return sha;
  try {
    return validSha(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    return null;
  }
}

export function stampCommit(html, commitSha) {
  const sha = validSha(commitSha);
  const href = sha ? `${repoUrl}/commit/${sha}` : repoUrl;
  const label = sha ? sha.slice(0, 7) : "Source";
  const accessibleLabel = sha ? `View commit ${label} on GitHub` : "View source on GitHub";
  return html.replace(
    /<!-- commit:start -->[\s\S]*?<!-- commit:end -->/,
    `<a class="commit-link" href="${href}" aria-label="${accessibleLabel}">${label}</a>`,
  );
}

export async function buildSite() {
  const source = resolve(repoRoot, "site");
  const output = resolve(repoRoot, "dist/site");
  const html = await readFile(resolve(source, "index.html"), "utf8");
  await rm(output, { recursive: true, force: true });
  await cp(source, output, { recursive: true });
  await writeFile(resolve(output, "index.html"), stampCommit(html, getCommitSha()));
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Built Cliplink site: ${await buildSite()}`);
}
