import fs from "node:fs";
function isBunRuntime() {
    // Bun exposes globalThis.Bun and process.versions.bun
    return (typeof globalThis.Bun !== "undefined" ||
        typeof process?.versions?.bun === "string");
}
export async function getDbValue(dbPath, key) {
    if (!fs.existsSync(dbPath)) {
        return null;
    }
    try {
        // Bun runtime (used by opencode) cannot load native Node addons (.node)
        // so we prefer bun:sqlite.
        if (isBunRuntime()) {
            const mod = await import("bun:sqlite");
            const Database = mod.Database;
            const db = new Database(dbPath, { readonly: true });
            const row = db.query("SELECT value FROM ItemTable WHERE key = ?").get(key);
            db.close();
            return row?.value ?? null;
        }
        // Node runtime (optional): use better-sqlite3 if available.
        const mod = await import("better-sqlite3");
        const Database = (mod.default ?? mod);
        const db = new Database(dbPath, { readonly: true });
        const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
        const row = stmt.get(key);
        db.close();
        return row?.value ?? null;
    }
    catch (error) {
        // Avoid noisy stacks during auth; treat as "no token".
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Cursor Auth] Failed to read Cursor DB at ${dbPath}: ${message}`);
        return null;
    }
}
//# sourceMappingURL=db.js.map