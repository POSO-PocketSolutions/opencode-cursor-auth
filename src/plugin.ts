import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Auth } from "@opencode-ai/sdk";

const CURSOR_PROVIDER_ID = "cursor";
// Local proxy server that translates OpenAI-compatible HTTP to cursor-agent CLI.
const CURSOR_PROXY_HOST = "127.0.0.1";
const CURSOR_PROXY_PORT = 32123;
const CURSOR_PROXY_BASE_URL = `http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_PORT}/v1`;

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

function getGlobalKey(): string {
  return "__opencode_cursor_proxy_server__";
}

async function ensureCursorProxyServer(
  $: PluginInput["$"],
  workspaceDirectory: string,
): Promise<void> {
  const key = getGlobalKey();
  const g = globalThis as any;
  if (g[key]?.started) {
    return;
  }

  g[key] = { started: true };

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname !== "/v1/chat/completions" && url.pathname !== "/chat/completions") {
      return new Response(JSON.stringify({ error: `Unsupported path: ${url.pathname}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { prompt, model, stream } = extractPromptFromChatCompletions(body);
    const selectedModel = model || "gpt-5";

    const command = $`cursor-agent --print --output-format text --workspace ${workspaceDirectory} --model ${selectedModel} ${prompt}`
      .quiet()
      .nothrow();

    const result = await command;
    const stdout = result.text();
    const stderr = result.stderr.toString();

    if (result.exitCode !== 0) {
      return new Response(
        JSON.stringify({
          error: "cursor-agent failed.",
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
  };

  if (typeof (globalThis as any).Bun !== "undefined" && typeof (globalThis as any).Bun.serve === "function") {
    (globalThis as any).Bun.serve({
      hostname: CURSOR_PROXY_HOST,
      port: CURSOR_PROXY_PORT,
      fetch: handler,
    });
    return;
  }

  // Fallback (shouldn't happen inside opencode, which runs Bun).
  throw new Error("Cursor proxy server requires Bun runtime");
}

export const CursorAuthPlugin: Plugin = async ({ $, directory }: PluginInput) => {
  await ensureCursorProxyServer($, directory);

  // We still provide a fetch override (best-effort), but the primary integration is the local HTTP proxy.
  const cursorFetch = async (input: Request | string | URL, init?: RequestInit) => {
    const urlString = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(urlString);

    const target = new URL(url.pathname, CURSOR_PROXY_BASE_URL);
    return fetch(target, init);
  };

  return {
    auth: {
      provider: CURSOR_PROVIDER_ID,
      async loader(_getAuth: () => Promise<Auth>) {
        // Loader isn't used to override the AI SDK transport.
        return {};
      },
      methods: [
        {
          label: "Login via cursor-agent (opens browser)",
          type: "api",
          authorize: async () => {
            const check = await $`cursor-agent --version`.quiet().nothrow();
            if (check.exitCode !== 0) {
              return { type: "failed" };
            }

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
              key: "cursor-agent",
            };
          },
        },
      ],
    },

    async "chat.params"(input, output) {
      if (input.model.providerID !== CURSOR_PROVIDER_ID) {
        return;
      }

      // Ensure AI SDK has a base URL to build request URLs.
      output.options.baseURL = output.options.baseURL || CURSOR_PROXY_BASE_URL;
      // Override transport so we call cursor-agent instead of HTTP.
      output.options.fetch = cursorFetch;
      // apiKey is required by the OpenAI-compatible provider, but not used by cursorFetch.
      output.options.apiKey = output.options.apiKey || "cursor-agent";
    },
  };
};
