// Token storage via macOS Keychain (security CLI) with file fallback.
// The token is never printed, logged, or included in error messages.

import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfigDir } from "../config/store";

const SERVICE = "clip";
const ACCOUNT = "github";

export type ExecFn = (command: string, args: string[]) => string;

export interface KeychainStoreOptions {
  configDir?: string;
  execFn?: ExecFn;
  platform?: string;
  interactive?: boolean;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function defaultExecFn(command: string, args: string[]): string {
  return execFileSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    timeout: 10000,
  });
}

export function isInteractive(): boolean {
  if (process.env.CI === "true" || process.env.CI === "1") return false;
  return Boolean(process.stdout.isTTY);
}

export function getCredentialsPath(): string {
  return path.join(getConfigDir(), "clip", "credentials.json");
}

export class KeychainStore {
  private readonly configDir: string;
  private readonly execFn: ExecFn;
  private readonly platform: string;
  private readonly interactive: boolean;
  private readonly credentialsPath: string;

  constructor(options?: KeychainStoreOptions) {
    this.configDir = options?.configDir ?? getConfigDir();
    this.execFn = options?.execFn ?? defaultExecFn;
    this.platform = options?.platform ?? process.platform;
    this.interactive = options?.interactive ?? isInteractive();
    this.credentialsPath = path.join(this.configDir, "clip", "credentials.json");
  }

  getCredentialsPath(): string {
    return this.credentialsPath;
  }

  canUseKeychain(): boolean {
    return this.platform === "darwin" && this.interactive;
  }

  /** Store the token in Keychain (if available) or the credentials file. */
  async store(token: string): Promise<void> {
    if (this.canUseKeychain()) {
      try {
        this.storeInKeychain(token);
        return;
      } catch {
        // Fall through to file storage
      }
    }
    await this.storeInFile(token);
  }

  /** Read the token from Keychain (if available) or the credentials file. */
  async read(): Promise<string | null> {
    if (this.canUseKeychain()) {
      const token = this.readFromKeychain();
      if (token) return token;
    }
    return this.readFromFile();
  }

  /** Delete the token from Keychain and/or the credentials file. */
  async delete(): Promise<boolean> {
    let keychainDeleted = false;
    if (this.platform === "darwin") {
      keychainDeleted = this.deleteFromKeychain();
    }
    const fileDeleted = await this.deleteFromFile();
    return keychainDeleted || fileDeleted;
  }

  private storeInKeychain(token: string): void {
    try {
      // Delete existing entry first (add fails if entry already exists)
      try {
        this.execFn("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
      } catch {
        // Entry doesn't exist yet, which is fine
      }
      this.execFn("security", ["add-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w", token]);
    } catch {
      throw new AuthError("Could not store token in Keychain.");
    }
  }

  private readFromKeychain(): string | null {
    try {
      const output = this.execFn("security", [
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        ACCOUNT,
        "-w",
      ]);
      const token = output.trim();
      return token || null;
    } catch {
      return null;
    }
  }

  private deleteFromKeychain(): boolean {
    try {
      this.execFn("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
      return true;
    } catch {
      return false;
    }
  }

  private async storeInFile(token: string): Promise<void> {
    const dir = path.dirname(this.credentialsPath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const content = JSON.stringify({ token });
    await writeFile(this.credentialsPath, content, { encoding: "utf8", mode: 0o600 });
    await chmod(this.credentialsPath, 0o600);
  }

  private async readFromFile(): Promise<string | null> {
    try {
      const content = await readFile(this.credentialsPath, "utf8");
      const data = JSON.parse(content) as { token?: string };
      return data.token ?? null;
    } catch {
      return null;
    }
  }

  private async deleteFromFile(): Promise<boolean> {
    try {
      await unlink(this.credentialsPath);
      return true;
    } catch {
      return false;
    }
  }
}
