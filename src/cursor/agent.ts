import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { decodeJWT } from "../utils/jwt.js";
import type { AuthStrategy, CursorAuthResult } from "./types.js";

function getAgentAuthPath(): string {
  const platform = os.platform();
  const home = os.homedir();
  const domain = "cursor"; // Based on research, it uses lowercase "cursor"

  switch (platform) {
    case "win32":
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      return path.join(appData, "Cursor", "auth.json"); // Windows might title case it? Code said toWindowsTitleCase.
    case "darwin":
      return path.join(home, ".cursor", "auth.json");
    case "linux":
    default:
      const configDir = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
      return path.join(configDir, domain, "auth.json");
  }
}

export class AgentAuthStrategy implements AuthStrategy {
  async login(): Promise<CursorAuthResult> {
    const authPath = getAgentAuthPath();
    
    if (!fs.existsSync(authPath)) {
      return {
        type: "failed",
        error: `No cursor-agent auth file found at ${authPath}`,
      };
    }

    try {
      const content = fs.readFileSync(authPath, "utf-8");
      const data = JSON.parse(content);

      if (!data.accessToken) {
        return {
          type: "failed",
          error: "Invalid agent auth file: missing accessToken",
        };
      }

      const accessToken = data.accessToken;
      const refreshToken = data.refreshToken || "";
      
      let email = undefined;
      let expiresAt: number | undefined;

      const payload = decodeJWT(accessToken);
      if (payload) {
        if (typeof payload.email === "string") email = payload.email;
        if (typeof payload.exp === "number") expiresAt = payload.exp * 1000;
      }

      return {
        type: "success",
        source: "agent",
        token: {
          accessToken,
          refreshToken,
          email,
          expiresAt,
        },
      };

    } catch (error) {
      return {
        type: "failed",
        error: `Failed to read agent auth file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
