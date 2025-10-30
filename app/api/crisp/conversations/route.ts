import { NextResponse } from "next/server";
import axios from "axios";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const page = url.searchParams.get("page") || "1";
    const crispIdentifier = url.searchParams.get("crisp_identifier");
    const crispKey = url.searchParams.get("crisp_key");
    const crispWebsiteId = url.searchParams.get("crisp_website_id");

    if (!crispIdentifier || !crispKey || !crispWebsiteId) {
      return NextResponse.json({ error: "Missing Crisp credentials" }, { status: 400 });
    }

    const res = await axios.get(
      `https://api.crisp.chat/v1/website/${crispWebsiteId}/conversations/${page}`,
      {
        headers: {
          "X-Crisp-Tier": "plugin",
          Authorization: `Basic ${Buffer.from(`${crispIdentifier}:${crispKey}`).toString("base64")}`,
        },
      }
    );

    return NextResponse.json(res.data);
  } catch (err: any) {
    console.error(err);

    if (err.response?.data) {
      return NextResponse.json({ error: err.response.data }, { status: err.response.status || 500 });
    }

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
