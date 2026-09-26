"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send, UserRound } from "lucide-react";

interface Msg {
  role: "user" | "agent";
  human?: boolean;
  content: string;
}

const STORAGE = "dtn_chat";

function load(key: string): { visitorId: string; conversationId: string | null } {
  try {
    const raw = localStorage.getItem(`${STORAGE}:${key}`);
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage may be blocked in third-party iframes */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const visitorId = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { visitorId, conversationId: null };
}

function save(key: string, v: { visitorId: string; conversationId: string | null }) {
  try {
    localStorage.setItem(`${STORAGE}:${key}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** Public customer chat. Text only: nothing from the model is rendered as HTML. */
export function ChatWindow({ channelKey, title, welcome, origin }: { channelKey: string; title: string; welcome: string; origin: string | null }) {
  const [session, setSession] = useState<{ visitorId: string; conversationId: string | null } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string>("open");
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => setSession(load(channelKey)), [channelKey]);

  const refresh = useCallback(async () => {
    if (!session?.conversationId) return;
    const q = new URLSearchParams({ visitorId: session.visitorId, ...(origin ? { origin } : {}) });
    const res = await fetch(`/api/public/chat/${channelKey}/conversations/${session.conversationId}?${q}`, { cache: "no-store" });
    if (res.status === 404) {
      const fresh = { visitorId: session.visitorId, conversationId: null };
      save(channelKey, fresh);
      setSession(fresh);
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { status: string; messages: Msg[] };
    setMessages(data.messages);
    setStatus(data.status);
  }, [channelKey, origin, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates (SSE): human replies arrive as soon as they are sent.
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!session?.conversationId || typeof EventSource === "undefined") return;
    const q = new URLSearchParams({ visitorId: session.visitorId, ...(origin ? { origin } : {}) });
    const es = new EventSource(`/api/public/chat/${channelKey}/conversations/${session.conversationId}/events?${q}`);
    es.addEventListener("ready", () => {
      setLive(true);
      void refresh(); // catch up on anything sent while (re)connecting
    });
    es.addEventListener("update", () => void refresh());
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [channelKey, origin, session, refresh]);

  // Fallback while the live connection is unavailable and a person handles the conversation.
  useEffect(() => {
    if (live || (status !== "escalated" && status !== "human")) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [live, status, refresh]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || !session || sending) return;
    setInput("");
    setError(null);
    setSending(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const res = await fetch(`/api/public/chat/${channelKey}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visitorId: session.visitorId, conversationId: session.conversationId, message: text, origin }),
      });
      if (res.status === 429) throw new Error("Estás enviando mensajes muy rápido. Espera un momento.");
      if (!res.ok) throw new Error("No se ha podido enviar el mensaje. Inténtalo de nuevo.");
      const data = (await res.json()) as { conversationId: string; reply: string | null; status: string };
      const next = { visitorId: session.visitorId, conversationId: data.conversationId };
      save(channelKey, next);
      setSession(next);
      setStatus(data.status);
      if (data.reply) setMessages((m) => [...m, { role: "agent", content: data.reply! }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const humanActive = status === "human";
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center gap-2 border-b bg-primary px-4 py-3 text-primary-foreground">
        <Bot className="h-5 w-5" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="text-xs opacity-90">{humanActive ? "Te atiende una persona del equipo" : "Asistente de IA · puede cometer errores"}</p>
        </div>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm">{welcome}</div>
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "agent" ? (m.human ? <UserRound className="mt-1 h-4 w-4 shrink-0 text-primary" /> : <Bot className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />) : null}
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-muted"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {sending ? <p className="text-xs text-muted-foreground">Escribiendo…</p> : null}
        {status === "escalated" ? <p className="text-center text-xs text-muted-foreground">Una persona del equipo continuará la conversación.</p> : null}
        <div ref={bottom} />
      </div>
      {error ? <p className="px-4 pb-1 text-xs text-danger">{error}</p> : null}
      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={4000}
          placeholder="Escribe tu mensaje…"
          aria-label="Mensaje"
          className="h-10 flex-1 rounded-full border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button type="submit" disabled={!input.trim() || sending || !session} aria-label="Enviar" className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
