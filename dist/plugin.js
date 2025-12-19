import { getCursorAuth } from "./cursor/auth.js";
import { CURSOR_PROVIDER_ID, CURSOR_API_BASE_URL } from "./constants.js";
export const CursorAuthPlugin = async (_input) => {
    return {
        auth: {
            provider: CURSOR_PROVIDER_ID,
            async loader(_getAuth, _provider) {
                // Attempt to get auth immediately
                const result = await getCursorAuth();
                if (result.type === "failed" || !result.token) {
                    console.warn(`[Cursor Auth] Failed to load credentials: ${result.error}`);
                    return {};
                }
                const accessToken = result.token.accessToken;
                return {
                    baseURL: CURSOR_API_BASE_URL,
                    // Custom fetch to inject headers
                    async fetch(input, init) {
                        const headers = new Headers(init?.headers);
                        headers.set("Authorization", `Bearer ${accessToken}`);
                        const requestInit = {
                            ...init,
                            headers,
                        };
                        return fetch(input, requestInit);
                    },
                };
            },
            methods: [
                {
                    label: "Local Cursor Installation / Agent",
                    type: "api",
                    authorize: async () => {
                        // This method is called when the user explicitly requests login via opencode CLI
                        const result = await getCursorAuth();
                        if (result.type === "success" && result.token) {
                            return {
                                type: "success",
                                // Return the access token as the 'key'
                                key: result.token.accessToken
                            };
                        }
                        return {
                            type: "failed"
                            // Note: The interface might not accept 'error' string in failed state based on error msg
                            // "{ type: "failed"; }"
                        };
                    }
                },
            ],
        },
    };
};
//# sourceMappingURL=plugin.js.map