export interface CursorToken {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number | undefined;
  expiresAt?: number | undefined;
  email?: string | undefined;
}

export interface CursorAuthResult {
  type: "success" | "failed";
  token?: CursorToken;
  error?: string;
  source?: "local" | "agent" | "oauth";
}

export interface AuthStrategy {
  login(): Promise<CursorAuthResult>;
}
