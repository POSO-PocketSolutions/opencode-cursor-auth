# opencode-cursor-auth

Authentication provider for Cursor, extracting credentials from the local environment.

It supports extracting tokens from:
1.  **Cursor IDE** (Local SQLite DB) - If you use the main editor.
2.  **Cursor Agent** (JSON Config) - If you use the CLI/headless agent.

## Quick Start

If you don't have Cursor installed or configured, run the setup script:

```bash
./setup-cursor-auth.sh
```

This script will:
1.  Install Cursor (if missing).
2.  Trigger the `cursor-agent login` flow (opens browser).
3.  Verify the token extraction works.

## Usage

```typescript
import { getCursorAuth } from "opencode-cursor-auth";

const auth = await getCursorAuth();

if (auth.type === "success" && auth.token) {
  console.log("Access Token:", auth.token.accessToken);
  console.log("Source:", auth.source); // "local" (IDE) or "agent" (CLI)
}
```

## How it works

The library attempts to find authentication tokens in the following order:
1.  **Local IDE Storage**: Checks `state.vscdb` in standard Cursor paths.
2.  **Agent Configuration**: Checks `auth.json` in `~/.config/cursor/` (Linux), `~/.cursor/` (Mac), or `%APPDATA%` (Windows).

## Dependencies

-   `better-sqlite3`: For reading the IDE database.
-   `zod`: For validation (optional/future).

## License

ISC
