import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type ServerKind = "stdio" | "ws";

export type ServerConfig = {
  id: string;
  kind: ServerKind;
  // Per stdio
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  // Per WebSocket
  url?: string;
  // Timeout/limiti
  connectTimeoutMs?: number;
  idleTtlMs?: number; // tempo dopo cui chiudere se inattivo
};

/**
 * Load registry configuration from external file.
 * Falls back to empty array if file doesn't exist or is invalid.
 */
function loadRegistry(): ServerConfig[] {
  try {
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const configPath = join(__dirname, "..", "registry.config.json");
    const configContent = readFileSync(configPath, "utf-8");
    const config = JSON.parse(configContent);

    if (!Array.isArray(config)) {
      console.error("Registry config must be an array");
      return [];
    }

    return config as ServerConfig[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn("Registry config file not found at registry.config.json - using empty registry");
    } else {
      console.error("Failed to load registry config:", error);
    }
    return [];
  }
}

export const REGISTRY: ServerConfig[] = loadRegistry();
