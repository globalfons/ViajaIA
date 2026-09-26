"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Refreshes the page when the server streams an update (SSE). Falls back to
 * periodic refresh only while the live connection is unavailable.
 */
export function LiveRefresh({ url, active, fallbackMs = 10_000 }: { url: string; active: boolean; fallbackMs?: number }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active || typeof EventSource === "undefined") return;
    const es = new EventSource(url);
    const refreshSoon = () => {
      // Coalesce bursts (a message and its metrics arrive together).
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 150);
    };
    es.addEventListener("ready", () => {
      setLive(true);
      refreshSoon(); // catch up on anything that changed while (re)connecting
    });
    es.addEventListener("update", refreshSoon);
    es.onerror = () => setLive(false);
    return () => {
      es.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [url, active, router]);

  useEffect(() => {
    if (!active || live) return;
    const t = setInterval(() => router.refresh(), fallbackMs);
    return () => clearInterval(t);
  }, [active, live, fallbackMs, router]);

  return <span className="sr-only" aria-live="polite" data-live={live ? "on" : "off"} />;
}
