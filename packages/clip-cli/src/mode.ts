/**
 * Mode detection for the clip command flow.
 *
 * Determines whether a clip is published locally (via git) or remotely
 * (via the GitHub API) based on the --local flag and token availability.
 */

export type PublishMode = "local" | "remote";

export interface ModeDetectionOptions {
  /** True when --local flag is passed (forces local mode). */
  local: boolean;
  /** GitHub access token or null when not logged in. */
  token: string | null;
}

/**
 * Determines the publishing mode based on the --local flag and token
 * availability.
 *
 * - `--local` flag → always local mode (even when logged in)
 * - Token available and no `--local` → remote mode (default after login)
 * - No token → local mode (backward compatible with pre-auth behavior)
 */
export function detectMode(options: ModeDetectionOptions): PublishMode {
  if (options.local) {
    return "local";
  }

  if (options.token) {
    return "remote";
  }

  return "local";
}
