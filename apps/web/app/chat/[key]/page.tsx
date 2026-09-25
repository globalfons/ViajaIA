import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getWebChannelByKey } from "@dtn/db";
import { ChatWindow } from "@/components/chat/chat-window";
import { resolveBrand } from "@/lib/branding";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chat", robots: { index: false } };

/** Public, embeddable chat for a web channel (loaded by /widget.js in an iframe). */
export default async function PublicChatPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ origin?: string }> }) {
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const channel = await getWebChannelByKey(db(), key);
  if (!channel) notFound();
  const { rows } = await db().query<{ name: string; branding: unknown; white_label_enabled: boolean }>(
    "select name, branding, white_label_enabled from public.organizations where id = $1",
    [channel.organization_id],
  );
  const org = rows[0]!;
  const brand = resolveBrand(org);
  const title = typeof channel.config.title === "string" && channel.config.title ? channel.config.title : org.name;
  const welcome =
    typeof channel.config.welcome === "string" && channel.config.welcome
      ? channel.config.welcome
      : `Hola, soy el asistente virtual de ${org.name}. ¿En qué puedo ayudarte?`;
  return (
    <div style={brand.cssVars as CSSProperties}>
      <ChatWindow channelKey={key} title={title.slice(0, 80)} welcome={welcome.slice(0, 500)} origin={sp.origin?.slice(0, 300) ?? null} />
    </div>
  );
}
