import { getCursorStateDbPath } from "../utils/platform.js";
import { getDbValue } from "../utils/db.js";
import { decodeJWT } from "../utils/jwt.js";
export class LocalAuthStrategy {
    async login() {
        const dbPath = getCursorStateDbPath();
        const accessToken = getDbValue(dbPath, "cursorAuth/accessToken");
        const refreshToken = getDbValue(dbPath, "cursorAuth/refreshToken");
        // Sometimes email is stored separately
        let email = getDbValue(dbPath, "cursorAuth/cachedEmail");
        if (!accessToken) {
            return {
                type: "failed",
                error: "No access token found in local Cursor installation.",
            };
        }
        // Try to extract email from JWT if not found in DB
        if (!email) {
            const payload = decodeJWT(accessToken);
            if (payload && typeof payload.email === "string") {
                email = payload.email;
            }
        }
        // Parse expiry
        let expiresAt;
        const payload = decodeJWT(accessToken);
        if (payload && typeof payload.exp === "number") {
            expiresAt = payload.exp * 1000;
        }
        return {
            type: "success",
            source: "local",
            token: {
                accessToken,
                refreshToken: refreshToken || "",
                email: email || undefined,
                expiresAt,
            },
        };
    }
}
//# sourceMappingURL=local.js.map