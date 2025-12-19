export function decodeJWT(token) {
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
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=jwt.js.map