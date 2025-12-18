import Database from "better-sqlite3";
import fs from "node:fs";

export function getDbValue(dbPath: string, key: string): string | null {
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    // ItemTable is the standard VSCode key-value store table
    const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
    const result = stmt.get(key) as { value: string } | undefined;
    db.close();

    return result ? result.value : null;
  } catch (error) {
    console.error(`Failed to read from Cursor DB at ${dbPath}:`, error);
    return null;
  }
}
