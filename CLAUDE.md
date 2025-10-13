# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **MCP Gateway Server** that routes and proxies requests to downstream MCP servers on-demand. The gateway solves context window saturation by exposing only 3 generic tools (`discover`, `dispatch`, `close`) instead of loading all tools from all downstream servers upfront.

**Core Problem Solved**: When multiple MCP servers register with a client, each server's tools consume context tokens. The gateway acts as a single entry point, loading downstream servers only when requested.

## Build and Development Commands

```bash
# Build TypeScript to JavaScript
npm run build

# Run in production (requires build first)
npm start

# Run in development (no build needed, uses tsx)
npm run dev
```

## Architecture Overview

### Request Flow

```
MCP Client → Gateway (3 tools) → Downstream Server (on-demand) → Tool Execution
```

The gateway maintains a connection pool with automatic lifecycle management:
- **On-demand loading**: Downstream servers spawn only when first accessed
- **Connection caching**: Active connections reused via `ensureConnection()`
- **Automatic GC**: Idle connections closed after `idleTtlMs` (default: 5 minutes)
- **Graceful cleanup**: Failed connections cleaned up properly

### Two-Step Tool Pattern

1. **Discover**: Client calls `discover(serverId)` to get tool schemas from downstream server
2. **Dispatch**: Client calls `dispatch(serverId, tool, args)` to invoke the tool

This pattern keeps tool schemas out of the client's context until needed.

## Key Files and Their Roles

### `src/gateway.ts` (388 lines)

Main server implementation with three sections:

1. **Logging System** (lines 12-32): Environment-controlled logging via `GATEWAY_LOG_LEVEL`
   - `debug`: Verbose connection and operation logs
   - `info`: Startup and basic operational info (default)
   - `silent`: No logs

2. **Connection Management** (lines 52-163):
   - `connectStdio()`: Spawns stdio-based MCP server using `StdioClientTransport`
   - `ensureConnection()`: Connection pool with lazy loading and error cleanup
   - `scheduleGc()`: 30-second interval to close idle connections

3. **Tool Handlers** (lines 266-373):
   - `discover`: Calls `client.listTools()` and `client.listResources()` on target
   - `dispatch`: Proxies tool call with 120-second timeout protection
   - `close`: Manually evicts connection from pool

### `src/registry.ts` (~50 lines)

Loads downstream server configuration from `registry.config.json` (gitignored). This file dynamically reads the JSON configuration at runtime and exports it as the `REGISTRY` constant.

The registry configuration is kept in a separate JSON file to avoid committing local absolute paths to the repository.

**Configuration file**: `registry.config.json` (root directory, gitignored)
**Example template**: `registry.config.example.json` (committed to repo)

Current servers (in your local config):
- `llm-memory`: Persistent memory MCP
- `code-trm`: TRM-inspired code refinement
- `codex`: Codex CLI integration
- `code-analysis`: Codebase analysis

## TypeScript Configuration

The project uses strict TypeScript with:
- **ES modules**: `"type": "module"` in package.json, `"module": "nodenext"`
- **Strict mode**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` enabled
- **Node 18+**: Targets modern Node.js features

**Important**: The codebase uses `import` with `.js` extensions (not `.ts`) because Node ESM requires explicit extensions. TypeScript resolves these correctly during compilation.

## Adding a New Downstream Server

1. Create `registry.config.json` if it doesn't exist (copy from `registry.config.example.json`)

2. Add your server configuration to the JSON array:

```json
{
  "id": "my-server",
  "kind": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/server/dist/index.js"],
  "connectTimeoutMs": 8000,
  "idleTtlMs": 300000
}
```

**Configuration options**:
- `id`: Unique identifier for discovery/dispatch (required)
- `kind`: Transport type - only `"stdio"` supported (required)
- `command`: Command to spawn the process (required)
- `args`: Array of command arguments (optional)
- `cwd`: Working directory for the process (optional)
- `env`: Environment variables object (optional)
- `connectTimeoutMs`: Connection timeout in ms (optional, default: 8000)
- `idleTtlMs`: Idle time before auto-close in ms (optional, default: 300000)

3. Ensure the downstream server is built: `cd /path/to/server && npm run build`

4. Rebuild gateway: `npm run build`

5. The new server is now accessible via `discover` and `dispatch` tools

**Note**: The `registry.config.json` file is gitignored to keep local paths private. Use `registry.config.example.json` as a reference.

## Error Handling Patterns

The gateway uses defensive patterns throughout:

- **`safeCloseClient()`**: Validates `client.close()` method exists before calling
- **`withTimeout()`**: Wraps promises with timeout to prevent hanging
- **Try-catch in `ensureConnection()`**: Cleans up partial connections on failure
- **Error response format**: Returns `{ content: [{ type: "text", text: "Error: ..." }], isError: true }`

## Environment Variables

- `GATEWAY_LOG_LEVEL`: Controls logging verbosity
  - `debug`: Log all operations
  - `info`: Log startup and errors (default)
  - `silent`: No logs

## Limitations and Known Issues

- **WebSocket transport not implemented**: Only `stdio` kind works. The `connectWs()` function throws an error.
- **No rate limiting**: Multiple rapid tool calls can overwhelm downstream servers
- **Local configuration required**: Each installation needs its own `registry.config.json` file with absolute paths
- **No authentication**: Relies on process isolation for security

## Testing the Gateway

After building, you can test the gateway manually:

```bash
# Start the gateway (it runs on stdio)
node dist/gateway.js

# In an MCP client, use the gateway tools:
# 1. discover: { "serverId": "llm-memory" }
# 2. dispatch: { "serverId": "llm-memory", "tool": "mem.list", "args": {} }
# 3. close: { "serverId": "llm-memory" }
```

## Code Quality Standards

Recent improvements (commit 1c48134) addressed:
- Removed unused imports
- Replaced `any` types with proper interfaces (`StdioTransportConfig`)
- Added timeout protection to prevent hanging tool calls
- Implemented safe client closing with method validation
- Translated all Italian comments to English
- Added configurable logging system

**Current quality score**: 9.5/10

## References

- [MCP Specification](https://modelcontextprotocol.io/specification/latest)
- [MCP SDK Documentation](https://modelcontextprotocol.io/docs/develop/build-server)
- Design document: `gateway_mcp.md` (Italian)
