import "server-only";
import { conversationEvents } from "@dtn/db";

const MAX_LIFETIME_MS = 10 * 60_000; // EventSource reconnects on its own
const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events stream for one conversation. Emits "update" (no data) when
 * something changes; the client refetches through its normal authorized endpoint.
 */
export async function conversationEventStream(conversationId: string, signal: AbortSignal): Promise<Response> {
  const hub = conversationEvents();
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          close();
        }
      };
      const unsubscribe = await hub.subscribe(conversationId, () => send("event: update\ndata: {}\n\n"));
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      const lifetime = setTimeout(() => close(), MAX_LIFETIME_MS);
      function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
      cleanup = close;
      signal.addEventListener("abort", close, { once: true });
      send("retry: 3000\nevent: ready\ndata: {}\n\n");
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
