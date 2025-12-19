import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { getCursorAuth } from "./cursor/auth.js";

const CURSOR_PROVIDER_ID = "cursor";

export const CursorAuthPlugin: Plugin = async (_input: PluginInput) => {
  return {
    auth: {
      provider: CURSOR_PROVIDER_ID,
      async loader(_getAuth: any, _provider: any) {
        const result = await getCursorAuth();

        if (result.type === "failed" || !result.token) {
          return {};
        }

        const accessToken = result.token.accessToken;

        return {
          apiKey: accessToken,
          async fetch(input: Request | string | URL, init?: RequestInit) {
            const headers = new Headers(init?.headers);
            headers.set("Authorization", `Bearer ${accessToken}`);

            return fetch(input, { ...init, headers });
          },
        };
      },
      methods: [
        {
          label: "Use local Cursor session (IDE/Agent)",
          type: "api",
          authorize: async () => {
            const result = await getCursorAuth();
            if (result.type === "success" && result.token) {
              return {
                type: "success",
                key: result.token.accessToken,
              };
            }
            return { type: "failed" };
          },
        },
      ],
    },
  };
};
