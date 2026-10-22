import axios from "axios";
import { NextResponse } from "next/server";
import { asObject } from "./crisp";

export function crispConnection(req: Request) {
  const identifier = req.headers.get("X-Crisp-Identifier");
  const key = req.headers.get("X-Crisp-Key");
  const websiteId = req.headers.get("X-Crisp-Website-Id");
  if (!identifier || !key || !websiteId) return null;
  return {
    baseUrl: `https://api.crisp.chat/v1/website/${encodeURIComponent(websiteId)}`,
    config: {
      timeout: 30_000,
      headers: {
        "X-Crisp-Tier": "plugin",
        Authorization: `Basic ${Buffer.from(`${identifier}:${key}`).toString("base64")}`,
      },
    },
  };
}

export function crispErrorResponse(error: unknown) {
  // Axios errors contain credentials in their config; never log or return them.
  if (axios.isAxiosError(error)) {
    const status = error.response?.status || 502;
    const data = asObject(error.response?.data);
    const detail = asObject(data.data);
    const reason = typeof data.reason === "string" ? data.reason : "Crisp request failed";
    const message = typeof detail.message === "string" ? detail.message : reason;
    const retryAfter = error.response?.headers["retry-after"];
    return NextResponse.json({ error: message }, {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
      },
    });
  }
  return NextResponse.json({ error: "Unable to fetch Crisp data" }, { status: 500 });
}
