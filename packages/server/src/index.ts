import type { Engine, StreamEvent } from '@ai-engine/engine';
import type { EngineEvent } from '@ai-engine/core';
import type { ServerWebSocket } from 'bun';
import { createApp } from './app.ts';

export interface ServeOptions {
  webDist?: string;
}

export type WsMessage = { kind: 'event'; event: EngineEvent & { seq?: number } } | { kind: 'stream'; stream: StreamEvent } | { kind: 'hello'; now: string };

export function startServer(engine: Engine, opts: ServeOptions = {}) {
  const app = createApp(engine, opts);
  const sockets = new Set<ServerWebSocket<unknown>>();
  const send = (m: WsMessage) => {
    const s = JSON.stringify(m);
    for (const ws of sockets) {
      try {
        ws.send(s);
      } catch {}
    }
  };
  engine.store.subscribe((event) => send({ kind: 'event', event }));
  engine.onStream((stream) => {
    const ev = stream.event;
    // keep the live feed light: truncate thinking/text blocks, drop unknowns
    if (ev.kind === 'unknown') return;
    const slim: StreamEvent = ev.kind === 'thinking' ? { ...stream, event: { kind: 'thinking', text: ev.text.slice(0, 300) } } : ev.kind === 'tool_result' ? { ...stream, event: { ...ev, content: ev.content.slice(0, 1500) } } : stream;
    send({ kind: 'stream', stream: slim });
  });

  const server = Bun.serve({
    hostname: engine.config.host,
    port: engine.config.port,
    // attachments upload: one file per request, 25 MB cap enforced again in the route
    maxRequestBodySize: 30 * 1024 * 1024,
    // slow uploads / long-running handlers (Bun default is 10 s; max 255)
    idleTimeout: 120,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/ws') {
        if (server.upgrade(req)) return undefined as unknown as Response;
        return new Response('upgrade failed', { status: 400 });
      }
      return app.fetch(req, server);
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        ws.send(JSON.stringify({ kind: 'hello', now: new Date().toISOString() } satisfies WsMessage));
      },
      close(ws) {
        sockets.delete(ws);
      },
      message() {},
    },
  });
  return server;
}

export { createApp };
