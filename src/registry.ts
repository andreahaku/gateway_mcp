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

export const REGISTRY: ServerConfig[] = [
  {
    id: "llm-memory",
    kind: "stdio",
    command: "node",
    args: ["/Users/administrator/Development/Claude/llm_memory_mcp/dist/src/index.js"],
    connectTimeoutMs: 8000,
    idleTtlMs: 5 * 60_000,
  },
  {
    id: "code-trm",
    kind: "stdio",
    command: "node",
    args: ["/Users/administrator/Development/Claude/code_trm_mcp/dist/server.js"],
    connectTimeoutMs: 8000,
    idleTtlMs: 5 * 60_000,
  },
  {
    id: "codex",
    kind: "stdio",
    command: "node",
    args: ["/Users/administrator/Development/Claude/codex_mcp/dist/index.js"],
    connectTimeoutMs: 8000,
    idleTtlMs: 5 * 60_000,
  },
  {
    id: "code-analysis",
    kind: "stdio",
    command: "node",
    args: ["/Users/administrator/Development/Claude/code_context/code-analysis-context-mcp/dist/index.js"],
    connectTimeoutMs: 8000,
    idleTtlMs: 5 * 60_000,
  },
];
