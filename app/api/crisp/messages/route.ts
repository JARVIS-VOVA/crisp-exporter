import { NextResponse } from "next/server";
import axios from "axios";
import { crispConnection, crispErrorResponse } from "@/lib/crisp-api";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  const before = url.searchParams.get("timestamp_before");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });
  if (before !== null && (!/^-?\d+$/.test(before) || !Number.isSafeInteger(Number(before)))) {
    return NextResponse.json({ error: "timestamp_before must be an integer in milliseconds" }, { status: 400 });
  }
  const connection = crispConnection(req);
  if (!connection) return NextResponse.json({ error: "Missing Crisp credentials" }, { status: 400 });

  try {
    const response = await axios.get(
      `${connection.baseUrl}/conversation/${encodeURIComponent(sessionId)}/messages`,
      { ...connection.config, params: before === null ? {} : { timestamp_before: before } },
    );
    return NextResponse.json(response.data, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    return crispErrorResponse(error);
  }
}
