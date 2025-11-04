import { NextResponse } from "next/server";
import axios from "axios";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const page = url.searchParams.get("page") || "1";
    const crispIdentifier = url.searchParams.get("crisp_identifier");
    const crispKey = url.searchParams.get("crisp_key");
    const crispWebsiteId = url.searchParams.get("crisp_website_id");

    const filterDateStart = url.searchParams.get("filter_date_start");
    const filterDateEnd = url.searchParams.get("filter_date_end");

    if (!crispIdentifier || !crispKey || !crispWebsiteId) {
      return NextResponse.json({ error: "Missing Crisp credentials" }, { status: 400 });
    }

    const params = new URLSearchParams({
      per_page: "50",
    });

    if (filterDateStart) params.append("filter_date_start", filterDateStart);
    if (filterDateEnd) params.append("filter_date_end", filterDateEnd);

    const crispUrl = `https://api.crisp.chat/v1/website/${crispWebsiteId}/conversations/${page}?${params.toString()}`;

    const res = await axios.get(crispUrl, {
      headers: {
        "X-Crisp-Tier": "plugin",
        Authorization: `Basic ${Buffer.from(`${crispIdentifier}:${crispKey}`).toString("base64")}`,
      },
    });

    return NextResponse.json(res.data);
  } catch (err: any) {
    console.error(err);

    if (err.response?.data) {
      return NextResponse.json({ error: err.response.data }, { status: err.response.status || 500 });
    }

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
