import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Auth } from "@opencode-ai/sdk";

const CURSOR_PROVIDER_ID = "cursor";

// Local proxy server that translates OpenAI-compatible HTTP to cursor-agent CLI.
const CURSOR_PROXY_HOST = "127.0.0.1";
const CURSOR_PROXY_DEFAULT_PORT = 32123;
const CURSOR_PROXY_DEFAULT_BASE_URL = `http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/v1`;

function normalizeCursorAgentModel(model?: string): string {
  if (!model) return "auto";

  // Aliases for convenience / opencode model IDs.
  const aliases: Record<string, string> = {
    "gpt-5": "gpt-5.2",
    "sonnet-4": "sonnet-4.5",
  };

  return aliases[model] || model;
}

type ToolDef = {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: any;
  };
};

type ToolCallPlan =
  | { action: "final"; content: string }
  | { action: "tool_call"; tool_calls: Array<{ name: string; arguments: any }> };

function summarizeTool(tool: ToolDef): string {
  const name = tool?.function?.name || "unknown";
  const description = tool?.function?.description || "";
  const params = tool?.function?.parameters;

  let paramsSummary = "";
  if (params && typeof params === "object") {
    const props = params.properties && typeof params.properties === "object" ? Object.keys(params.properties) : [];
    const required = Array.isArray(params.required) ? params.required : [];
    paramsSummary = `args: { ${props.join(", ")} } required: [${required.join(", ")}]`;
  }

  return `- ${name}${description ? `: ${description}` : ""}${paramsSummary ? ` (${paramsSummary})` : ""}`;
}

function extractPromptFromChatCompletions(body: any): {
  prompt: string;
  model?: string;
  stream: boolean;
  tools: ToolDef[];
} {
  const model = typeof body?.model === "string" ? body.model : undefined;
  const stream = body?.stream === true;
  const tools: ToolDef[] = Array.isArray(body?.tools) ? body.tools : [];

  const messages: Array<any> = Array.isArray(body?.messages) ? body.messages : [];

  const lines: string[] = [];
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "user";

    if (role === "tool") {
      const name = typeof message.name === "string" ? message.name : "tool";
      const toolCallId = typeof message.tool_call_id === "string" ? message.tool_call_id : "";
      const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
      lines.push(`TOOL RESULT (${name}${toolCallId ? `, id=${toolCallId}` : ""}): ${content}`);
      continue;
    }

    if (role === "assistant" && Array.isArray(message.tool_calls)) {
      // In case OpenCode includes previous tool_calls.
      lines.push(`ASSISTANT TOOL_CALLS: ${JSON.stringify(message.tool_calls)}`);
      continue;
    }

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

  return { prompt: lines.join("\n\n"), model, stream, tools };
}

function parseToolCallPlan(output: string): ToolCallPlan | null {
  // Best-effort: find JSON object in the output.
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const jsonText = output.slice(start, end + 1);
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && parsed.action === "final" && typeof parsed.content === "string") {
      return { action: "final", content: parsed.content };
    }
    if (parsed && parsed.action === "tool_call" && Array.isArray(parsed.tool_calls)) {
      return {
        action: "tool_call",
        tool_calls: parsed.tool_calls
          .filter((t: any) => t && typeof t.name === "string")
          .map((t: any) => ({ name: t.name, arguments: t.arguments ?? {} })),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function buildToolCallingPrompt(conversation: string, tools: ToolDef[]): string {
  const toolList = tools.length ? tools.map(summarizeTool).join("\n") : "(none)";

  return [
    "You are a tool-calling assistant running inside OpenCode.",
    "You can call tools when needed to answer the user.",
    "",
    "Available tools:",
    toolList,
    "",
    "IMPORTANT RESPONSE FORMAT:",
    "Return ONLY one JSON object (no markdown, no extra text).",
    "If you want to call tool(s):",
    '{"action":"tool_call","tool_calls":[{"name":"tool_name","arguments":{}}]}',
    "If you want to answer the user directly:",
    '{"action":"final","content":"..."}',
    "",
    "Conversation:",
    conversation,
  ].join("\n");
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

function createChatCompletionChunk(id: string, created: number, model: string, deltaContent: string, done = false) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: deltaContent ? { content: deltaContent } : {},
        finish_reason: done ? "stop" : null,
      },
    ],
  };
}

function getGlobalKey(): string {
  return "__opencode_cursor_proxy_server__";
}

async function ensureCursorProxyServer(workspaceDirectory: string): Promise<string> {
  const key = getGlobalKey();
  const g = globalThis as any;

  const existingBaseURL = g[key]?.baseURL;
  if (typeof existingBaseURL === "string" && existingBaseURL.length > 0) {
    return existingBaseURL;
  }

  // Mark as starting to avoid duplicate starts in-process.
  g[key] = { baseURL: "" };

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname !== "/v1/chat/completions" && url.pathname !== "/chat/completions") {
      return new Response(JSON.stringify({ error: `Unsupported path: ${url.pathname}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { prompt, model, stream, tools } = extractPromptFromChatCompletions(body);
    const selectedModel = normalizeCursorAgentModel(model);

    // If tools are provided, ask cursor-agent to output a JSON plan (final vs tool_call).
    const effectivePrompt = tools.length ? buildToolCallingPrompt(prompt, tools) : prompt;

    // Note: cursor-agent expects the prompt as a positional arg.
    // This is a best-effort adapter; we don’t currently support tool-calling.
    const cmd = [
      "cursor-agent",
      "--print",
      "--output-format",
      "text",
      "--workspace",
      workspaceDirectory,
      "--model",
      selectedModel,
      effectivePrompt,
    ];

    const bunAny = globalThis as any;
    if (!bunAny.Bun?.spawn) {
      return new Response(JSON.stringify({ error: "This provider requires Bun runtime." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const child = bunAny.Bun.spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
      env: bunAny.Bun.env,
    });

    // Non-streaming: buffer stdout/stderr.
    if (!stream) {
      const [stdoutBytes, stderrBytes] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).arrayBuffer(),
      ]);

      const stdout = new TextDecoder().decode(stdoutBytes).trim();
      const stderr = new TextDecoder().decode(stderrBytes).trim();

      if (child.exitCode !== 0) {
        return new Response(JSON.stringify({ error: "cursor-agent failed.", details: stderr || stdout }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Tool-calling support (non-streaming).
      if (tools.length) {
        const plan = parseToolCallPlan(stdout);
        if (plan?.action === "tool_call") {
          const toolCalls = plan.tool_calls.map((tc, i) => ({
            id: `call_${Date.now()}_${i}`,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments ?? {}),
            },
          }));

          const payload = {
            id: `cursor-agent-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: selectedModel,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: toolCalls,
                },
                finish_reason: "tool_calls",
              },
            ],
          };

          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (plan?.action === "final") {
          const payload = createChatCompletionResponse(selectedModel, plan.content);
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      const payload = createChatCompletionResponse(selectedModel, stdout);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const id = `cursor-agent-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const sse = new ReadableStream({
      async start(controller) {
        try {
          // Tool-calling with streaming: buffer stdout, then emit tool_call or final chunks.
          if (tools.length) {
            const stdoutText = await new Response(child.stdout).text();
            const stderrText = await new Response(child.stderr).text();

            if (child.exitCode !== 0) {
              const errChunk = { error: "cursor-agent failed.", details: stderrText || stdoutText };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              return;
            }

            const plan = parseToolCallPlan(stdoutText.trim());
            if (plan?.action === "tool_call") {
              const toolCalls = plan.tool_calls.map((tc, i) => ({
                index: i,
                id: `call_${Date.now()}_${i}`,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.arguments ?? {}),
                },
              }));

              const chunk = {
                id,
                object: "chat.completion.chunk",
                created,
                model: selectedModel,
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: "assistant",
                      tool_calls: toolCalls,
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              };

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              return;
            }

            const content = plan?.action === "final" ? plan.content : stdoutText.trim();
            const chunk = createChatCompletionChunk(id, created, selectedModel, content, true);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            return;
          }

          // Streaming (no tools): forward stdout incrementally.
          const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value || value.length === 0) continue;

            const text = decoder.decode(value, { stream: true });
            if (text) {
              const chunk = createChatCompletionChunk(id, created, selectedModel, text, false);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
          }

          if (child.exitCode !== 0) {
            const stderrText = await new Response(child.stderr).text();
            const errChunk = {
              error: "cursor-agent failed.",
              details: stderrText,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
          }

          const doneChunk = createChatCompletionChunk(id, created, selectedModel, "", true);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneChunk)}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          controller.close();
        }
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

  const bunAny = globalThis as any;
  if (typeof bunAny.Bun !== "undefined" && typeof bunAny.Bun.serve === "function") {
    // If another process already started a proxy on the default port, reuse it.
    try {
      const res = await fetch(`http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/health`).catch(() => null);
      if (res && res.ok) {
        g[key].baseURL = CURSOR_PROXY_DEFAULT_BASE_URL;
        return CURSOR_PROXY_DEFAULT_BASE_URL;
      }
    } catch {
      // ignore
    }

    const startServer = (port: number) => {
      return bunAny.Bun.serve({
        hostname: CURSOR_PROXY_HOST,
        port,
        fetch: handler,
      });
    };

    try {
      const server = startServer(CURSOR_PROXY_DEFAULT_PORT);
      const baseURL = `http://${CURSOR_PROXY_HOST}:${server.port}/v1`;
      g[key].baseURL = baseURL;
      return baseURL;
    } catch (error) {
      const code = (error as any)?.code;
      if (code !== "EADDRINUSE") {
        throw error;
      }

      // Something is already bound to the default port. Only reuse it if it looks like our proxy.
      try {
        const res = await fetch(`http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/health`).catch(() => null);
        if (res && res.ok) {
          g[key].baseURL = CURSOR_PROXY_DEFAULT_BASE_URL;
          return CURSOR_PROXY_DEFAULT_BASE_URL;
        }
      } catch {
        // ignore
      }

      // Fallback: start on a random free port.
      const server = startServer(0);
      const baseURL = `http://${CURSOR_PROXY_HOST}:${server.port}/v1`;
      g[key].baseURL = baseURL;
      return baseURL;
    }
  }

  throw new Error("Cursor proxy server requires Bun runtime");
}

export const CursorAuthPlugin: Plugin = async ({ $, directory }: PluginInput) => {
  const proxyBaseURL = await ensureCursorProxyServer(directory);

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
              // Sentinel key (OpenCode expects an API key).
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
      output.options.baseURL = proxyBaseURL;
      // apiKey is required by the OpenAI-compatible provider, but not used by our proxy.
      output.options.apiKey = output.options.apiKey || "cursor-agent";
    },
  };
};
