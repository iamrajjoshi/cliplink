import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  ConfigError,
  ConfigStore,
  DEFAULT_CONFIG,
  VALID_CONFIG_KEYS,
  getConfigDir,
} from "../config/store";
import { runConfigCommand } from "../commands/config";

const tempDirs: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clip-config-"));
  tempDirs.push(dir);
  return dir;
}

describe("ConfigStore", () => {
  describe("defaults", () => {
    it("returns defaults when no config file exists", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      const config = await store.read();
      assert.deepEqual(config, DEFAULT_CONFIG);
    });

    it("default config has mode: remote", () => {
      assert.equal(DEFAULT_CONFIG.mode, "remote");
    });

    it("default config has github.owner: empty string (auto-set during login)", () => {
      assert.equal(DEFAULT_CONFIG.github.owner, "");
    });

    it("default config has github.repo: empty string (set via clip init or config set)", () => {
      assert.equal(DEFAULT_CONFIG.github.repo, "");
    });

    it("default config has github.branch: main", () => {
      assert.equal(DEFAULT_CONFIG.github.branch, "main");
    });
  });

  describe("read", () => {
    it("does not create a file or directory on read", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      await store.read();
      const clipDir = path.join(dir, "clip");
      await assert.rejects(
        () => stat(clipDir),
        (err: NodeJS.ErrnoException) => {
          assert.equal(err.code, "ENOENT");
          return true;
        },
      );
    });

    it("reads existing config file", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "config.json"),
        JSON.stringify({
          mode: "local",
          github: { owner: "test", repo: "test-repo", branch: "develop" },
        }),
      );
      const store = new ConfigStore({ configDir: dir });
      const config = await store.read();
      assert.equal(config.mode, "local");
      assert.equal(config.github.owner, "test");
      assert.equal(config.github.repo, "test-repo");
      assert.equal(config.github.branch, "develop");
    });

    it("merges missing fields with defaults", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(path.join(clipDir, "config.json"), JSON.stringify({ mode: "local" }));
      const store = new ConfigStore({ configDir: dir });
      const config = await store.read();
      assert.equal(config.mode, "local");
      assert.equal(config.github.owner, "");
      assert.equal(config.github.repo, "");
      assert.equal(config.github.branch, "main");
    });

    it("throws ConfigError on invalid JSON", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(path.join(clipDir, "config.json"), "{ invalid json }");
      const store = new ConfigStore({ configDir: dir });
      await assert.rejects(
        () => store.read(),
        (err: unknown) => {
          assert.ok(err instanceof ConfigError);
          assert.ok(err.message.includes("Invalid JSON"));
          return true;
        },
      );
    });
  });

  describe("get", () => {
    it("supports dot-notation for nested keys from defaults", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      assert.equal(await store.get("github.owner"), "");
      assert.equal(await store.get("github.repo"), "");
      assert.equal(await store.get("github.branch"), "main");
      assert.equal(await store.get("mode"), "remote");
    });

    it("returns undefined for unknown keys", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      assert.equal(await store.get("unknown.key"), undefined);
      assert.equal(await store.get("nonexistent"), undefined);
    });

    it("returns values from existing config file", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "config.json"),
        JSON.stringify({
          mode: "local",
          github: { owner: "custom", repo: "my-repo", branch: "develop" },
        }),
      );
      const store = new ConfigStore({ configDir: dir });
      assert.equal(await store.get("github.owner"), "custom");
      assert.equal(await store.get("github.branch"), "develop");
      assert.equal(await store.get("mode"), "local");
    });
  });

  describe("set", () => {
    it("persists value to file", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      await store.set("github.branch", "develop");
      const config = await store.read();
      assert.equal(config.github.branch, "develop");
    });

    it("supports nested keys without overwriting other fields", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      await store.set("github.branch", "develop");
      const config = await store.read();
      assert.equal(config.github.branch, "develop");
      assert.equal(config.github.owner, "");
      assert.equal(config.github.repo, "");
      assert.equal(config.mode, "remote");
    });

    it("persists mode value", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      await store.set("mode", "local");
      const config = await store.read();
      assert.equal(config.mode, "local");
    });

    it("creates file with 0600 permissions", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      await store.set("mode", "local");
      const configPath = path.join(dir, "clip", "config.json");
      const stats = await stat(configPath);
      const mode = stats.mode & 0o777;
      assert.equal(mode, 0o600);
    });

    it("creates directory with 0700 permissions", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      await store.set("mode", "local");
      const clipDir = path.join(dir, "clip");
      const stats = await stat(clipDir);
      const mode = stats.mode & 0o777;
      assert.equal(mode, 0o700);
    });

    it("rejects invalid keys", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      await assert.rejects(
        () => store.set("invalid.key", "value"),
        (err: unknown) => {
          assert.ok(err instanceof ConfigError);
          assert.ok(err.message.includes("Invalid config key"));
          return true;
        },
      );
    });

    it("rejects token key", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      await assert.rejects(() => store.set("token", "fake-token-placeholder"));
      // File should not exist since set failed
      await assert.rejects(
        () => stat(path.join(dir, "clip", "config.json")),
        (err: NodeJS.ErrnoException) => err.code === "ENOENT",
      );
    });

    it("updates existing config without losing other values", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "config.json"),
        JSON.stringify({
          mode: "local",
          github: { owner: "custom", repo: "my-repo", branch: "main" },
        }),
        { mode: 0o600 },
      );
      const store = new ConfigStore({ configDir: dir });
      await store.set("github.branch", "develop");
      const config = await store.read();
      assert.equal(config.mode, "local");
      assert.equal(config.github.owner, "custom");
      assert.equal(config.github.repo, "my-repo");
      assert.equal(config.github.branch, "develop");
    });
  });

  describe("atomic writes", () => {
    it("does not leave temp files after successful write", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      await store.set("mode", "local");
      const clipDir = path.join(dir, "clip");
      const files = await readdir(clipDir);
      assert.deepEqual(files, ["config.json"]);
    });

    it("leaves original intact on write failure", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      const configPath = path.join(clipDir, "config.json");
      const originalContent = JSON.stringify({
        mode: "remote",
        github: { owner: "original", repo: "clip", branch: "main" },
      });
      await writeFile(configPath, originalContent, { mode: 0o600 });

      // Make directory read-only to prevent temp file creation
      await chmod(clipDir, 0o500);

      const store = new ConfigStore({ configDir: dir });
      await assert.rejects(() => store.set("mode", "local"));

      // Restore permissions for cleanup and verification
      await chmod(clipDir, 0o700);

      // Verify original is intact
      const content = await readFile(configPath, "utf8");
      assert.equal(content, originalContent);

      // Verify no temp files remain
      const files = await readdir(clipDir);
      assert.deepEqual(files, ["config.json"]);
    });
  });

  describe("XDG_CONFIG_HOME", () => {
    it("getConfigDir respects XDG_CONFIG_HOME", () => {
      const xdgDir = "/tmp/test-xdg-config";
      const oldXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = xdgDir;
      try {
        assert.equal(getConfigDir(), xdgDir);
      } finally {
        if (oldXdg === undefined) {
          delete process.env.XDG_CONFIG_HOME;
        } else {
          process.env.XDG_CONFIG_HOME = oldXdg;
        }
      }
    });

    it("getConfigDir falls back to ~/.config when XDG_CONFIG_HOME not set", () => {
      const oldXdg = process.env.XDG_CONFIG_HOME;
      delete process.env.XDG_CONFIG_HOME;
      try {
        assert.equal(getConfigDir(), path.join(os.homedir(), ".config"));
      } finally {
        if (oldXdg !== undefined) {
          process.env.XDG_CONFIG_HOME = oldXdg;
        }
      }
    });

    it("config store writes to XDG_CONFIG_HOME path", async () => {
      const xdgDir = await createTempDir();
      const oldXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = xdgDir;
      try {
        const store = new ConfigStore();
        await store.set("mode", "local");
        const configPath = path.join(xdgDir, "clip", "config.json");
        const stats = await stat(configPath);
        assert.ok(stats.isFile());
        const mode = stats.mode & 0o777;
        assert.equal(mode, 0o600);
      } finally {
        if (oldXdg === undefined) {
          delete process.env.XDG_CONFIG_HOME;
        } else {
          process.env.XDG_CONFIG_HOME = oldXdg;
        }
      }
    });
  });

  describe("redaction", () => {
    it("redacts sensitive fields in printable output", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "config.json"),
        JSON.stringify({
          mode: "remote",
          github: { owner: "test", repo: "clip", branch: "main" },
          token: "fake-sensitive-token-placeholder",
          password: "secret",
        }),
      );
      const store = new ConfigStore({ configDir: dir });
      const printable = await store.toPrintable();
      assert.equal(printable.token, "[redacted]");
      assert.equal(printable.password, "[redacted]");
      assert.equal(printable.mode, "remote");
      const github = printable.github as Record<string, unknown>;
      assert.equal(github.owner, "test");
    });

    it("printable includes defaults when no file exists", async () => {
      const dir = await createTempDir();
      const store = new ConfigStore({ configDir: dir });
      const printable = await store.toPrintable();
      assert.equal(printable.mode, "remote");
      const github = printable.github as Record<string, unknown>;
      assert.equal(github.owner, "");
      assert.equal(github.repo, "");
      assert.equal(github.branch, "main");
    });

    it("printable does not include raw token value", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "config.json"),
        JSON.stringify({
          mode: "remote",
          github: { owner: "test", repo: "clip", branch: "main" },
          token: "fake-sensitive-token-placeholder",
        }),
      );
      const store = new ConfigStore({ configDir: dir });
      const printable = await store.toPrintable();
      const output = JSON.stringify(printable);
      assert.ok(!output.includes("fake-sensitive-token-placeholder"));
    });

    it("redacts private_key field in printable output", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "config.json"),
        JSON.stringify({
          mode: "remote",
          github: { owner: "test", repo: "clip", branch: "main" },
          private_key: "fake-private-key-placeholder",
        }),
      );
      const store = new ConfigStore({ configDir: dir });
      const printable = await store.toPrintable();
      assert.equal(printable.private_key, "[redacted]");
      assert.equal(printable.mode, "remote");
      const github = printable.github as Record<string, unknown>;
      assert.equal(github.owner, "test");
    });

    it("printable does not include raw private_key value", async () => {
      const dir = await createTempDir();
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "config.json"),
        JSON.stringify({
          mode: "remote",
          github: { owner: "test", repo: "clip", branch: "main" },
          private_key: "fake-private-key-placeholder",
        }),
      );
      const store = new ConfigStore({ configDir: dir });
      const printable = await store.toPrintable();
      const output = JSON.stringify(printable);
      assert.ok(!output.includes("fake-private-key-placeholder"));
    });
  });

  describe("valid keys", () => {
    it("VALID_CONFIG_KEYS contains all expected keys", () => {
      assert.ok(VALID_CONFIG_KEYS.includes("mode"));
      assert.ok(VALID_CONFIG_KEYS.includes("github.owner"));
      assert.ok(VALID_CONFIG_KEYS.includes("github.repo"));
      assert.ok(VALID_CONFIG_KEYS.includes("github.branch"));
    });
  });
});

describe("runConfigCommand", () => {
  async function captureOutput(fn: () => Promise<void>): Promise<{ stdout: string }> {
    const originalLog = console.log;
    const lines: string[] = [];
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      await fn();
      return { stdout: lines.join("\n") };
    } finally {
      console.log = originalLog;
    }
  }

  it("prints config with no args (defaults when no file)", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      const { stdout } = await captureOutput(() => runConfigCommand([]));
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.mode, "remote");
      assert.equal(parsed.github.owner, "");
      assert.equal(parsed.github.repo, "");
      assert.equal(parsed.github.branch, "main");
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("get prints value for key", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      const { stdout } = await captureOutput(() => runConfigCommand(["get", "github.owner"]));
      assert.equal(stdout, "");
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("get prints mode value", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      const { stdout } = await captureOutput(() => runConfigCommand(["get", "mode"]));
      assert.equal(stdout, "remote");
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("set persists value", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      await runConfigCommand(["set", "github.branch", "develop"]);
      const store = new ConfigStore();
      assert.equal(await store.get("github.branch"), "develop");
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("set rejects invalid key", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      await assert.rejects(() => runConfigCommand(["set", "invalid.key", "value"]));
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("set rejects token key", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      await assert.rejects(() => runConfigCommand(["set", "token", "fake-token-placeholder"]));
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("does not print token in config output", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "config.json"),
        JSON.stringify({
          mode: "remote",
          github: { owner: "test", repo: "clip", branch: "main" },
          token: "fake-leak-test-token-placeholder",
        }),
      );
      const { stdout } = await captureOutput(() => runConfigCommand([]));
      assert.ok(!stdout.includes("fake-leak-test-token-placeholder"));
      assert.ok(stdout.includes("[redacted]"));
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("does not print private_key in config output", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(
        path.join(clipDir, "config.json"),
        JSON.stringify({
          mode: "remote",
          github: { owner: "test", repo: "clip", branch: "main" },
          private_key: "fake-leak-test-private-key-placeholder",
        }),
      );
      const { stdout } = await captureOutput(() => runConfigCommand([]));
      assert.ok(!stdout.includes("fake-leak-test-private-key-placeholder"));
      assert.ok(stdout.includes("[redacted]"));
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("throws on invalid JSON when printing config", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(path.join(clipDir, "config.json"), "{ broken json }");
      await assert.rejects(
        () => runConfigCommand([]),
        (err: unknown) => {
          assert.ok(err instanceof ConfigError);
          assert.ok(err.message.includes("Invalid JSON"));
          return true;
        },
      );
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("throws on invalid JSON when getting value", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      const clipDir = path.join(dir, "clip");
      await mkdir(clipDir, { recursive: true });
      await writeFile(path.join(clipDir, "config.json"), "{ broken json }");
      await assert.rejects(
        () => runConfigCommand(["get", "mode"]),
        (err: unknown) => {
          assert.ok(err instanceof ConfigError);
          return true;
        },
      );
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("throws on unknown subcommand", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      await assert.rejects(
        () => runConfigCommand(["unknown"]),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("Unknown config subcommand"));
          return true;
        },
      );
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("get with missing key argument throws", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      await assert.rejects(() => runConfigCommand(["get"]));
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });

  it("set with missing value argument throws", async () => {
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const dir = await createTempDir();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      await assert.rejects(() => runConfigCommand(["set", "mode"]));
    } finally {
      if (oldXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = oldXdg;
      }
    }
  });
});
