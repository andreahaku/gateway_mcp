# MCP Gateway

An MCP (Model Context Protocol) Gateway Server that routes and proxies requests to downstream MCP servers on-demand. This gateway minimizes context window usage by exposing only 3 generic tools (`discover`, `dispatch`, `close`) instead of loading all tools from all servers upfront.

## 🎯 Purpose

The MCP Gateway solves the context window saturation problem when working with multiple MCP servers:

- **Without Gateway**: Each MCP server's tools are registered in the client, consuming context tokens for all tool schemas
- **With Gateway**: Only 3 gateway tools are registered, and downstream server tools are loaded on-demand

## 🏗️ Architecture

```
Client (Claude Code/Cursor/etc)
    ↓
MCP Gateway (this repo)
    ↓
Downstream MCP Servers (loaded on-demand)
    - llm-memory
    - code-trm
    - codex
    - code-analysis
```

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/andreahaku/gateway_mcp.git
cd gateway_mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### Usage

#### Development Mode
```bash
npm run dev
```

#### Production Mode
```bash
npm run build
npm start
```

## 🔧 Configuration

The gateway is configured via `src/registry.ts`. Each downstream MCP server needs:

```typescript
{
  id: "server-id",           // Unique identifier
  kind: "stdio" | "ws",      // Connection type
  command: "node",           // Command to run (for stdio)
  args: ["path/to/server"],  // Arguments
  connectTimeoutMs: 8000,    // Connection timeout
  idleTtlMs: 300000,        // Idle time before disconnection (5 min)
}
```

### Configured Servers

The gateway currently includes these servers:

1. **llm-memory** - Persistent memory for LLM tools
2. **code-trm** - TRM-inspired recursive code refinement
3. **codex** - Codex CLI integration
4. **code-analysis** - Deep codebase analysis and pattern detection

## 🛠️ Tools

The gateway exposes 3 tools:

### 1. `discover`
Returns metadata and available tools from a target MCP server without registering them.

```json
{
  "serverId": "llm-memory"
}
```

### 2. `dispatch`
Invokes a tool on a target MCP server. Use `discover` first to see available tools.

```json
{
  "serverId": "llm-memory",
  "tool": "mem_upsert",
  "args": {
    "type": "note",
    "scope": "local",
    "text": "Example note"
  }
}
```

### 3. `close`
Closes and evicts a server connection from the gateway cache.

```json
{
  "serverId": "llm-memory"
}
```

## 📝 Workflow Example

1. **Discover available servers**: Call `discover` with `serverId: "llm-memory"` to see what tools are available
2. **Get tool schemas**: The discovery response includes full tool schemas
3. **Call tools**: Use `dispatch` to invoke specific tools with the correct arguments
4. **Clean up**: Optionally call `close` to disconnect idle servers

## 🔄 Connection Management

- **On-demand loading**: Servers are only started when first accessed
- **Connection caching**: Active connections are reused for performance
- **Automatic cleanup**: Idle connections are closed after `idleTtlMs` (default: 5 minutes)
- **Graceful shutdown**: Properly terminates child processes on close

## 🏛️ Project Structure

```
gateway_mcp/
├── src/
│   ├── gateway.ts    # Main gateway server implementation
│   └── registry.ts   # Server configuration registry
├── dist/             # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── README.md
```

## 📋 Requirements

- Node.js >= 18.0.0
- TypeScript 5.x
- @modelcontextprotocol/sdk ^1.20.0

## 🔐 Security Considerations

- **Whitelist only**: Only servers in the registry can be accessed
- **No dynamic loading**: Server configurations are static (not user-provided)
- **Isolated environments**: Each server runs in its own process
- **Timeout protection**: Connection attempts have configurable timeouts

## 🚧 Limitations

- WebSocket transport is not yet fully implemented (stdio only)
- No built-in authentication/authorization (relies on process isolation)
- No rate limiting (add if exposing publicly)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 📜 License

MIT

## 📚 References

- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/latest)
- [MCP SDK Documentation](https://modelcontextprotocol.io/docs/develop/build-server)
- [Design Document](./gateway_mcp.md) (Italian)

## 💡 Advanced Usage

### Adding Custom Servers

1. Add your server configuration to `src/registry.ts`:

```typescript
{
  id: "my-custom-server",
  kind: "stdio",
  command: "node",
  args: ["/path/to/my/server.js"],
  connectTimeoutMs: 8000,
  idleTtlMs: 300000,
}
```

2. Rebuild the gateway:

```bash
npm run build
```

3. Restart the gateway and use `discover` to verify the server is accessible

### WebSocket Servers (Future)

WebSocket transport will be supported in future versions:

```typescript
{
  id: "remote-server",
  kind: "ws",
  url: "wss://example.com/mcp",
  connectTimeoutMs: 8000,
  idleTtlMs: 600000,
}
```

## 🐛 Troubleshooting

### Server Won't Connect

1. Verify the server path is correct in `src/registry.ts`
2. Ensure the downstream server is built (`npm run build` in its directory)
3. Check server logs for startup errors
4. Try running the server directly to test it works

### Tools Not Found

1. Use `discover` to list available tools
2. Verify the tool name matches exactly
3. Check the downstream server is properly configured

### High Memory Usage

1. Reduce `idleTtlMs` to close connections sooner
2. Manually call `close` for servers you're done with
3. Check for memory leaks in downstream servers
