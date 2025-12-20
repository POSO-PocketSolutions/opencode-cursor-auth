import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Auth } from "@opencode-ai/sdk";

const CURSOR_PROVIDER_ID = "opencode-cursor";
const CURSOR_AGENT_BASE_URL = "http://cursor-agent.local";

function extractPromptFromChatCompletions(body: any): { prompt: string; model?: string; stream: boolean } {
  const model = typeof body?.model === "string" ? body.model : undefined;
  const stream = body?.stream === true;

  const messages: Array<{ role?: string; content?: any }> = Array.isArray(body?.messages)
    ? body.messages
    : [];

  const lines: string[] = [];
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "user";
    const content = message.content;

    if (typeof content === "string") {
      lines.push(`${role.toUpperCase()}: ${content}`);
      continue;
    }

    // Best-effort: OpenAI-style multi-part content
    if (Array.isArray(content)) {
      const textParts = content
        .map((part) => {
          if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
            return part.text;
          }
          return "";
        })
        .filter(Boolean);
      if (textParts.length) {
        lines.push(`${role.toUpperCase()}: ${textParts.join("\n")}`);
      }
      continue;
    }
  }

  return { prompt: lines.join("\n\n"), model, stream };
}

function createChatCompletionResponse(model: string, content: string) {
  return {
    id: `cursor-agent-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

export const CursorAuthPlugin: Plugin = async ({ $ , directory }: PluginInput) => {
  return {
    auth: {
      provider: CURSOR_PROVIDER_ID,
      async loader(getAuth: () => Promise<Auth>) {
        const auth = await getAuth();
        // We only support API-style auth for cursor-agent.
        if (auth.type !== "api") {
          return {};
        }

        return {
          apiKey: auth.key,
          baseURL: CURSOR_AGENT_BASE_URL,
          async fetch(input: Request | string | URL, init?: RequestInit) {
            const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
            const path = (() => {
              try {
                return new URL(url).pathname;
              } catch {
                return url;
              }
            })();

            // Minimal: emulate OpenAI chat.completions via cursor-agent CLI.
            if (!path.endsWith("/v1/chat/completions") && !path.endsWith("/chat/completions")) {
              // Return a helpful error for unknown endpoints.
              return new Response(JSON.stringify({ error: `Unsupported endpoint for cursor-agent backend: ${path}` }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              });
            }

            const bodyText = typeof init?.body === "string" ? init.body : "{}";
            const body = JSON.parse(bodyText);
            const { prompt, model, stream } = extractPromptFromChatCompletions(body);
            const selectedModel = model || "gpt-5";

            const command = $`cursor-agent --print --output-format text --workspace ${directory} --model ${selectedModel} ${prompt}`
              .quiet()
              .nothrow();

            const result = await command;
            const stdout = result.text();
            const stderr = result.stderr.toString();

            if (result.exitCode !== 0) {
              return new Response(
                JSON.stringify({
                  error:
                    "cursor-agent failed. Run `cursor-agent login` (or `opencode auth login` -> cursor) and try again.",
                  details: stderr || stdout,
                }),
                { status: 401, headers: { "Content-Type": "application/json" } },
              );
            }

            const payload = createChatCompletionResponse(selectedModel, stdout.trim());

            if (!stream) {
              return new Response(JSON.stringify(payload), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }

            // Very simple SSE stream: emit one delta then DONE.
            const encoder = new TextEncoder();
            const sse = new ReadableStream({
              start(controller) {
                const chunk = {
                  id: payload.id,
                  object: "chat.completion.chunk",
                  created: payload.created,
                  model: payload.model,
                  choices: [
                    {
                      index: 0,
                      delta: { content: payload.choices[0].message.content },
                      finish_reason: "stop",
                    },
                  ],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              },
            });

            return new Response(sse, {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              },
            });
          },
        };
      },
      methods: [
        {
          label: "Login via cursor-agent (opens browser)",
          type: "api",
          authorize: async () => {
            // Ensure cursor-agent is installed
            const check = await $`cursor-agent --version`.quiet().nothrow();
            if (check.exitCode !== 0) {
              return { type: "failed" };
            }

            // If not logged in, run login
            const whoami = await $`cursor-agent whoami`.quiet().nothrow();
            const whoamiText = whoami.text();
            if (whoamiText.includes("Not logged in")) {
              const login = await $`cursor-agent login`.nothrow();
              if (login.exitCode !== 0) {
                return { type: "failed" };
              }
            }

            return {
              type: "success",
              // This key is just a sentinel to enable the loader.
              key: "cursor-agent",
            };
          },
        },
      ],
    },
  };
};
