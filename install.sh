#!/usr/bin/env bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory (where gateway_mcp is located)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}=== MCP Gateway Installation Script ===${NC}\n"

# Check if Claude CLI is available
CLAUDE_CMD=""
USE_DIRECT_CONFIG=false

# Try common locations for Claude CLI
if [[ -f "$HOME/.claude/local/claude" ]]; then
    CLAUDE_CMD="$HOME/.claude/local/claude --dangerously-skip-permissions"
    echo -e "${GREEN}✓ Claude CLI found at ~/.claude/local/claude${NC}"
elif command -v claude &> /dev/null; then
    CLAUDE_CMD="claude"
    echo -e "${GREEN}✓ Claude CLI found in PATH${NC}"
else
    echo -e "${YELLOW}⚠ Claude CLI not found, will update config file directly${NC}"
    USE_DIRECT_CONFIG=true
fi

# Step 1: Build the gateway if not already built
echo -e "\n${BLUE}Step 1: Building MCP Gateway...${NC}"
cd "$SCRIPT_DIR"

if [[ ! -d "dist" ]]; then
    echo "Building gateway for the first time..."
    pnpm install
    pnpm run build
else
    echo "Gateway already built. Rebuilding to ensure latest version..."
    pnpm run build
fi

echo -e "${GREEN}✓ Gateway built successfully${NC}"

# Step 2: Add gateway to Claude Code using CLI
echo -e "\n${BLUE}Step 2: Configuring Claude Code...${NC}"

GATEWAY_DIST_PATH="$SCRIPT_DIR/dist/gateway.js"

echo "Adding gateway MCP server to Claude Code..."

if [[ "$USE_DIRECT_CONFIG" == true ]]; then
    # Direct config file manipulation
    CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

    # Create config directory if it doesn't exist
    mkdir -p "$(dirname "$CLAUDE_CONFIG")"

    # Check if config exists, if not create it
    if [[ ! -f "$CLAUDE_CONFIG" ]]; then
        echo '{"mcpServers":{}}' > "$CLAUDE_CONFIG"
        echo "Created new Claude Code configuration file"
    fi

    # Use Node.js to safely update the JSON config
    node <<EOF
const fs = require('fs');
const configPath = '$CLAUDE_CONFIG';
const gatewayPath = '$GATEWAY_DIST_PATH';

let config = {};
try {
    const content = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(content);
} catch (err) {
    config = { mcpServers: {} };
}

if (!config.mcpServers) {
    config.mcpServers = {};
}

config.mcpServers.gateway = {
    command: "node",
    args: [gatewayPath]
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Gateway added to Claude Code configuration');
EOF
    echo -e "${GREEN}✓ Gateway configured in Claude Code${NC}"
else
    # Use Claude CLI
    if $CLAUDE_CMD mcp add --transport stdio gateway -- node "$GATEWAY_DIST_PATH" 2>/dev/null; then
        echo -e "${GREEN}✓ Gateway configured in Claude Code${NC}"
    else
        echo -e "${YELLOW}Note: Gateway may already be configured${NC}"
    fi
fi

# Step 3: Create or update registry.config.json
echo -e "\n${BLUE}Step 3: Setting up gateway registry...${NC}"

REGISTRY_CONFIG="$SCRIPT_DIR/registry.config.json"

if [[ ! -f "$REGISTRY_CONFIG" ]]; then
    echo "[]" > "$REGISTRY_CONFIG"
    echo "Created new registry.config.json"
else
    echo "Using existing registry.config.json"
fi

# MCP Server definitions (format: dir_name|repo_url|server_id|entry_point|type)
# type: nodejs, python, or java
MCP_SERVERS=(
    "llm_memory_mcp|https://github.com/andreahaku/llm_memory_mcp|llm-memory|dist/src/index.js|nodejs"
    "codex_mcp|https://github.com/andreahaku/codex_mcp|codex|dist/index.js|nodejs"
    "code-analysis-context-mcp|https://github.com/andreahaku/code-analysis-context-mcp|code-analysis|dist/index.js|nodejs"
    "code_trm_mcp|https://github.com/andreahaku/code_trm_mcp|code-trm|dist/server.js|nodejs"
    "code_trm_python_mcp|https://github.com/andreahaku/code_trm_python_mcp|code-trm-python|code_trm_python_mcp|python"
    "code-analysis-context-python-mcp|https://github.com/andreahaku/code-analysis-context-python-mcp|code-analysis-python|code-analysis-context-python-mcp|python"
    "poeditor_mcp|https://github.com/andreahaku/poeditor_mcp|poeditor|dist/index.js|nodejs"
    "code-analysis-context-java-spring-mcp|LOCAL|code-analysis-java|target/code-analysis-context-java-spring-mcp-1.0.0.jar|java"
    "code_trm_java_mcp|LOCAL|code-trm-java|target/code-trm-java-mcp-0.1.0.jar|java"
)

# Function to add server to registry
add_to_registry() {
    local server_id=$1
    local server_path=$2
    local entry_point=$3
    local server_type=$4

    node <<EOF
const fs = require('fs');
const registryPath = '$REGISTRY_CONFIG';
const serverId = '$server_id';
const serverPath = '$server_path';
const entryPoint = '$entry_point';
const serverType = '$server_type';

let registry = [];
try {
    const content = fs.readFileSync(registryPath, 'utf8');
    registry = JSON.parse(content);
} catch (err) {
    registry = [];
}

// Check if server already exists
const existingIndex = registry.findIndex(s => s.id === serverId);

let newEntry;
if (serverType === 'python') {
    // Python MCP servers use uvx
    newEntry = {
        id: serverId,
        kind: "stdio",
        command: "uvx",
        args: [entryPoint],
        connectTimeoutMs: 8000,
        idleTtlMs: 300000
    };
} else if (serverType === 'java') {
    // Java MCP servers use java -jar
    newEntry = {
        id: serverId,
        kind: "stdio",
        command: "java",
        args: ["-jar", serverPath + '/' + entryPoint],
        connectTimeoutMs: 8000,
        idleTtlMs: 300000
    };
} else {
    // Node.js MCP servers
    newEntry = {
        id: serverId,
        kind: "stdio",
        command: "node",
        args: [serverPath + '/' + entryPoint],
        connectTimeoutMs: 8000,
        idleTtlMs: 300000
    };
}

if (existingIndex >= 0) {
    registry[existingIndex] = newEntry;
    console.log('Updated existing entry for ' + serverId);
} else {
    registry.push(newEntry);
    console.log('Added new entry for ' + serverId);
}

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
EOF
}

# Step 4: Check and install MCP servers
echo -e "\n${BLUE}Step 4: Checking for MCP servers...${NC}\n"

for server_def in "${MCP_SERVERS[@]}"; do
    IFS='|' read -r dir_name repo_url server_id entry_point server_type <<< "$server_def"

    SERVER_PATH="$PARENT_DIR/$dir_name"

    if [[ -d "$SERVER_PATH" ]]; then
        echo -e "${GREEN}✓ Found:${NC} $dir_name"

        if [[ "$server_type" == "python" ]]; then
            # Python MCP - just add to registry, no build needed
            echo "  Python MCP server, adding to registry..."
            add_to_registry "$server_id" "$SERVER_PATH" "$entry_point" "$server_type"
        elif [[ "$server_type" == "java" ]]; then
            # Java MCP - check if JAR exists
            if [[ -f "$SERVER_PATH/$entry_point" ]]; then
                echo "  Already built, adding to registry..."
            else
                echo "  Not built yet, building Maven project..."
                cd "$SERVER_PATH"
                mvn clean package -DskipTests
                echo -e "  ${GREEN}Built successfully${NC}"
            fi

            # Add to registry
            add_to_registry "$server_id" "$SERVER_PATH" "$entry_point" "$server_type"
        else
            # Node.js MCP - check if built
            if [[ -d "$SERVER_PATH/dist" ]]; then
                echo "  Already built, adding to registry..."
            else
                echo "  Not built yet, building now..."
                cd "$SERVER_PATH"
                pnpm install
                pnpm run build
                echo -e "  ${GREEN}Built successfully${NC}"
            fi

            # Add to registry
            add_to_registry "$server_id" "$SERVER_PATH" "$entry_point" "$server_type"
        fi

    else
        echo -e "${YELLOW}✗ Not found:${NC} $dir_name"
        echo -e "  Repository: $repo_url"
        echo -e "  Type: $server_type"

        read -p "  Do you want to install it? (y/n): " -n 1 -r
        echo

        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "  Cloning repository..."
            cd "$PARENT_DIR"
            git clone "$repo_url" "$dir_name"

            if [[ "$server_type" == "python" ]]; then
                echo "  Python MCP server - no build needed"
            elif [[ "$server_type" == "java" ]]; then
                echo "  Building Maven project..."
                cd "$SERVER_PATH"
                mvn clean package -DskipTests
            else
                echo "  Installing dependencies..."
                cd "$SERVER_PATH"
                pnpm install

                echo "  Building..."
                pnpm run build
            fi

            echo -e "  ${GREEN}✓ Installed successfully${NC}"

            # Add to registry
            add_to_registry "$server_id" "$SERVER_PATH" "$entry_point" "$server_type"
        else
            echo "  Skipped"
        fi
    fi
    echo
done

# Final summary
echo -e "${GREEN}=== Installation Complete! ===${NC}\n"
echo -e "Gateway installed at: ${BLUE}$GATEWAY_DIST_PATH${NC}"
echo -e "Registry config: ${BLUE}$REGISTRY_CONFIG${NC}"
echo
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Restart Claude Code to load the gateway"
echo "2. Use the gateway tools: discover, dispatch, and close"
echo "3. Example: discover({ serverId: \"llm-memory\" })"
echo
echo -e "${BLUE}Useful commands:${NC}"
echo "• List MCP servers: ${YELLOW}claude mcp list${NC}"
echo "• Remove gateway: ${YELLOW}./uninstall.sh${NC}"
echo
echo -e "${BLUE}Happy coding!${NC}"
