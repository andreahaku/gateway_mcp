# MCP Gateway

A lightweight MCP (Model Context Protocol) Gateway that routes requests to downstream MCP servers on-demand, solving context window saturation by exposing only 3 generic tools instead of loading all tools from all servers upfront.

## Problem Solved

**Without Gateway**: Each MCP server registers its tools with the client, consuming context tokens for every tool schema.

**With Gateway**: Only 3 gateway tools are registered (`discover`, `dispatch`, `close`). Downstream server tools load on-demand.

## Architecture

```
Client (Claude Code/Cursor/etc)
    ↓
MCP Gateway (3 tools only)
    ↓
Downstream Servers (loaded on-demand)
    ├── Local (stdio)
    │   - Node.js: llm-memory, code-trm, codex, code-analysis
    │   - Python: code-trm-python, code-analysis-python
    │   - Java: code-analysis-java, code-trm-java
    └── Remote (http/sse)
        - nuxt-ui-remote
        - example-sse-server
```

## Automated Installation (Recommended)

The easiest way to install the gateway and optional downstream MCP servers:

```bash
./install.sh
```

This script will:
1. Build the gateway
2. Configure Claude Code to use the gateway
3. Check for available MCP servers in the parent directory
4. Offer to clone, install, and configure any missing servers:
   - **Node.js**: llm_memory_mcp, codex_mcp, code-analysis-context-mcp, code_trm_mcp, poeditor_mcp
   - **Python**: code_trm_python_mcp, code-analysis-context-python-mcp
   - **Java**: code-analisys-context-java-spring-mcp, code_trm_java_mcp

After installation, restart Claude Code to load the gateway.

### Uninstall

To remove the gateway from Claude Code configuration:

```bash
./uninstall.sh
```

**Note**: This only removes the gateway from Claude Code config. The gateway directory and downstream servers remain untouched.

## Manual Installation

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in production
npm start

# Or run in development mode
npm run dev
```

## Configuration

Configure downstream servers in `registry.config.json` (not committed to git):

### Local Servers (stdio)

**Node.js Server**:
```json
{
  "id": "server-id",
  "kind": "stdio",
  "command": "node",
  "args": ["/path/to/server/dist/index.js"],
  "connectTimeoutMs": 8000,
  "idleTtlMs": 300000
}
```

**Python Server (via uvx)**:
```json
{
  "id": "python-server",
  "kind": "stdio",
  "command": "uvx",
  "args": ["python-mcp-package"],
  "connectTimeoutMs": 8000,
  "idleTtlMs": 300000
}
```

**Java Server**:
```json
{
  "id": "java-server",
  "kind": "stdio",
  "command": "java",
  "args": ["-jar", "/path/to/server/target/server-1.0.0.jar"],
  "connectTimeoutMs": 8000,
  "idleTtlMs": 300000
}
```

### Remote Server (HTTP/SSE)

The gateway supports remote MCP servers via HTTP (Streamable HTTP with SSE fallback) and SSE transports:

```json
{
  "id": "nuxt-ui-remote",
  "kind": "http",
  "url": "https://ui.nuxt.com/mcp",
  "remote": true,
  "connectTimeoutMs": 10000,
  "idleTtlMs": 600000
}
```

```json
{
  "id": "example-sse-server",
  "kind": "sse",
  "url": "https://example.com/mcp/sse",
  "remote": true,
  "connectTimeoutMs": 10000,
  "idleTtlMs": 300000
}
```

**Transport types**:
- `stdio`: Local process communication (default)
- `http`: Streamable HTTP transport with automatic SSE fallback (recommended for remote)
- `sse`: Server-Sent Events transport (for servers that only support SSE)

**First time setup**: Copy `registry.config.example.json` to `registry.config.json` and update paths/URLs to match your environment.

## Gateway Tools

### 1. `discover(serverId)`
Returns metadata and tool schemas from a target server without registering them.

### 2. `dispatch(serverId, tool, args)`
Invokes a tool on a target server. Use `discover` first to see available tools.

### 3. `close(serverId)`
Manually closes a server connection and evicts it from the cache.

## Usage Example

### Local Server (stdio)

```typescript
// 1. Discover what tools are available
discover({ serverId: "llm-memory" })

// 2. Call a tool with the correct arguments
dispatch({
  serverId: "llm-memory",
  tool: "mem.upsert",
  args: {
    type: "note",
    scope: "local",
    text: "My note"
  }
})

// 3. Optionally close the connection when done
close({ serverId: "llm-memory" })
```

### Remote Server (HTTP/SSE)

```typescript
// 1. Discover tools from a remote MCP server
discover({ serverId: "nuxt-ui-remote" })

// 2. Call a tool on the remote server
dispatch({
  serverId: "nuxt-ui-remote",
  tool: "get_component",
  args: {
    name: "Button"
  }
})

// 3. Close the remote connection when done
close({ serverId: "nuxt-ui-remote" })
```

Remote servers work identically to local servers from the client's perspective. The gateway handles the transport differences internally.

## Connection Management

- **On-demand loading**: Servers spawn only when first accessed
- **Connection caching**: Active connections reused for performance
- **Automatic cleanup**: Idle connections close after 5 minutes
- **Timeout protection**: Tool calls timeout after 120 seconds

## Environment Variables

- `GATEWAY_LOG_LEVEL`: Controls logging verbosity
  - `debug`: Verbose connection and operation logs
  - `info`: Startup and errors only (default)
  - `silent`: No logs

## Adding a Custom Server

1. Create `registry.config.json` if it doesn't exist:
   ```bash
   cp registry.config.example.json registry.config.json
   ```

2. Add your server configuration to the JSON array:

   **Node.js server**:
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

   **Python server**:
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

   **Java server**:
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

   **Remote server**:
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

3. For local servers, ensure the downstream server is built:
   - **Node.js**: `cd /path/to/server && npm run build`
   - **Python**: Package should be available via uvx
   - **Java**: `cd /path/to/server && mvn clean package`

4. Rebuild and restart the gateway:
   ```bash
   npm run build
   npm start
   ```

## Client Configuration

Add to your MCP client configuration (e.g., Claude Code, Cursor):

```json
{
  "mcpServers": {
    "gateway": {
      "command": "node",
      "args": ["/path/to/gateway_mcp/dist/gateway.js"]
    }
  }
}
```

See `mcp-config-example.json` for a complete example.

## Requirements

- Node.js >= 18.0.0
- TypeScript 5.x
- @modelcontextprotocol/sdk ^1.20.0

## Limitations

- **WebSocket not implemented**: WebSocket transport is stubbed but not functional
- **Local configuration required**: Each installation needs its own `registry.config.json` with paths/URLs
- **No rate limiting**: Add if exposing publicly
- **No authentication**: Relies on process isolation for local servers; remote servers may require their own auth

## Documentation

- [Design Document](./docs/design.md) (Italian) - Original design rationale and architecture
- [CLAUDE.md](./CLAUDE.md) - Development guide for Claude Code
- [MCP Specification](https://modelcontextprotocol.io/specification/latest)
- [MCP SDK Documentation](https://modelcontextprotocol.io/docs/develop/build-server)

## Troubleshooting

**Local server won't connect**: Verify paths in `registry.config.json` are absolute and ensure the downstream server is built.

**Remote server won't connect**: Check the URL is correct and accessible. The gateway tries Streamable HTTP first, then falls back to SSE for `http` kind servers.

**"Registry config file not found"**: Copy `registry.config.example.json` to `registry.config.json` and configure your servers.

**Tools not found**: Use `discover` to list available tools and verify the tool name matches exactly.

**High memory usage**: Reduce `idleTtlMs` or manually `close` servers when done.

**Remote server timeout**: Increase `connectTimeoutMs` for remote servers (10000ms+ recommended for network latency).

## License

MIT
