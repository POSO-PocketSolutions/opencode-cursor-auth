import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { getCursorAuth } from "./cursor/auth.js";
import { CURSOR_PROVIDER_ID, CURSOR_API_BASE_URL } from "./constants.js";

export const CursorAuthPlugin: Plugin = async (_input: PluginInput) => {
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
          async fetch(input: Request | string | URL, init?: RequestInit) {
            const headers = new Headers(init?.headers);
            headers.set("Authorization", `Bearer ${accessToken}`);
            
            // Cursor-specific headers might be needed, e.g.
            // headers.set("User-Agent", "Cursor/0.1.0");

            const requestInit: RequestInit = {
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
          type: "local", // Using 'local' type as it doesn't fit standard 'oauth' or 'api' perfectly
          authorize: async () => {
             // This method is called when the user explicitly requests login via opencode CLI
             const result = await getCursorAuth();
             if (result.type === "success" && result.token) {
                 return {
                     type: "success",
                     // We can return the token here if the interface expects it, 
                     // but usually 'local' methods just verify presence.
                 };
             }
             return {
                 type: "failed",
                 error: result.error || "Could not find local Cursor credentials."
             };
          }
        },
      ],
    },
  };
};
