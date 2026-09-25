import { NextResponse } from "next/server";
import { buildOpenApi } from "@/lib/api/openapi";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildOpenApi(process.env.APP_URL ?? "http://localhost:3000"));
}
