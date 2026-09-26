import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { conversationEventStream } from "@/lib/sse";

export const dynamic = "force-dynamic";

/** Live updates for the team inbox. Access is checked with the user's session and RLS. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const s = await getSession();
  if (!s?.org || !s.can("conversations.read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("conversations").select("id").eq("id", id).eq("organization_id", s.org.id).maybeSingle();
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return conversationEventStream(id, req.signal);
}
