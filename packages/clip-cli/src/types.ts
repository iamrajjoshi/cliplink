export type DetectedKind = "link" | "tweet" | "image" | "video" | "note";

export type Detection =
  | {
      kind: "note";
      rawInput: "-";
      stdinText: string;
    }
  | {
      kind: "image";
      rawInput: string;
      filePath: string;
    }
  | {
      kind: "link" | "tweet" | "video";
      rawInput: string;
      url: URL;
    };

export type CliOptions = {
  dryRun: boolean;
  noPush: boolean;
  help: boolean;
  local: boolean;
  repo?: string;
  input?: string;
};

export type ProjectPaths = {
  repoRoot: string;
  contentDir: string;
  publicDir: string;
  clipsAssetDir: string;
};

export type ResolveProjectPathsOptions = {
  start?: string;
  fallbackStarts?: string[];
};
