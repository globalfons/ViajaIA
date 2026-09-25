import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe. Does not touch the database or reveal configuration. */
export function GET() {
  return NextResponse.json({ status: "ok", time: new Date().toISOString() });
}
