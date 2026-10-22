import { asObject } from "./crisp";

export interface CrispCredentials {
  identifier: string;
  key: string;
  websiteId: string;
}

export async function fetchCrispData(url: string, credentials: CrispCredentials): Promise<unknown> {
  if (!credentials.identifier || !credentials.key || !credentials.websiteId) {
    throw new Error("Set your Crisp credentials in Settings first.");
  }

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "X-Crisp-Identifier": credentials.identifier,
        "X-Crisp-Key": credentials.key,
        "X-Crisp-Website-Id": credentials.websiteId,
      },
    });
    // Quota/rate-limit errors must reach the loader immediately so it can pause.
    if ([502, 503, 504].includes(response.status) && attempt < 3) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const retryMs = Number.isFinite(seconds) ? seconds * 1000
        : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
      const delay = Number.isFinite(retryMs) ? Math.max(0, retryMs) : 1000 * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, Math.min(delay, 30_000)));
      continue;
    }
    const json = asObject(await response.json());
    if (!response.ok || json.error) {
      const detail = asObject(json.error);
      const message = typeof json.error === "string" ? json.error
        : typeof detail.message === "string" ? detail.message : json.reason;
      throw new Error(typeof message === "string" ? message : `Crisp request failed (${response.status}).`);
    }
    return json.data;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Crisp API error.";
}
