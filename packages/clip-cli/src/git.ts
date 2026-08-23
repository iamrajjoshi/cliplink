import { spawnSync } from "node:child_process";

function runGit(args: string[], cwd: string) {
  const result = spawnSync("git", args, {
    cwd,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
}

export function commitAndPush({
  cwd,
  paths,
  message,
  noPush,
  dryRun,
}: {
  cwd: string;
  paths: string[];
  message: string;
  noPush: boolean;
  dryRun: boolean;
}) {
  if (dryRun) {
    console.log("dry run: skipping git add/commit/push");
    return;
  }

  runGit(["add", "--", ...paths], cwd);
  runGit(["commit", "-m", message], cwd);

  if (noPush) {
    return;
  }

  const upstreamCheck = spawnSync(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    {
      cwd,
      stdio: "ignore",
    },
  );

  if (upstreamCheck.status === 0) {
    runGit(["push"], cwd);
    return;
  }

  runGit(["push", "-u", "origin", "HEAD"], cwd);
}
