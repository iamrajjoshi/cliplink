import { printHelp } from "./help";
import { printVersion } from "./version";

/** Handlers for each routable subcommand. Injectable for testing. */
export interface CommandHandlers {
  login: () => Promise<void>;
  logout: () => Promise<void>;
  config: (args: string[]) => Promise<void>;
  init: () => Promise<void>;
  clip: (args: string[]) => Promise<void>;
}

/** Known subcommand names that are intercepted by the router. */
const SUBCOMMANDS = new Set(["login", "logout", "config", "init"]);

/**
 * Default command handlers that dynamically import each command module.
 * Using dynamic imports keeps the entry point lean and avoids loading
 * heavy dependencies (e.g. sharp, scrapers) for simple commands like
 * `clip --version`.
 */
const defaultHandlers: CommandHandlers = {
  login: async () => {
    const { runLoginCommand } = await import("./login");
    await runLoginCommand();
  },
  logout: async () => {
    const { runLogoutCommand } = await import("./logout");
    await runLogoutCommand();
  },
  config: async (args: string[]) => {
    const { runConfigCommand } = await import("./config");
    await runConfigCommand(args);
  },
  init: async () => {
    const { runInitCommand } = await import("./init");
    await runInitCommand();
  },
  clip: async (args: string[]) => {
    const { runClipCommand } = await import("./clip");
    await runClipCommand(args);
  },
};

/**
 * Route a CLI invocation to the appropriate command based on the first
 * argument.
 *
 * Routing rules:
 * - No args → help (exit 0)
 * - `--help` / `-h` (first arg) → help (exit 0)
 * - `--version` (first arg) → version (exit 0)
 * - `login` → login command (extra args ignored by login)
 * - `logout` → logout command
 * - `config` → config command (remaining args passed through)
 * - `init` → init command (creates a repo from template)
 * - Anything else → clip command (all args passed through; unknown
 *   subcommands are treated as clip input, not routing errors)
 *
 * `login`, `logout`, `config`, and `init` are only intercepted when they
 * appear as the first argument. This means `clip login <url>` routes to login
 * (not clip) and `clip config <url>` routes to config (not clip).
 */
export async function routeCommand(
  args: string[],
  handlers?: Partial<CommandHandlers>,
): Promise<void> {
  const h: CommandHandlers = {
    login: handlers?.login ?? defaultHandlers.login,
    logout: handlers?.logout ?? defaultHandlers.logout,
    config: handlers?.config ?? defaultHandlers.config,
    init: handlers?.init ?? defaultHandlers.init,
    clip: handlers?.clip ?? defaultHandlers.clip,
  };

  const firstArg = args[0];

  // No arguments → help
  if (firstArg === undefined) {
    printHelp();
    return;
  }

  // Help flags as first argument
  if (firstArg === "--help" || firstArg === "-h") {
    printHelp();
    return;
  }

  // Version flag as first argument
  if (firstArg === "--version") {
    printVersion();
    return;
  }

  // Known subcommands (only intercepted as the first argument)
  if (SUBCOMMANDS.has(firstArg)) {
    if (firstArg === "login") {
      await h.login();
      return;
    }
    if (firstArg === "logout") {
      await h.logout();
      return;
    }
    if (firstArg === "config") {
      await h.config(args.slice(1));
      return;
    }
    if (firstArg === "init") {
      await h.init();
      return;
    }
  }

  // Everything else (URLs, file paths, "-", unknown subcommands) → clip command
  await h.clip(args);
}

export { printVersion, getVersion } from "./version";
export { printHelp, HELP_TEXT } from "./help";
