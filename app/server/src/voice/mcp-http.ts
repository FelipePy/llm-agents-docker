// Ferramentas do Jarvis por HTTP (MCP "streamable HTTP" sem estado, so respostas JSON), para o
// cerebro do Codex, que roda num processo a parte. Usa o mesmo servidor MCP em processo do Claude
// (createJarvisServer): as ferramentas sao exatamente as mesmas. A rota exige o token do app.
import type { IncomingMessage, ServerResponse } from 'node:http';

type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; [k: string]: unknown };

interface Transport {
  start(): Promise<void>;
  close(): Promise<void>;
  send(message: JsonRpc): Promise<void>;
  onmessage?: (message: JsonRpc) => void;
}

/** O que createSdkMcpServer devolve em `instance` (o McpServer do SDK do MCP). */
export interface McpInstance {
  connect(transport: Transport): Promise<void>;
}

const MAX_BODY = 1_000_000;

/** Liga um servidor MCP em processo a pedidos HTTP: cada POST traz uma mensagem JSON-RPC (ou um lote). */
export function mcpHttpHandler(make: () => { instance: unknown }) {
  // Respostas esperadas, por id. Os ids vem do cliente: prefixados para dois pedidos nao colidirem.
  const pending = new Map<string, (m: JsonRpc) => void>();
  let seq = 0;
  let ready: Promise<Transport> | undefined;
  const transport = (): Promise<Transport> =>
    (ready ??= (async () => {
      const t: Transport = {
        start: async () => {},
        close: async () => {},
        send: async (m) => {
          const key = String(m.id);
          const done = pending.get(key);
          if (done) {
            pending.delete(key);
            done(m);
          }
        },
      };
      await (make().instance as McpInstance).connect(t);
      return t;
    })());

  async function dispatch(m: JsonRpc): Promise<JsonRpc | null> {
    const t = await transport();
    if (m.id === undefined || m.id === null) {
      t.onmessage?.(m);
      return null;
    }
    const key = `h${++seq}`;
    const original = m.id;
    const reply = await new Promise<JsonRpc>((resolve) => {
      pending.set(key, resolve);
      t.onmessage?.({ ...m, id: key });
    });
    return { ...reply, id: original };
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      // Sem canal de eventos (GET) nem sessoes (DELETE): so pedido e resposta.
      res.writeHead(405, { allow: 'POST' });
      return void res.end();
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) {
        res.writeHead(413);
        return void res.end();
      }
    }
    let msg: JsonRpc | JsonRpc[];
    try {
      msg = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }));
    }
    const list = Array.isArray(msg) ? msg : [msg];
    const replies = (await Promise.all(list.map(dispatch))).filter((r): r is JsonRpc => r !== null);
    if (!replies.length) {
      res.writeHead(202);
      return void res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(Array.isArray(msg) ? replies : replies[0]));
  };
}
