import { getCursorAuth } from "./cursor/auth.js";
async function main() {
    console.log("Attempting to authenticate with Cursor...");
    const result = await getCursorAuth();
    if (result.type === "success" && result.token) {
        console.log("Authentication Successful!");
        console.log("Source:", result.source);
        console.log("Email:", result.token.email);
        console.log("Expires At:", result.token.expiresAt ? new Date(result.token.expiresAt).toISOString() : "Unknown");
        console.log("Access Token (first 20 chars):", result.token.accessToken.substring(0, 20) + "...");
        console.log("Refresh Token (present):", !!result.token.refreshToken);
    }
    else {
        console.error("Authentication Failed:", result.error);
        process.exit(1);
    }
}
main().catch(console.error);
//# sourceMappingURL=cli.js.map