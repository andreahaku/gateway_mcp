#!/usr/bin/env node
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import WebSocket from "ws";
import { REGISTRY, type ServerConfig } from "./registry.js";

type Connected = {
  cfg: ServerConfig;
  client: Client;
  lastUsed: number;
  idleTtlMs: number;
  // child process handle (null when using transports that manage their own process)
  child: ChildProcess | null;
};

const connected = new Map<string, Connected>();

async function connectStdio(cfg: ServerConfig): Promise<{ client: Client; child: ChildProcess | null }> {
  console.error(`[gateway] Connecting to stdio server: ${cfg.command} ${cfg.args?.join(' ')}`);

  // StdioClientTransport spawns its own process, so we don't need to spawn manually
  const transportConfig: any = {
    command: assert(cfg.command, "command required"),
    args: cfg.args ?? [],
    stderr: "pipe"
  };

  if (cfg.env) {
    transportConfig.env = cfg.env;
  }

  const transport = new StdioClientTransport(transportConfig);

  const client = new Client({
    name: "mcp-gateway-client",
    version: "1.0.0",
  }, {
    capabilities: {}
  });

  console.error(`[gateway] Connecting client to transport...`);
  await client.connect(transport);
  console.error(`[gateway] Client connected successfully`);

  // We don't have direct access to the child process when using StdioClientTransport
  return { client, child: null };
}

async function connectWs(cfg: ServerConfig): Promise<Client> {
  const ws = new WebSocket(assert(cfg.url, "url required for ws"));

  await new Promise<void>((res, rej) => {
    const to = setTimeout(
      () => rej(new Error("WS connect timeout")),
      cfg.connectTimeoutMs ?? 8000
    );
    ws.on("open", () => {
      clearTimeout(to);
      res();
    });
    ws.on("error", rej);
  });

  // For WebSocket, you'd need a WebSocketClientTransport
  // This is a placeholder - actual implementation depends on SDK support
  throw new Error("WebSocket transport not yet implemented");
}

function assert<T>(v: T | undefined, msg: string): T {
  if (v == null) throw new Error(msg);
  return v;
}

function findCfg(serverId: string): ServerConfig {
  const cfg = REGISTRY.find((s) => s.id === serverId);
  if (!cfg) throw new Error(`Unknown serverId: ${serverId}`);
  return cfg;
}

async function ensureConnection(serverId: string): Promise<Connected> {
  const now = Date.now();
  const existing = connected.get(serverId);
  if (existing) {
    existing.lastUsed = now;
    return existing;
  }

  const cfg = findCfg(serverId);
  let client: Client;
  let child: ChildProcess | null = null;

  if (cfg.kind === "ws") {
    client = await connectWs(cfg);
  } else {
    const result = await connectStdio(cfg);
    client = result.client;
    child = result.child;
  }

  const conn: Connected = {
    cfg,
    client,
    lastUsed: now,
    idleTtlMs: cfg.idleTtlMs ?? 5 * 60_000,
    child,
  };

  connected.set(serverId, conn);
  return conn;
}

function scheduleGc() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, c] of connected) {
      if (now - c.lastUsed > c.idleTtlMs) {
        // chiudi
        try {
          c.client.close();
        } catch {}
        try {
          c.child?.kill("SIGTERM");
        } catch {}
        connected.delete(id);
      }
    }
  }, 30_000).unref();
}

const discoverInputSchema = z.object({
  serverId: z.string().describe("The ID of the target MCP server to discover"),
});

const dispatchInputSchema = z.object({
  serverId: z.string().describe("The ID of the target MCP server"),
  tool: z.string().describe("The name of the tool to invoke"),
  args: z.record(z.unknown()).optional().describe("Arguments to pass to the tool"),
});

const closeInputSchema = z.object({
  serverId: z.string().describe("The ID of the target MCP server to close"),
});

async function main() {
  const server = new Server(
    {
      name: "mcp-gateway",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Tool: discover -> ritorna metadati e tool summary del server target
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "discover",
          description: "Return metadata and tools of a target MCP server without registering them in the client. Call this first to see what tools are available on a server.",
          inputSchema: {
            type: "object",
            properties: {
              serverId: {
                type: "string",
                description: "The ID of the target MCP server. Available servers: " + REGISTRY.map(s => s.id).join(", "),
              },
            },
            required: ["serverId"],
          },
        },
        {
          name: "dispatch",
          description: "Call a tool on a target MCP server. Use discover first to see available tools and their schemas.",
          inputSchema: {
            type: "object",
            properties: {
              serverId: {
                type: "string",
                description: "The ID of the target MCP server",
              },
              tool: {
                type: "string",
                description: "The name of the tool to invoke",
              },
              args: {
                type: "object",
                description: "Arguments to pass to the tool (as a JSON object)",
              },
            },
            required: ["serverId", "tool"],
          },
        },
        {
          name: "close",
          description: "Close and evict a target MCP server connection from the gateway cache.",
          inputSchema: {
            type: "object",
            properties: {
              serverId: {
                type: "string",
                description: "The ID of the target MCP server to close",
              },
            },
            required: ["serverId"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "discover") {
        const { serverId } = discoverInputSchema.parse(args);
        console.error(`[gateway] Discovering serverId: ${serverId}`);

        let conn;
        try {
          conn = await ensureConnection(serverId);
          console.error(`[gateway] Connection established for ${serverId}`);
        } catch (err: any) {
          console.error(`[gateway] Connection failed for ${serverId}:`, err.message);
          throw err;
        }

        // Chiede al server target la lista tool/resources
        let toolsList;
        try {
          console.error(`[gateway] Calling listTools() on ${serverId}...`);
          toolsList = await conn.client.listTools();
          console.error(`[gateway] listTools returned ${toolsList.tools?.length ?? 0} tools`);
        } catch (err: any) {
          console.error(`[gateway] listTools failed for ${serverId}:`, err.message, err.code);
          throw err;
        }

        let resourcesList;
        try {
          console.error(`[gateway] Calling listResources() on ${serverId}...`);
          resourcesList = await conn.client.listResources?.() ?? { resources: [] };
          console.error(`[gateway] listResources returned ${resourcesList.resources?.length ?? 0} resources`);
        } catch (err: any) {
          console.error(`[gateway] listResources failed for ${serverId}:`, err.message);
          resourcesList = { resources: [] };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  serverId,
                  tools: toolsList.tools,
                  resources: resourcesList.resources,
                },
                null,
                2
              ),
            },
          ],
        };
      } else if (name === "dispatch") {
        const { serverId, tool, args: toolArgs } = dispatchInputSchema.parse(args);
        const conn = await ensureConnection(serverId);

        // Esegue direttamente la call tool → response content del server remoto
        const result = await conn.client.callTool({ name: tool, arguments: toolArgs ?? {} });

        return {
          content: Array.isArray(result.content)
            ? result.content
            : [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } else if (name === "close") {
        const { serverId } = closeInputSchema.parse(args);
        const c = connected.get(serverId);

        if (!c) {
          return {
            content: [
              { type: "text", text: `serverId ${serverId} not connected` },
            ],
          };
        }

        try {
          c.client.close();
        } catch {}
        try {
          c.child?.kill("SIGTERM");
        } catch {}
        connected.delete(serverId);

        return {
          content: [{ type: "text", text: `serverId ${serverId} closed` }],
        };
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  scheduleGc();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("MCP Gateway Server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
