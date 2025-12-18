# opencode-cursor-auth

Authentication provider for Cursor, extracting credentials from the local environment.

It supports extracting tokens from:
1.  **Cursor IDE** (Local SQLite DB) - If you use the main editor.
2.  **Cursor Agent** (JSON Config) - If you use the CLI/headless agent.

## Quick Start

### 1. Setup Cursor Credentials
If you don't have Cursor installed or configured, run the setup script to generate credentials:

```bash
./setup-cursor-auth.sh
```

### 2. Configure OpenCode
Add the plugin to your `~/.config/opencode/opencode.json` (or project config):

```json
{
  "plugin": ["opencode-cursor-auth"],
  "provider": {
    "cursor": {
      "options": {}
    }
  }
}
```

## Authentication

Run the OpenCode login command:

```bash
opencode auth login
```

Select **"Local Cursor Installation / Agent"**. This will verify your local credentials.

## Usage

You can now use Cursor as a provider in your OpenCode commands (assuming a model mapping exists):

```bash
opencode run "Hello world" --model=cursor/gpt-4
```

## Dependencies

-   `better-sqlite3`: For reading the IDE database.

## License

ISC
