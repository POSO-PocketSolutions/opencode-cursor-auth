import fs from "node:fs";

function isBunRuntime(): boolean {
  // Bun exposes globalThis.Bun and process.versions.bun
  return (
    typeof (globalThis as any).Bun !== "undefined" ||
    typeof (process as any)?.versions?.bun === "string"
  );
}

export async function getDbValue(dbPath: string, key: string): Promise<string | null> {
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    // Bun runtime (used by opencode) cannot load native Node addons (.node)
    // so we prefer bun:sqlite.
    if (isBunRuntime()) {
      const mod = await import("bun:sqlite");
      const Database = (mod as any).Database as any;
      const db = new Database(dbPath, { readonly: true });
      const row = db.query("SELECT value FROM ItemTable WHERE key = ?").get(key) as
        | { value?: string }
        | undefined;
      db.close();
      return row?.value ?? null;
    }

    // Node runtime (optional): use better-sqlite3 if available.
    const mod = await import("better-sqlite3");
    const Database = ((mod as any).default ?? mod) as any;
    const db = new Database(dbPath, { readonly: true });
    const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
    const row = stmt.get(key) as { value?: string } | undefined;
    db.close();
    return row?.value ?? null;
  } catch (error) {
    // Avoid noisy stacks during auth; treat as "no token".
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Cursor Auth] Failed to read Cursor DB at ${dbPath}: ${message}`);
    return null;
  }
}
