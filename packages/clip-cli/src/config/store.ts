import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ClipConfig {
  mode: string;
  github: {
    owner: string;
    repo: string;
    branch: string;
  };
}

export const DEFAULT_CONFIG: ClipConfig = {
  mode: "remote",
  github: {
    owner: "",
    repo: "",
    branch: "main",
  },
};

export const VALID_CONFIG_KEYS: readonly string[] = [
  "mode",
  "github.owner",
  "github.repo",
  "github.branch",
] as const;

const SENSITIVE_PATTERNS = [
  /token/i,
  /password/i,
  /secret/i,
  /credential/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /auth/i,
];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return xdgConfig;
  }
  return path.join(os.homedir(), ".config");
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

function redactSensitive(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redactSensitive(val);
    }
  }
  return result;
}

function mergeConfig(raw: unknown): ClipConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return structuredClone(DEFAULT_CONFIG);
  }
  const obj = raw as Record<string, unknown>;
  const githubRaw =
    typeof obj.github === "object" && obj.github !== null && !Array.isArray(obj.github)
      ? (obj.github as Record<string, unknown>)
      : {};
  return {
    mode: typeof obj.mode === "string" ? obj.mode : DEFAULT_CONFIG.mode,
    github: {
      owner: typeof githubRaw.owner === "string" ? githubRaw.owner : DEFAULT_CONFIG.github.owner,
      repo: typeof githubRaw.repo === "string" ? githubRaw.repo : DEFAULT_CONFIG.github.repo,
      branch:
        typeof githubRaw.branch === "string" ? githubRaw.branch : DEFAULT_CONFIG.github.branch,
    },
  };
}

function mergeRawWithDefaults(raw: unknown): Record<string, unknown> {
  const defaults = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return defaults;
  }
  const obj = raw as Record<string, unknown>;
  const githubDefaults = structuredClone(DEFAULT_CONFIG.github) as unknown as Record<
    string,
    unknown
  >;
  const githubRaw =
    typeof obj.github === "object" && obj.github !== null && !Array.isArray(obj.github)
      ? (obj.github as Record<string, unknown>)
      : {};
  return {
    ...defaults,
    ...obj,
    github: {
      ...githubDefaults,
      ...githubRaw,
    },
  };
}

export class ConfigStore {
  private readonly configDir: string;
  private readonly configPath: string;

  constructor(options?: { configDir?: string }) {
    this.configDir = options?.configDir ?? getConfigDir();
    this.configPath = path.join(this.configDir, "clip", "config.json");
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async read(): Promise<ClipConfig> {
    let content: string;
    try {
      content = await readFile(this.configPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(DEFAULT_CONFIG);
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new ConfigError(`Invalid JSON in config file (${this.configPath}): ${err.message}`);
      }
      throw err;
    }

    return mergeConfig(parsed);
  }

  async get(key: string): Promise<unknown> {
    const config = await this.read();
    const parts = key.split(".");
    let current: unknown = config;
    for (const part of parts) {
      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  async set(key: string, value: string): Promise<void> {
    if (!VALID_CONFIG_KEYS.includes(key)) {
      throw new ConfigError(
        `Invalid config key: "${key}". Valid keys: ${VALID_CONFIG_KEYS.join(", ")}`,
      );
    }

    const config = await this.read();
    const newConfig = structuredClone(config) as unknown as Record<string, unknown>;

    const parts = key.split(".");
    let target: Record<string, unknown> = newConfig;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (part) {
        target = target[part] as Record<string, unknown>;
      }
    }
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      target[lastPart] = value;
    }

    await this.writeAtomic(JSON.stringify(newConfig, null, 2));
  }

  async toPrintable(): Promise<Record<string, unknown>> {
    let raw: unknown;
    try {
      const content = await readFile(this.configPath, "utf8");
      raw = JSON.parse(content);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        raw = structuredClone(DEFAULT_CONFIG);
      } else if (err instanceof SyntaxError) {
        throw new ConfigError(`Invalid JSON in config file (${this.configPath}): ${err.message}`);
      } else {
        throw err;
      }
    }

    const merged = mergeRawWithDefaults(raw);
    return redactSensitive(merged) as Record<string, unknown>;
  }

  private async writeAtomic(content: string): Promise<void> {
    const clipDir = path.dirname(this.configPath);
    await mkdir(clipDir, { recursive: true, mode: 0o700 });

    const tempPath = path.join(clipDir, `.config.${randomBytes(8).toString("hex")}.tmp`);

    try {
      await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
      await chmod(tempPath, 0o600);
      await rename(tempPath, this.configPath);
    } catch (err) {
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }
}
