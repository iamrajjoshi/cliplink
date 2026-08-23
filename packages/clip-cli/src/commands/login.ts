import { OAuthClient } from "../auth/oauth";
import { KeychainStore } from "../auth/keychain";
import { ConfigStore } from "../config/store";

export interface LoginCommandOptions {
  oauth?: OAuthClient;
  keychain?: KeychainStore;
  configStore?: Pick<ConfigStore, "set" | "get">;
}

/** Run the login command: OAuth Device Flow → verify → store → print success. */
export async function runLoginCommand(options?: LoginCommandOptions): Promise<void> {
  const keychain = options?.keychain ?? new KeychainStore();
  const oauth = options?.oauth ?? new OAuthClient();
  const configStore = options?.configStore ?? new ConfigStore();

  // Check if already logged in
  const existingToken = await keychain.read();
  if (existingToken) {
    console.log("Already logged in. Run 'clip logout' first to switch accounts.");
    return;
  }

  // Run OAuth Device Flow
  const accessToken = await oauth.authenticate((info) => {
    console.log(`Please visit: ${info.verificationUri}`);
    console.log(`Enter code: ${info.userCode}`);
    console.log("");
    console.log("Waiting for authorization...");
  });

  // Verify token with GET /user
  const login = await oauth.verifyToken(accessToken);

  // Store token (Keychain on macOS, file fallback otherwise)
  await keychain.store(accessToken);

  // Auto-set github.owner from the authenticated user's login so remote
  // publishing targets the correct account without manual configuration.
  await configStore.set("github.owner", login);

  // Print success message (without token)
  console.log(`Logged in as ${login}`);
}
