"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes server data periodically while `active` (e.g. documents being indexed). */
export function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
