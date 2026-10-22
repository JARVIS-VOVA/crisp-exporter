import { NextResponse } from "next/server";
import axios from "axios";
import { crispConnection, crispErrorResponse } from "@/lib/crisp-api";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = url.searchParams.get("page") || "1";
  if (!/^\d+$/.test(page) || !Number.isSafeInteger(Number(page)) || Number(page) < 1) {
    return NextResponse.json({ error: "page must be a positive integer" }, { status: 400 });
  }
  const connection = crispConnection(req);
  if (!connection) return NextResponse.json({ error: "Missing Crisp credentials" }, { status: 400 });

  const params = new URLSearchParams({ per_page: "50" });
  for (const name of ["filter_date_start", "filter_date_end"]) {
    const value = url.searchParams.get(name);
    if (value) params.set(name, value);
  }
  try {
    const response = await axios.get(`${connection.baseUrl}/conversations/${page}`, {
      ...connection.config, params,
    });
    return NextResponse.json(response.data, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    return crispErrorResponse(error);
  }
}
