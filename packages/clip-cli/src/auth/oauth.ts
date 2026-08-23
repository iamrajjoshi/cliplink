// OAuth Device Flow implementation for GitHub authentication.
// The token is never printed, logged, or included in error messages.

// This is a public value (no secret needed for Device Flow).
export const CLIENT_ID = "Ov23liD8qcgO98yL2y50";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface AccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

export interface DisplayInfo {
  userCode: string;
  verificationUri: string;
}

export interface OAuthClientOptions {
  clientId?: string;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidDeviceCodeResponse(data: unknown): data is DeviceCodeResponse {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj["device_code"] === "string" &&
    typeof obj["user_code"] === "string" &&
    typeof obj["verification_uri"] === "string" &&
    typeof obj["expires_in"] === "number" &&
    typeof obj["interval"] === "number"
  );
}

export class OAuthClient {
  private readonly clientId: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options?: OAuthClientOptions) {
    this.clientId = options?.clientId ?? CLIENT_ID;
    this.fetchFn = options?.fetchFn ?? fetch;
    this.sleepFn = options?.sleepFn ?? defaultSleep;
  }

  /** Request a device code from GitHub and return the response. */
  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    let response: Response;
    try {
      response = await this.fetchFn(DEVICE_CODE_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: this.clientId,
          scope: "repo",
        }),
      });
    } catch {
      throw new OAuthError("Could not connect to GitHub. Check your network connection.");
    }

    if (!response.ok) {
      throw new OAuthError(`Device code request failed (HTTP ${response.status}).`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new OAuthError("Invalid response from GitHub. Please try again.");
    }

    if (!isValidDeviceCodeResponse(data)) {
      throw new OAuthError("Invalid device code response from GitHub. Please try again.");
    }

    return data;
  }

  /** Poll the token endpoint until the user authorizes or the code expires. */
  async pollForToken(deviceCode: string, interval: number, expiresIn: number): Promise<string> {
    const deadline = Date.now() + expiresIn * 1000;
    let currentInterval = interval * 1000;

    for (;;) {
      if (Date.now() >= deadline) {
        throw new OAuthError("Device code expired. Please run 'clip login' again.");
      }

      await this.sleepFn(currentInterval);

      let response: Response;
      try {
        response = await this.fetchFn(TOKEN_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: this.clientId,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        });
      } catch {
        throw new OAuthError("Could not connect to GitHub. Check your network connection.");
      }

      if (!response.ok) {
        throw new OAuthError(`Token request failed (HTTP ${response.status}).`);
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new OAuthError("Invalid response from GitHub. Please try again.");
      }

      const tokenData = data as AccessTokenResponse;

      if (tokenData.error) {
        switch (tokenData.error) {
          case "authorization_pending":
            continue;
          case "slow_down":
            currentInterval += 5000;
            continue;
          case "expired_token":
          case "token_expired":
            throw new OAuthError("Device code expired. Please run 'clip login' again.");
          case "access_denied":
            throw new OAuthError("Authorization denied. Please run 'clip login' again.");
          default:
            throw new OAuthError(`Authentication error: ${tokenData.error}`);
        }
      }

      if (tokenData.access_token) {
        return tokenData.access_token;
      }

      throw new OAuthError("Invalid token response from GitHub. Please try again.");
    }
  }

  /** Verify the token with GET /user and return the login name. */
  async verifyToken(accessToken: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchFn(USER_URL, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      throw new OAuthError("Could not connect to GitHub. Check your network connection.");
    }

    if (!response.ok) {
      throw new OAuthError("Authentication failed: token could not be verified.");
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new OAuthError("Authentication failed: token could not be verified.");
    }

    if (typeof data !== "object" || data === null) {
      throw new OAuthError("Authentication failed: token could not be verified.");
    }

    const user = data as { login?: unknown };
    if (typeof user.login !== "string") {
      throw new OAuthError("Authentication failed: token could not be verified.");
    }

    return user.login;
  }

  /** Run the full Device Flow: request code, display, poll for token. */
  async authenticate(onDisplay: (info: DisplayInfo) => void): Promise<string> {
    const deviceCode = await this.requestDeviceCode();

    onDisplay({
      userCode: deviceCode.user_code,
      verificationUri: deviceCode.verification_uri,
    });

    return this.pollForToken(deviceCode.device_code, deviceCode.interval, deviceCode.expires_in);
  }
}
