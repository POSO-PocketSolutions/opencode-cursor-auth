# opencode-cursor-auth

Use `cursor-agent` inside OpenCode (CLI-first Cursor).

This plugin is for people who pay for Cursor (or have it paid for them) and want to use it from OpenCode instead of the Cursor UI.

## Requirements

- An active **Cursor Pro** subscription (or equivalent) so `cursor-agent` can access models.
- `cursor-agent` installed.

## Install cursor-agent (macOS/Linux)

```bash
curl -fsS https://cursor.com/install | bash
```

## Install

1) Install the plugin:

```bash
npm install opencode-cursor-auth
```

2) Add it to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-cursor-auth@1.0.16"
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
opencode run "listame los archivos del repo" --model cursor/auto
```

## Notes

- Tool-calling is experimental but works for built-in tools like `list`, `read`, `grep`, `bash`, `todowrite`.
- Token usage/cost accounting and a dedicated “thinking” panel are not available via `cursor-agent`.

## License

ISC
