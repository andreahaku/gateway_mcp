Sì — puoi farlo con un **“MCP Gateway/Router”**: un singolo server MCP estremamente “magro” che espone solo 2–3 tool generici (es. `discover`, `dispatch`, opz. `close`) e **carica on-demand** altri server MCP (stdio/WebSocket) **solo quando richiesti**. In questo modo il client/LLM vede un set minimo di tool e non satura la context window con gli schemi dei tool dei server a valle finché non servono.
L’idea è: il gateway mantiene un **registry** dei server autorizzati, avvia il server target quando riceve una richiesta, **proxy-a la chiamata** e restituisce il risultato. Puoi anche fare caching/LRU delle connessioni.

Fonti primarie su MCP (spec + SDK ufficiale): ([Model Context Protocol][1])

---

# Architettura

- **Client MCP (Claude Desktop, Cursor, Codex CLI, ecc.)** ⇄ **MCP Gateway (questo repo)** ⇄ _(on-demand)_ **Server MCP di dominio** (DB, Git, Jira, Vector DB, ecc.)
- Il **Gateway espone** solo:

  - `discover(serverId)`: ritorna metadati e tool summary del server target (senza registrare i tool nel client).
  - `dispatch(serverId, tool, args)`: apre/riusa la connessione, invoca il tool e ritorna il risultato.
  - `close(serverId)`: opzionale, spegne/sgancia il server.

> Nota: lo **schema di `dispatch` è generico** (non “esploso” per tool). Questo evita che il client importi centinaia di schemi nel suo prompt. Quando serve guidance di schema per un tool specifico, puoi permettere al modello di chiamare `discover` prima, e far restituire (in risposta) lo **shape JSON dello schema** del tool target che il modello potrà usare nel turno successivo (pattern a due step). È un compromesso intenzionale per ridurre il bloat del contesto.

---

# Esempio completo (TypeScript, Node, SDK MCP ufficiale)

Di seguito un server **runnable** che funge da Gateway MCP via **stdio**. Supporta:

- registry file con server stdio o WebSocket,
- spawn on-demand,
- caching connessioni,
- `discover`, `dispatch`, `close`.

**Prerequisiti**

```bash
mkdir mcp-gateway && cd mcp-gateway
npm init -y
npm i @modelcontextprotocol/sdk zod ws
npm i -D typescript @types/node ts-node
npx tsc --init
```

**`src/registry.ts`** – elenco server autorizzati

```ts
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
    id: "git-tools",
    kind: "stdio",
    command: "node",
    args: ["./examples/git-server.mjs"], // es. tuo server MCP stdio
    connectTimeoutMs: 8000,
    idleTtlMs: 5 * 60_000,
  },
  {
    id: "vector-search",
    kind: "ws",
    url: "wss://your-vector-host/mcp",
    connectTimeoutMs: 8000,
    idleTtlMs: 10 * 60_000,
  },
];
```

**`src/gateway.ts`** – il server MCP Gateway

```ts
import { z } from "zod";
import {
  Server,
  Tool,
  Schema,
  connectToWebSocketServer,
  connectToStdioServer,
  type ClientTransport,
} from "@modelcontextprotocol/sdk";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { REGISTRY, type ServerConfig } from "./registry";

type Connected = {
  cfg: ServerConfig;
  client: Awaited<ReturnType<typeof connect>>;
  lastUsed: number;
  idleTtlMs: number;
  // opzionale: child process handle per stdio
  child?: import("node:child_process").ChildProcessWithoutNullStreams;
};

const connected = new Map<string, Connected>();

async function connect(cfg: ServerConfig, child?: any) {
  if (cfg.kind === "ws") {
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
    const client = await connectToWebSocketServer({ socket: ws });
    return client;
  } else {
    const proc =
      child ??
      spawn(assert(cfg.command, "command required"), cfg.args ?? [], {
        cwd: cfg.cwd,
        env: { ...process.env, ...(cfg.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });
    const client = await connectToStdioServer({
      input: proc.stdout!,
      output: proc.stdin!,
    });
    return client;
  }
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
  let child: any;
  if (cfg.kind === "stdio") {
    child = spawn(assert(cfg.command, "missing command"), cfg.args ?? [], {
      cwd: cfg.cwd,
      env: { ...process.env, ...(cfg.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  const client = await connect(cfg, child);
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
          (c.client as any)?.close?.();
        } catch {}
        try {
          c.child?.kill?.("SIGTERM");
        } catch {}
        connected.delete(id);
      }
    }
  }, 30_000).unref();
}

const discoverInput = Schema.object({
  serverId: Schema.string(),
});

const dispatchInput = Schema.object({
  serverId: Schema.string(),
  tool: Schema.string(),
  args: Schema.record(Schema.unknown()).optional(),
});

const closeInput = Schema.object({
  serverId: Schema.string(),
});

async function main() {
  const server = new Server(
    {
      name: "mcp-gateway",
      version: "1.0.0",
    },
    {
      // Minimal “resources/prompts” per essere trasparente ma non invasivo
      resources: [],
      prompts: [],
    }
  );

  // Tool: discover -> ritorna metadati e tool summary del server target
  server.addTool(
    new Tool({
      name: "discover",
      description:
        "Return meta and tools of a target MCP server without registering them in the client.",
      inputSchema: discoverInput,
      async handler({ serverId }) {
        const conn = await ensureConnection(serverId);
        // Chiede al server target la lista tool/resources (MCP: server/listTools ecc. via client)
        const tools = (await (conn.client as any).listTools?.()) ?? [];
        const resources = (await (conn.client as any).listResources?.()) ?? [];
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ serverId, tools, resources }, null, 2),
            },
          ],
        };
      },
    })
  );

  // Tool: dispatch -> invoca tool remoto
  server.addTool(
    new Tool({
      name: "dispatch",
      description:
        "Call a tool on a target MCP server. Use discover first to see available tools.",
      inputSchema: dispatchInput,
      async handler({ serverId, tool, args }) {
        const conn = await ensureConnection(serverId);
        // Esegue direttamente la call tool → response content del server remoto
        const result = await (conn.client as any).callTool?.(tool, args ?? {});
        return {
          // Normalizza la risposta in contenuti MCP
          content: Array.isArray(result?.content)
            ? result.content
            : [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    })
  );

  // Tool: close -> chiude connessione al server target
  server.addTool(
    new Tool({
      name: "close",
      description:
        "Close and evict a target MCP server connection from the gateway cache.",
      inputSchema: closeInput,
      async handler({ serverId }) {
        const c = connected.get(serverId);
        if (!c) {
          return {
            content: [
              { type: "text", text: `serverId ${serverId} not connected` },
            ],
          };
        }
        try {
          (c.client as any)?.close?.();
        } catch {}
        try {
          c.child?.kill?.("SIGTERM");
        } catch {}
        connected.delete(serverId);
        return {
          content: [{ type: "text", text: `serverId ${serverId} closed` }],
        };
      },
    })
  );

  scheduleGc();
  await server.start(); // stdio
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Build & Run**

```bash
# package.json scripts
# "build": "tsc",
# "start": "ts-node src/gateway.ts"

npm run start
```

**Configurazione nel client (es.)**

- In Claude Desktop/Cursor aggiungi un server MCP “custom stdio” puntando a `node ./dist/gateway.js` (o `ts-node src/gateway.ts` in dev).
- Il client vedrà solo i 2–3 tool (`discover`, `dispatch`, `close`).
- Il modello, quando serve Git, chiamerà `discover(serverId:"git-tools")` → poi `dispatch(serverId:"git-tools", tool:"git.clone", args:{...})`.

---

## Considerazioni pratiche

- **Schema-guidance**: con `dispatch` generico perdi l’auto-suggest degli argomenti del tool target. Il pattern consigliato è **2-step**: `discover` → il gateway restituisce anche gli **schemi JSON** dei tool (dalla spec Tools), che il modello può usare nel turno successivo per costruire correttamente `args`. (Spec “Tools” e firma/metadata: ([Model Context Protocol][2]))
- **Sicurezza**: whitelist nel `REGISTRY`, env isolati, risorse in sandbox, rate-limit per `dispatch`, timeout stretti ed **arg validation** lato gateway se vuoi policy centrally-enforced.
- **Lifecycle**: `idleTtlMs` + GC periodico riducono footprint. Per job lunghi puoi aggiungere **keepalive pings** e **streaming** pass-through se il client/SDK lo supporta.
- **Transport**: supporta **stdio** e **WebSocket/SSE**. Lo SDK TS ufficiale espone helper per entrambi (vedi docs “Build a server” + SDK npm). ([Model Context Protocol][3])
- **Osservabilità**: log strutturati dei call e tempi dei server downstream; semplice **circuit-breaker** per server instabili.
- **Multi-tenant**: istanzia gateway con registry per tenant o risoluzione dinamica da un **Service Registry** (es. URL firmati + JWT).

---

## Varianti avanzate

1. **Auto-mount suggerito**: esponi un tool `planAndDispatch(query)` che fa **discovery + ranking** dei server adatti in base alla richiesta (embedding match su descrizioni dei tool) e poi esegue `dispatch`.

2. **Schema on-demand**: aggiungi un tool `getToolSchema(serverId, tool)` che ritorna solo lo schema Zod/JSON Schema del tool target per massimizzare guidance senza registrare l’intero server.

3. **Namespace virtualization**: se vuoi esporre _alcuni_ tool di un server senza tutto il pacchetto, aggiungi un “**allow-list di tool**” nel registry e filtra in `discover/dispatch`.

---

## Perché questa soluzione evita il bloat del contesto

- I client MCP tipicamente includono i **metadata dei tool** nel sistema-prompt o nel working context; più tool ⇒ più token.
- Il Gateway espone **un set fisso, minimo** di tool → overhead quasi costante. Gli schemi “verbose” dei tool reali vengono consultati **solo quando servono** via `discover`, come contenuto di risposta (che il modello può riciclare nel turno successivo), invece di essere **registrati** globalmente al connect. (Concetti di _tools_ e _resources_ nella spec: ([Model Context Protocol][2]))

---

Se vuoi, preparo un **repo minimale** con script `docker-compose` per avviare 1–2 server MCP di esempio (es. Git stdio + Vector WS) e la configurazione pronta per Claude/Cursor.

[1]: https://modelcontextprotocol.io/specification/latest?utm_source=chatgpt.com "Specification"
[2]: https://modelcontextprotocol.io/specification/2025-06-18/server/tools?utm_source=chatgpt.com "Tools"
[3]: https://modelcontextprotocol.io/docs/develop/build-server?utm_source=chatgpt.com "Build an MCP server"
