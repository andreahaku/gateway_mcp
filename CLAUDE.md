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

# Note: Tests are not yet implemented
# npm test will exit with an error
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

### Gateway Tool Schemas

The gateway exposes exactly three tools to clients:

**1. `discover`**
- **Input**: `{ serverId: string }` (required)
- **Returns**: JSON containing `{ serverId, tools[], resources[] }` from the target server
- **Purpose**: Get metadata and available tools/resources without registering them in client context

**2. `dispatch`**
- **Input**: `{ serverId: string, tool: string, args?: object }`
- **Returns**: The result from the downstream tool invocation (content array)
- **Purpose**: Invoke a specific tool on a downstream server with a 120-second timeout
- **Note**: `args` is optional and defaults to `{}`

**3. `close`**
- **Input**: `{ serverId: string }` (required)
- **Returns**: Confirmation message
- **Purpose**: Manually close and evict a server connection from the cache

The `discover` tool dynamically lists available server IDs in its schema description.

## Key Files and Their Roles

### `src/gateway.ts`

Main server implementation organized into three functional areas:

**1. Logging System** (top of file): Environment-controlled logging via `GATEWAY_LOG_LEVEL`
   - `debug`: Verbose connection and operation logs
   - `info`: Startup and basic operational info (default)
   - `silent`: No logs

**2. Connection Management** (middle section):
   - `connectStdio()`: Spawns stdio-based MCP server using `StdioClientTransport`
   - `connectWs()`: Stub for WebSocket (throws error, not implemented)
   - `ensureConnection()`: Connection pool with lazy loading and error cleanup
   - `scheduleGc()`: 30-second interval to close idle connections
   - `withTimeout()`: Wraps promises with timeout protection
   - `safeCloseClient()`: Safe client shutdown with method validation

**3. Tool Handlers** (bottom section):
   - `discover`: Calls `client.listTools()` and `client.listResources()` on target
   - `dispatch`: Proxies tool call with 120-second timeout protection
   - `close`: Manually evicts connection from pool

### `src/registry.ts`

Loads downstream server configuration from `registry.config.json` (gitignored). This file dynamically reads the JSON configuration at runtime and exports it as the `REGISTRY` constant.

The registry configuration is kept in a separate JSON file to avoid committing local absolute paths to the repository.

**Key exports**:
- `ServerConfig` type: TypeScript interface for server configuration
- `ServerKind` type: Either `"stdio"` or `"ws"`
- `REGISTRY` constant: Array of configured servers loaded at startup

**Configuration file**: `registry.config.json` (root directory, gitignored)
**Example template**: `registry.config.example.json` (committed to repo)

**Note**: Contains one Italian comment at line 19 that should be translated: "tempo dopo cui chiudere se inattivo" → "time after which to close if idle"

Example servers in local config:
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

## Debugging Connection Issues

When a downstream server fails to connect or behaves unexpectedly:

1. **Enable debug logging**:
   ```bash
   GATEWAY_LOG_LEVEL=debug npm start
   ```

2. **Check stderr output**: The gateway pipes stderr from downstream servers with `stderr: "pipe"` in `StdioClientTransport`. Connection errors and server logs appear in the gateway's stderr.

3. **Verify server configuration**:
   - Ensure `command` path is absolute and correct
   - Verify the downstream server is built (`npm run build` in its directory)
   - Test the server standalone before adding to gateway

4. **Common error patterns**:
   - `"connection failed"`: Server failed to start (check command/args/paths)
   - `"listTools failed"`: Server started but doesn't implement MCP protocol correctly
   - `"timeout"`: Server started but took >8 seconds to connect (increase `connectTimeoutMs`)
   - `"tool call timed out"`: Tool execution exceeded 120 seconds (expected for long-running operations)

5. **Manual connection test**: Run the downstream server directly with its stdio transport to verify it works:
   ```bash
   node /path/to/server/dist/index.js
   ```

## Limitations and Known Issues

- **WebSocket transport not implemented**: Only `stdio` kind works. The `connectWs()` function in `src/gateway.ts:83-88` throws an error.
- **No tests**: Test suite not yet implemented. The `npm test` command will fail.
- **No rate limiting**: Multiple rapid tool calls can overwhelm downstream servers
- **Local configuration required**: Each installation needs its own `registry.config.json` file with absolute paths
- **No authentication**: Relies on process isolation for security
- **Italian comment in code**: One comment in `src/registry.ts:19` needs translation

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

The codebase maintains high TypeScript standards:
- **Strict TypeScript**: All strict checks enabled, no `any` types in public interfaces
- **Type safety**: Uses `StdioTransportConfig` interface instead of `any`
- **Error handling**: Defensive patterns throughout (try-catch, timeouts, safe cleanup)
- **Timeout protection**: 120-second timeout on tool calls to prevent hanging
- **Safe shutdown**: `safeCloseClient()` validates methods before calling
- **Logging system**: Configurable via `GATEWAY_LOG_LEVEL` environment variable

Recent improvements (commit 1c48134):
- Removed unused imports
- Replaced `any` types with proper interfaces
- Added timeout protection for tool calls
- Implemented safe client closing
- Mostly translated Italian comments to English (one remains)

**Known code quality issues**:
- One Italian comment in `src/registry.ts:19` needs translation
- No tests implemented
- No linting configuration (ESLint/Prettier)

## References

- [MCP Specification](https://modelcontextprotocol.io/specification/latest)
- [MCP SDK Documentation](https://modelcontextprotocol.io/docs/develop/build-server)
- Design document: `docs/design.md` (Italian, original design rationale)
