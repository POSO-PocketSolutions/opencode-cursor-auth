const CURSOR_PROVIDER_ID = "cursor";
// Local proxy server that translates OpenAI-compatible HTTP to cursor-agent CLI.
const CURSOR_PROXY_HOST = "127.0.0.1";
const CURSOR_PROXY_DEFAULT_PORT = 32123;
const CURSOR_PROXY_DEFAULT_BASE_URL = `http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/v1`;
function openAIError(status, message, details) {
    const body = {
        error: {
            message: details ? `${message}\n${details}` : message,
            type: "cursor_agent_error",
            param: null,
            code: null,
        },
    };
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
function normalizeCursorAgentModel(model) {
    if (!model)
        return "auto";
    const aliases = {
        "gpt-5": "gpt-5.2",
        "sonnet-4": "sonnet-4.5",
    };
    return aliases[model] || model;
}
function summarizeTool(tool) {
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
function extractPromptFromChatCompletions(body) {
    const model = typeof body?.model === "string" ? body.model : undefined;
    const stream = body?.stream === true;
    const tools = Array.isArray(body?.tools) ? body.tools : [];
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lines = [];
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
            lines.push(`ASSISTANT TOOL_CALLS: ${JSON.stringify(message.tool_calls)}`);
            continue;
        }
        const content = message.content;
        if (typeof content === "string") {
            lines.push(`${role.toUpperCase()}: ${content}`);
            continue;
        }
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
function parseToolCallPlan(output) {
    const start = output.indexOf("{");
    const end = output.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start)
        return null;
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
                    .filter((t) => t && typeof t.name === "string")
                    .map((t) => ({ name: t.name, arguments: t.arguments ?? {} })),
            };
        }
        return null;
    }
    catch {
        return null;
    }
}
function buildToolCallingPrompt(conversation, tools, workspaceDirectory) {
    const toolList = tools.length ? tools.map(summarizeTool).join("\n") : "(none)";
    return [
        "You are a tool-calling assistant running inside OpenCode.",
        `Workspace directory: ${workspaceDirectory}`,
        "",
        "Available tools:",
        toolList,
        "",
        "RULES:",
        "- If a tool can answer, prefer calling it.",
        "- Use ONLY tool names from the list above.",
        "- Use absolute paths when a tool expects a path.",
        "- Return ONLY one JSON object. No markdown.",
        "",
        "RESPONSE FORMAT:",
        "- Call tool(s):",
        '{"action":"tool_call","tool_calls":[{"name":"tool_name","arguments":{}}]}',
        "- Final answer:",
        '{"action":"final","content":"..."}',
        "",
        "Conversation:",
        conversation,
    ].join("\n");
}
function createChatCompletionResponse(model, content) {
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
function createChatCompletionChunk(id, created, model, deltaContent, done = false) {
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
function getGlobalKey() {
    return "__opencode_cursor_proxy_server__";
}
async function ensureCursorProxyServer(workspaceDirectory) {
    const key = getGlobalKey();
    const g = globalThis;
    const existingBaseURL = g[key]?.baseURL;
    if (typeof existingBaseURL === "string" && existingBaseURL.length > 0) {
        return existingBaseURL;
    }
    // Mark as starting to avoid duplicate starts in-process.
    g[key] = { baseURL: "" };
    const handler = async (req) => {
        try {
            const url = new URL(req.url);
            if (url.pathname === "/health") {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
            if (url.pathname !== "/v1/chat/completions" && url.pathname !== "/chat/completions") {
                return openAIError(404, `Unsupported path: ${url.pathname}`);
            }
            const body = await req.json().catch(() => ({}));
            const { prompt, model, stream, tools } = extractPromptFromChatCompletions(body);
            const selectedModel = normalizeCursorAgentModel(model);
            const effectivePrompt = tools.length ? buildToolCallingPrompt(prompt, tools, workspaceDirectory) : prompt;
            const bunAny = globalThis;
            if (!bunAny.Bun?.spawn) {
                return openAIError(500, "This provider requires Bun runtime.");
            }
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
            const child = bunAny.Bun.spawn({
                cmd,
                stdout: "pipe",
                stderr: "pipe",
                env: bunAny.Bun.env,
            });
            if (!stream) {
                const [stdoutText, stderrText] = await Promise.all([
                    new Response(child.stdout).text(),
                    new Response(child.stderr).text(),
                ]);
                const stdout = (stdoutText || "").trim();
                const stderr = (stderrText || "").trim();
                // If tools were requested and we can parse a plan, treat it as success even if exitCode != 0.
                const plan = tools.length ? parseToolCallPlan(stdout) : null;
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
                if (child.exitCode !== 0) {
                    return openAIError(401, "cursor-agent failed.", stderr || stdout);
                }
                const payload = createChatCompletionResponse(selectedModel, stdout);
                return new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
            // Streaming.
            const encoder = new TextEncoder();
            const id = `cursor-agent-${Date.now()}`;
            const created = Math.floor(Date.now() / 1000);
            const sse = new ReadableStream({
                async start(controller) {
                    let closed = false;
                    try {
                        // Tool-calling + streaming: buffer stdout to decide whether to emit tool_calls.
                        if (tools.length) {
                            // Keep the SSE connection alive while cursor-agent thinks.
                            const heartbeat = () => {
                                if (closed)
                                    return;
                                try {
                                    const pingChunk = createChatCompletionChunk(id, created, selectedModel, "", false);
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(pingChunk)}\n\n`));
                                }
                                catch {
                                    // ignore
                                }
                            };
                            heartbeat();
                            const interval = setInterval(heartbeat, 1000);
                            const [stdoutText, stderrText] = await Promise.all([
                                new Response(child.stdout).text(),
                                new Response(child.stderr).text(),
                            ]).finally(() => {
                                clearInterval(interval);
                            });
                            const stdout = (stdoutText || "").trim();
                            const stderr = (stderrText || "").trim();
                            const plan = parseToolCallPlan(stdout);
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
                            const content = plan?.action === "final" ? plan.content : stdout;
                            if (child.exitCode !== 0 && !plan) {
                                const err = openAIError(401, "cursor-agent failed.", stderr || stdout);
                                const errText = await err.text();
                                // Emit as assistant content to avoid schema validation failures in SSE mode.
                                const msg = `cursor-agent failed: ${errText}`;
                                const finalChunk = createChatCompletionChunk(id, created, selectedModel, msg, true);
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
                                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                                return;
                            }
                            const finalChunk = createChatCompletionChunk(id, created, selectedModel, content, true);
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
                            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                            return;
                        }
                        // No tools: stream stdout as text deltas.
                        const decoder = new TextDecoder();
                        const reader = child.stdout.getReader();
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done)
                                break;
                            if (!value || value.length === 0)
                                continue;
                            const text = decoder.decode(value, { stream: true });
                            if (!text)
                                continue;
                            const chunk = createChatCompletionChunk(id, created, selectedModel, text, false);
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                        }
                        if (child.exitCode !== 0) {
                            const stderrText = await new Response(child.stderr).text();
                            const msg = `cursor-agent failed: ${(stderrText || "").trim()}`;
                            const errChunk = createChatCompletionChunk(id, created, selectedModel, msg, true);
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
                            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                            return;
                        }
                        const doneChunk = createChatCompletionChunk(id, created, selectedModel, "", true);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneChunk)}\n\n`));
                        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    }
                    finally {
                        closed = true;
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return openAIError(500, "Proxy error", message);
        }
    };
    const bunAny = globalThis;
    if (typeof bunAny.Bun !== "undefined" && typeof bunAny.Bun.serve === "function") {
        // If another process already started a proxy on the default port, reuse it.
        try {
            const res = await fetch(`http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/health`).catch(() => null);
            if (res && res.ok) {
                g[key].baseURL = CURSOR_PROXY_DEFAULT_BASE_URL;
                return CURSOR_PROXY_DEFAULT_BASE_URL;
            }
        }
        catch {
            // ignore
        }
        const startServer = (port) => {
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
        }
        catch (error) {
            const code = error?.code;
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
            }
            catch {
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
export const CursorAuthPlugin = async ({ $, directory }) => {
    const proxyBaseURL = await ensureCursorProxyServer(directory);
    return {
        auth: {
            provider: CURSOR_PROVIDER_ID,
            async loader(_getAuth) {
                return {};
            },
            methods: [
                {
                    label: "Login via cursor-agent (opens browser)",
                    type: "api",
                    authorize: async () => {
                        const check = await $ `cursor-agent --version`.quiet().nothrow();
                        if (check.exitCode !== 0) {
                            return { type: "failed" };
                        }
                        const whoami = await $ `cursor-agent whoami`.quiet().nothrow();
                        const whoamiText = whoami.text();
                        if (whoamiText.includes("Not logged in")) {
                            const login = await $ `cursor-agent login`.nothrow();
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
            // Always point to the actual proxy base URL (may be dynamically allocated).
            output.options.baseURL = proxyBaseURL;
            output.options.apiKey = output.options.apiKey || "cursor-agent";
        },
    };
};
//# sourceMappingURL=plugin.js.map