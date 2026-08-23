import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HELP_TEXT } from "../commands/help";
import { getVersion } from "../commands/version";
import { routeCommand, type CommandHandlers } from "../commands";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CallLog {
  login: number;
  logout: number;
  config: number;
  init: number;
  clip: number;
}

function createMockHandlers(log: CallLog): CommandHandlers {
  return {
    login: async () => {
      log.login += 1;
    },
    logout: async () => {
      log.logout += 1;
    },
    config: async (_args: string[]) => {
      log.config += 1;
    },
    init: async () => {
      log.init += 1;
    },
    clip: async (_args: string[]) => {
      log.clip += 1;
    },
  };
}

function captureOutput(fn: () => Promise<void>): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    fn()
      .then(() => {
        resolve({ stdout: lines.join("\n") });
      })
      .catch(reject)
      .finally(() => {
        console.log = originalLog;
      });
  });
}

function createCallLog(): CallLog {
  return { login: 0, logout: 0, config: 0, init: 0, clip: 0 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("routeCommand", () => {
  describe("VAL-CMD-001: clip login routes to login", () => {
    it("routes 'login' to the login handler", async () => {
      const log = createCallLog();
      await routeCommand(["login"], createMockHandlers(log));
      assert.equal(log.login, 1);
      assert.equal(log.clip, 0, "clip handler must not be called for login");
    });

    it("does not treat 'login' as clip input", async () => {
      const log = createCallLog();
      await routeCommand(["login"], createMockHandlers(log));
      assert.equal(log.clip, 0);
    });
  });

  describe("VAL-CMD-002: clip logout routes to logout", () => {
    it("routes 'logout' to the logout handler", async () => {
      const log = createCallLog();
      await routeCommand(["logout"], createMockHandlers(log));
      assert.equal(log.logout, 1);
      assert.equal(log.clip, 0, "clip handler must not be called for logout");
    });
  });

  describe("VAL-CMD-003: clip config routes to config", () => {
    it("routes 'config' to the config handler", async () => {
      const log = createCallLog();
      await routeCommand(["config"], createMockHandlers(log));
      assert.equal(log.config, 1);
      assert.equal(log.clip, 0, "clip handler must not be called for config");
    });
  });

  describe("VAL-CMD-004: clip config get <key> routes to config get", () => {
    it("routes 'config get <key>' to config handler with sub-args", async () => {
      const log = createCallLog();
      let receivedArgs: string[] = [];
      const handlers: CommandHandlers = {
        login: async () => {},
        logout: async () => {},
        config: async (args: string[]) => {
          receivedArgs = args;
          log.config += 1;
        },
        init: async () => {},
        clip: async () => {},
      };
      await routeCommand(["config", "get", "github.owner"], handlers);
      assert.equal(log.config, 1);
      assert.deepEqual(receivedArgs, ["get", "github.owner"]);
    });
  });

  describe("VAL-CMD-005: clip config set <key> <value> routes to config set", () => {
    it("routes 'config set <key> <value>' to config handler with sub-args", async () => {
      const log = createCallLog();
      let receivedArgs: string[] = [];
      const handlers: CommandHandlers = {
        login: async () => {},
        logout: async () => {},
        config: async (args: string[]) => {
          receivedArgs = args;
          log.config += 1;
        },
        init: async () => {},
        clip: async () => {},
      };
      await routeCommand(["config", "set", "github.branch", "develop"], handlers);
      assert.equal(log.config, 1);
      assert.deepEqual(receivedArgs, ["set", "github.branch", "develop"]);
    });
  });

  describe("VAL-CMD-006: clip <url> routes to clip command", () => {
    it("routes a URL to the clip handler", async () => {
      const log = createCallLog();
      let receivedArgs: string[] = [];
      const handlers: CommandHandlers = {
        ...createMockHandlers(log),
        clip: async (args: string[]) => {
          receivedArgs = args;
          log.clip += 1;
        },
      };
      await routeCommand(["https://example.com"], handlers);
      assert.equal(log.clip, 1);
      assert.deepEqual(receivedArgs, ["https://example.com"]);
    });
  });

  describe("VAL-CMD-007: clip <local-file-path> routes to clip command", () => {
    it("routes a local file path to the clip handler", async () => {
      const log = createCallLog();
      let receivedArgs: string[] = [];
      const handlers: CommandHandlers = {
        ...createMockHandlers(log),
        clip: async (args: string[]) => {
          receivedArgs = args;
          log.clip += 1;
        },
      };
      await routeCommand(["./photo.jpg"], handlers);
      assert.equal(log.clip, 1);
      assert.deepEqual(receivedArgs, ["./photo.jpg"]);
    });
  });

  describe("VAL-CMD-008: clip - routes to clip command", () => {
    it("routes '-' to the clip handler (stdin note)", async () => {
      const log = createCallLog();
      let receivedArgs: string[] = [];
      const handlers: CommandHandlers = {
        ...createMockHandlers(log),
        clip: async (args: string[]) => {
          receivedArgs = args;
          log.clip += 1;
        },
      };
      await routeCommand(["-"], handlers);
      assert.equal(log.clip, 1);
      assert.deepEqual(receivedArgs, ["-"]);
    });
  });

  describe("VAL-CMD-009: clip --help / clip -h shows help", () => {
    it("clip --help prints help with all commands and flags, exit 0", async () => {
      const { stdout } = await captureOutput(() => routeCommand(["--help"]));
      assert.ok(stdout.includes("login"), "help should mention login");
      assert.ok(stdout.includes("logout"), "help should mention logout");
      assert.ok(stdout.includes("config"), "help should mention config");
      assert.ok(stdout.includes("--local"), "help should mention --local");
      assert.ok(stdout.includes("--dry-run"), "help should mention --dry-run");
      assert.ok(stdout.includes("--no-push"), "help should mention --no-push");
      assert.ok(stdout.includes("--repo"), "help should mention --repo");
      assert.ok(stdout.includes("--help"), "help should mention --help");
      assert.ok(stdout.includes("--version"), "help should mention --version");
    });

    it("clip -h prints help, exit 0", async () => {
      const { stdout } = await captureOutput(() => routeCommand(["-h"]));
      assert.ok(stdout.includes("login"));
      assert.ok(stdout.includes("--version"));
    });

    it("help does not route to any command handler", async () => {
      const log = createCallLog();
      await routeCommand(["--help"], createMockHandlers(log));
      assert.equal(log.login, 0);
      assert.equal(log.logout, 0);
      assert.equal(log.config, 0);
      assert.equal(log.clip, 0);
    });
  });

  describe("VAL-CMD-010: clip --version prints version", () => {
    it("clip --version prints the package version, exit 0", async () => {
      const { stdout } = await captureOutput(() => routeCommand(["--version"]));
      const expected = getVersion();
      assert.equal(stdout.trim(), expected);
    });

    it("version does not route to any command handler", async () => {
      const log = createCallLog();
      await routeCommand(["--version"], createMockHandlers(log));
      assert.equal(log.login, 0);
      assert.equal(log.logout, 0);
      assert.equal(log.config, 0);
      assert.equal(log.clip, 0);
    });
  });

  describe("VAL-CMD-011: unknown subcommands treated as clip input", () => {
    it("routes an unknown first arg to clip (not an error)", async () => {
      const log = createCallLog();
      let receivedArgs: string[] = [];
      const handlers: CommandHandlers = {
        ...createMockHandlers(log),
        clip: async (args: string[]) => {
          receivedArgs = args;
          log.clip += 1;
        },
      };
      await routeCommand(["some-random-string"], handlers);
      assert.equal(log.clip, 1);
      assert.deepEqual(receivedArgs, ["some-random-string"]);
    });

    it("routes unknown-subcommand with flags to clip", async () => {
      const log = createCallLog();
      let receivedArgs: string[] = [];
      const handlers: CommandHandlers = {
        ...createMockHandlers(log),
        clip: async (args: string[]) => {
          receivedArgs = args;
          log.clip += 1;
        },
      };
      await routeCommand(["some-random-string", "--dry-run"], handlers);
      assert.equal(log.clip, 1);
      assert.deepEqual(receivedArgs, ["some-random-string", "--dry-run"]);
    });
  });

  describe("VAL-CMD-012: clip login <extra> routes to login", () => {
    it("clip login <url> routes to login, not clip", async () => {
      const log = createCallLog();
      await routeCommand(["login", "https://example.com"], createMockHandlers(log));
      assert.equal(log.login, 1);
      assert.equal(log.clip, 0, "clip must not be called for 'login <url>'");
    });
  });

  describe("VAL-CMD-013: clip config <url> routes to config", () => {
    it("clip config <url> routes to config, not clip", async () => {
      const log = createCallLog();
      let receivedArgs: string[] = [];
      const handlers: CommandHandlers = {
        ...createMockHandlers(log),
        config: async (args: string[]) => {
          receivedArgs = args;
          log.config += 1;
        },
      };
      await routeCommand(["config", "https://example.com"], handlers);
      assert.equal(log.config, 1);
      assert.equal(log.clip, 0, "clip must not be called for 'config <url>'");
      assert.deepEqual(receivedArgs, ["https://example.com"]);
    });
  });

  describe("VAL-CMD-015: clip init routes to the init command", () => {
    it("routes 'init' to the init handler", async () => {
      const log = createCallLog();
      await routeCommand(["init"], createMockHandlers(log));
      assert.equal(log.init, 1);
      assert.equal(log.clip, 0, "clip handler must not be called for init");
    });

    it("does not treat 'init' as clip input", async () => {
      const log = createCallLog();
      await routeCommand(["init"], createMockHandlers(log));
      assert.equal(log.clip, 0);
    });
  });

  describe("VAL-CMD-014: clip with no args prints help", () => {
    it("bare clip invocation prints help, exit 0", async () => {
      const { stdout } = await captureOutput(() => routeCommand([]));
      assert.ok(stdout.includes("login"), "help should mention login");
      assert.ok(stdout.includes("logout"), "help should mention logout");
      assert.ok(stdout.includes("config"), "help should mention config");
      assert.ok(stdout.includes("--version"), "help should mention --version");
    });

    it("no args does not route to any command handler", async () => {
      const log = createCallLog();
      await routeCommand([], createMockHandlers(log));
      assert.equal(log.login, 0);
      assert.equal(log.logout, 0);
      assert.equal(log.config, 0);
      assert.equal(log.clip, 0);
    });
  });

  describe("HELP_TEXT content", () => {
    it("contains all subcommands", () => {
      assert.ok(HELP_TEXT.includes("login"));
      assert.ok(HELP_TEXT.includes("logout"));
      assert.ok(HELP_TEXT.includes("config"));
      assert.ok(HELP_TEXT.includes("init"));
    });

    it("contains all flags", () => {
      assert.ok(HELP_TEXT.includes("--local"));
      assert.ok(HELP_TEXT.includes("--dry-run"));
      assert.ok(HELP_TEXT.includes("--no-push"));
      assert.ok(HELP_TEXT.includes("--repo"));
      assert.ok(HELP_TEXT.includes("--help"));
      assert.ok(HELP_TEXT.includes("--version"));
    });
  });

  describe("getVersion", () => {
    it("returns a non-empty version string", () => {
      const version = getVersion();
      assert.ok(typeof version === "string");
      assert.ok(version.length > 0, "version should not be empty");
    });
  });
});
