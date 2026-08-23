import { KeychainStore } from "../auth/keychain";

export interface LogoutCommandOptions {
  keychain?: KeychainStore;
}

/** Run the logout command: delete token from Keychain and/or file. */
export async function runLogoutCommand(options?: LogoutCommandOptions): Promise<void> {
  const keychain = options?.keychain ?? new KeychainStore();

  const deleted = await keychain.delete();
  if (deleted) {
    console.log("Logged out.");
  } else {
    console.log("Not logged in.");
  }
}
