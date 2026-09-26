import pg from "pg";

/**
 * Fan-out of Postgres NOTIFY "conversation_events" to in-process subscribers
 * (SSE connections). One LISTEN connection per server process. Payloads only
 * contain ids; subscribers refetch data through authorized code paths.
 */

type Listener = () => void;

export class ConversationEventHub {
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private readonly subs = new Map<string, Set<Listener>>();

  constructor(private readonly connectionString: string) {}

  async subscribe(conversationId: string, fn: Listener): Promise<() => void> {
    await this.ensure();
    let set = this.subs.get(conversationId);
    if (!set) this.subs.set(conversationId, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) this.subs.delete(conversationId);
    };
  }

  get subscriberCount(): number {
    let n = 0;
    for (const s of this.subs.values()) n += s.size;
    return n;
  }

  private async ensure(): Promise<void> {
    if (this.client) return;
    this.connecting ??= (async () => {
      const c = new pg.Client({ connectionString: this.connectionString });
      c.on("notification", (msg) => {
        try {
          const { c: conv } = JSON.parse(msg.payload ?? "{}") as { c?: string };
          if (conv) for (const f of this.subs.get(conv) ?? []) f();
        } catch {
          /* malformed payload: ignore */
        }
      });
      c.on("error", () => {
        // Connection lost: drop it (next subscribe reconnects) and nudge everyone to refetch.
        this.client = null;
        c.end().catch(() => undefined);
        for (const set of this.subs.values()) for (const f of set) f();
      });
      await c.connect();
      await c.query("listen conversation_events");
      this.client = c;
    })().finally(() => {
      this.connecting = null;
    });
    await this.connecting;
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.subs.clear();
    await c?.end().catch(() => undefined);
  }
}

let hub: ConversationEventHub | undefined;

export function conversationEvents(connectionString = process.env.DATABASE_URL): ConversationEventHub {
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  hub ??= new ConversationEventHub(connectionString);
  return hub;
}
