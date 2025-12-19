import os from "node:os";
import path from "node:path";
export function getCursorStateDbPath() {
    const home = os.homedir();
    const platform = os.platform();
    switch (platform) {
        case "darwin":
            return path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
        case "win32":
            return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Cursor", "User", "globalStorage", "state.vscdb");
        case "linux":
            // Check for XDG_CONFIG_HOME usually, but standard Cursor install is ~/.config/Cursor
            const configDir = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
            return path.join(configDir, "Cursor", "User", "globalStorage", "state.vscdb");
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}
//# sourceMappingURL=platform.js.map