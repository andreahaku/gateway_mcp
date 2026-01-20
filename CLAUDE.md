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
                                     ├── Local (stdio)
                                     └── Remote (http/sse)
```

The gateway maintains a connection pool with automatic lifecycle management:
- **On-demand loading**: Downstream servers spawn only when first accessed
- **Connection caching**: Active connections reused via `ensureConnection()`
- **Automatic GC**: Idle connections closed after `idleTtlMs` (default: 5 minutes)
- **Graceful cleanup**: Failed connections cleaned up properly
- **Transport abstraction**: Local (stdio) and remote (http/sse) servers handled uniformly

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
   - `connectHttp()`: Connects to remote servers using Streamable HTTP or SSE transport
     - Tries `StreamableHTTPClientTransport` first (recommended for modern servers)
     - Falls back to `SSEClientTransport` if Streamable HTTP fails
     - Can be forced to use SSE-only via `forceSSE` parameter
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
- `ServerKind` type: `"stdio"`, `"ws"`, `"http"`, or `"sse"`
- `REGISTRY` constant: Array of configured servers loaded at startup

**Configuration file**: `registry.config.json` (root directory, gitignored)
**Example template**: `registry.config.example.json` (committed to repo)

**Note**: Contains Italian comments that should be translated:
- Line 15: "Per server remoti (http, sse, ws)" → "For remote servers (http, sse, ws)"
- Line 17: "Flag opzionale per indicare server remoto" → "Optional flag to indicate remote server"
- Line 21: "tempo dopo cui chiudere se inattivo" → "time after which to close if idle"

Example servers in local config:
- `llm-memory`: Persistent memory MCP (stdio, Node.js)
- `code-trm`: TRM-inspired code refinement (stdio, Node.js)
- `code-trm-python`: TRM for Python projects (stdio, Python/uvx)
- `codex`: Codex CLI integration (stdio, Node.js)
- `code-analysis`: Codebase analysis (stdio, Node.js)
- `code-analysis-python`: Code analysis for Python (stdio, Python/uvx)
- `code-analysis-java`: Code analysis for Java/Spring (stdio, Java)
- `code-trm-java`: TRM for Java projects (stdio, Java)
- `poeditor`: POEditor integration (stdio, Node.js)
- `nuxt-ui-remote`: Example remote HTTP server
- `example-sse-server`: Example remote SSE server

## TypeScript Configuration

The project uses strict TypeScript with:
- **ES modules**: `"type": "module"` in package.json, `"module": "nodenext"`
- **Strict mode**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` enabled
- **Node 18+**: Targets modern Node.js features

**Important**: The codebase uses `import` with `.js` extensions (not `.ts`) because Node ESM requires explicit extensions. TypeScript resolves these correctly during compilation.

## Adding a New Downstream Server

1. Create `registry.config.json` if it doesn't exist (copy from `registry.config.example.json`)

2. Add your server configuration to the JSON array:

**For local Node.js servers (stdio)**:
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

**For Python servers (stdio with uvx)**:
```json
{
  "id": "my-python-server",
  "kind": "stdio",
  "command": "uvx",
  "args": ["my-python-mcp-package"],
  "connectTimeoutMs": 8000,
  "idleTtlMs": 300000
}
```

**For Java servers (stdio with java -jar)**:
```json
{
  "id": "my-java-server",
  "kind": "stdio",
  "command": "java",
  "args": ["-jar", "/absolute/path/to/server/target/server-1.0.0.jar"],
  "connectTimeoutMs": 8000,
  "idleTtlMs": 300000
}
```

**For remote servers (http/sse)**:
```json
{
  "id": "my-remote-server",
  "kind": "http",
  "url": "https://api.example.com/mcp",
  "remote": true,
  "connectTimeoutMs": 10000,
  "idleTtlMs": 600000
}
```

**Configuration options**:
- `id`: Unique identifier for discovery/dispatch (required)
- `kind`: Transport type - `"stdio"`, `"http"`, or `"sse"` (required)
- `command`: Command to spawn the process (required for stdio)
- `args`: Array of command arguments (optional, stdio only)
- `cwd`: Working directory for the process (optional, stdio only)
- `env`: Environment variables object (optional, stdio only)
- `url`: Server URL (required for http/sse)
- `remote`: Boolean flag for remote servers (optional, inferred from kind)
- `connectTimeoutMs`: Connection timeout in ms (optional, default: 8000)
- `idleTtlMs`: Idle time before auto-close in ms (optional, default: 300000)

**Transport types**:
- `stdio`: Local process communication via stdin/stdout
- `http`: Streamable HTTP transport with automatic SSE fallback (recommended for remote)
- `sse`: Server-Sent Events transport (for servers that only support SSE)

3. For local servers, ensure the downstream server is built:
   - **Node.js**: `cd /path/to/server && npm run build`
   - **Python**: Package should be published or available via uvx
   - **Java**: `cd /path/to/server && mvn clean package`

4. Rebuild gateway: `npm run build`

5. The new server is now accessible via `discover` and `dispatch` tools

**Note**: The `registry.config.json` file is gitignored to keep local paths private. Use `registry.config.example.json` as a reference.

### Using the Installation Script

The gateway includes an automated installation script (`install.sh`) that:
- Builds the gateway
- Configures Claude Code
- Discovers and installs downstream MCP servers
- Supports Node.js, Python, and Java servers

**Server types supported**:
- **nodejs**: Builds with `pnpm install && pnpm run build`
- **python**: Uses `uvx` package manager (no build needed)
- **java**: Builds with `mvn clean package -DskipTests`

To add a server to the installation script, edit the `MCP_SERVERS` array in [install.sh](install.sh):

```bash
MCP_SERVERS=(
    "dir_name|repo_url|server_id|entry_point|type"
)
```

Example entries:
```bash
# Node.js server
"my_server|https://github.com/user/my_server|my-server|dist/index.js|nodejs"

# Python server
"my_python_mcp|https://github.com/user/my_python_mcp|my-python|my_python_mcp|python"

# Java server
"my_java_mcp|https://github.com/user/my_java_mcp|my-java|target/my-server-1.0.0.jar|java"

# Local-only (no GitHub URL needed)
"local_server|LOCAL|local-server|dist/index.js|nodejs"
```

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
   - `"Streamable HTTP failed... falling back to SSE"`: Normal behavior for servers that only support SSE

5. **Manual connection test**:
   - For local servers: Run directly with its stdio transport:
     ```bash
     node /path/to/server/dist/index.js
     ```
   - For remote servers: Test the URL is accessible:
     ```bash
     curl -I https://api.example.com/mcp
     ```

## Limitations and Known Issues

- **WebSocket transport not implemented**: The `connectWs()` function in `src/gateway.ts` throws an error. Use `http` or `sse` for remote servers.
- **No tests**: Test suite not yet implemented. The `npm test` command will fail.
- **No rate limiting**: Multiple rapid tool calls can overwhelm downstream servers
- **Local configuration required**: Each installation needs its own `registry.config.json` file with paths/URLs
- **No authentication**: Relies on process isolation for local servers; remote servers handle their own auth
- **Italian comments in code**: Several comments in `src/registry.ts` need translation (lines 15, 17, 21)

## Testing the Gateway

After building, you can test the gateway manually:

```bash
# Start the gateway (it runs on stdio)
node dist/gateway.js

# In an MCP client, use the gateway tools:

# Local server example:
# 1. discover: { "serverId": "llm-memory" }
# 2. dispatch: { "serverId": "llm-memory", "tool": "mem.list", "args": {} }
# 3. close: { "serverId": "llm-memory" }

# Remote server example:
# 1. discover: { "serverId": "nuxt-ui-remote" }
# 2. dispatch: { "serverId": "nuxt-ui-remote", "tool": "get_component", "args": { "name": "Button" } }
# 3. close: { "serverId": "nuxt-ui-remote" }
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
- Italian comments in `src/registry.ts` (lines 15, 17, 21) need translation
- No tests implemented
- No linting configuration (ESLint/Prettier)

## References

- [MCP Specification](https://modelcontextprotocol.io/specification/latest)
- [MCP SDK Documentation](https://modelcontextprotocol.io/docs/develop/build-server)
- Design document: `docs/design.md` (Italian, original design rationale)
