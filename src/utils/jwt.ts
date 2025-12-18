export interface JWTPayload {
  sub?: string;
  email?: string;
  exp?: number;
  iss?: string;
  aud?: string;
  [key: string]: unknown;
}

export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    if (typeof payload !== 'string') {
        return null;
    }
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}
