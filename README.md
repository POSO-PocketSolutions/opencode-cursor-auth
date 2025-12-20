# opencode-cursor-auth

Cursor authentication + local Cursor Agent backend for OpenCode.

This plugin lets you use `cursor-agent` as an OpenAI-compatible provider inside OpenCode (no Cursor IDE required).

## Requirements

- `cursor-agent` installed (`curl -fsSL https://cursor.com/install | bash`)
- Logged in once (the plugin can trigger `cursor-agent login`)

## Install

Add the plugin to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "opencode-openai-codex-auth@4.1.0",
    "opencode-gemini-auth",
    "opencode-cursor-auth@1.0.9"
  ],
  "provider": {
    "cursor": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cursor Agent (local)",
      "options": {
        "baseURL": "http://127.0.0.1:32123/v1"
      },
      "models": {
        "auto": { "name": "Cursor Agent Auto" },
        "gpt-5": { "name": "Cursor Agent GPT-5 (alias → gpt-5.2)" },
        "gpt-5.2": { "name": "Cursor Agent GPT-5.2" },
        "gpt-5.1": { "name": "Cursor Agent GPT-5.1" },
        "gpt-5.1-codex": { "name": "Cursor Agent GPT-5.1 Codex" },
        "sonnet-4": { "name": "Cursor Agent Sonnet 4 (alias → sonnet-4.5)" },
        "sonnet-4.5": { "name": "Cursor Agent Sonnet 4.5" },
        "sonnet-4.5-thinking": { "name": "Cursor Agent Sonnet 4.5 Thinking" }
      }
    }
  }
}
```

## Login

```bash
opencode auth login
```

- Select provider: `Other`
- Provider id: `cursor`
- Method: `Login via cursor-agent (opens browser)`

## Run

```bash
opencode run "decime hola" --model cursor/gpt-5
opencode run "decime hola" --model cursor/gpt-5.2
```

## How It Works

- On startup, the plugin starts a local HTTP proxy on `127.0.0.1:32123`.
- OpenCode uses `@ai-sdk/openai-compatible` against `http://127.0.0.1:32123/v1`.
- The proxy translates `/v1/chat/completions` into a `cursor-agent` CLI call.

## Current Limitations

This integration is intentionally minimal and works well for plain chat/completions, but it does not currently provide:

- **OpenCode tool-calling (LSP/TODO/tools):** `cursor-agent` is a CLI agent and does not speak OpenAI tool-calls, so OpenCode can’t route tool calls.
- **Token usage / cost accounting:** `cursor-agent` does not expose token counts per request in a way OpenCode can consume.
- **“Thinking” UI sections:** we only stream assistant text; there’s no separate reasoning payload.

## Troubleshooting

- `Unauthorized: cursor-agent failed.`: your model name is not supported by your `cursor-agent`. Try `cursor/gpt-5.2` or `cursor/auto`.
- `Unable to connect`: another `opencode` instance might not have the proxy running, or the port `32123` is taken by something else. Try closing other `opencode` sessions, or change the port in both the plugin and `opencode.json`.

## License

ISC
