import { NextResponse } from "next/server";
import { pollOnce } from "@/lib/event-listener";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const results = await pollOnce();
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("[sync-deposits] Error:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
