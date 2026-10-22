import { test } from "node:test";
import assert from "node:assert/strict";
import axios, { AxiosError } from "axios";
import { GET as getMessages } from "../app/api/crisp/messages/route";
import { GET as getConversations } from "../app/api/crisp/conversations/route";
import { fetchCrispData } from "./crisp-client";
import { loadConversationMessages } from "./crisp";
import { createMessagesCheckpoint, loadAllConversationMessages } from "./crisp-loader";

const credentials = { identifier: "test-identifier", key: "test-key", websiteId: "test-website" };
const headers = { "X-Crisp-Identifier": credentials.identifier, "X-Crisp-Key": credentials.key, "X-Crisp-Website-Id": credentials.websiteId };

test("client, route and paginator forward millisecond cursors and credentials for every batch", async () => {
  const adapter = axios.defaults.adapter;
  const originalFetch = globalThis.fetch;
  const cursors: unknown[] = [];
  try {
    axios.defaults.adapter = async config => {
      assert.equal(config.url, "https://api.crisp.chat/v1/website/test-website/conversation/session_test/messages");
      assert.equal(config.headers.Authorization, `Basic ${Buffer.from("test-identifier:test-key").toString("base64")}`);
      const before = config.params.timestamp_before;
      cursors.push(before);
      const data = before === undefined ? [{ timestamp: 1720000000123, fingerprint: 2 }]
        : before === "1720000000123" ? [{ timestamp: 1710000000456, fingerprint: 1 }] : [];
      return { config, status: 200, statusText: "OK", headers: {}, data: { error: false, data } };
    };
    globalThis.fetch = async (input, options) => {
      assert.ok(!String(input).includes(credentials.key), "credentials must not be in URLs");
      const response = await getMessages(new Request(new URL(String(input), "http://localhost"), options));
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      return response;
    };
    const messages = await loadConversationMessages(before => {
      const params = new URLSearchParams({ session_id: "session_test" });
      if (before !== undefined) params.set("timestamp_before", String(before));
      return fetchCrispData(`/api/crisp/messages?${params}`, credentials);
    });
    assert.deepEqual(cursors, [undefined, "1720000000123", "1710000000456"]);
    assert.deepEqual(messages.map(message => message.fingerprint), [1, 2]);
  } finally {
    axios.defaults.adapter = adapter;
    globalThis.fetch = originalFetch;
  }
});

test("conversation route preserves date filters and raw metadata", async () => {
  const adapter = axios.defaults.adapter;
  const data = [{ session_id: "test", meta: { email: "client@example.test", data: { plan: "pro" } } }];
  try {
    axios.defaults.adapter = async config => {
      assert.ok(config.url?.endsWith("/conversations/2"));
      assert.equal(config.params.get("filter_date_start"), "2026-10-01T00:00:00.000Z");
      assert.equal(config.params.get("per_page"), "50");
      return { config, status: 200, statusText: "OK", headers: {}, data: { error: false, data } };
    };
    const response = await getConversations(new Request("http://localhost/api/crisp/conversations?page=2&filter_date_start=2026-10-01T00%3A00%3A00.000Z", { headers }));
    assert.deepEqual((await response.json()).data, data);
  } finally {
    axios.defaults.adapter = adapter;
  }
});

test("routes reject missing credentials and invalid pagination parameters", async () => {
  assert.equal((await getMessages(new Request("http://localhost/?session_id=test"))).status, 400);
  assert.equal((await getMessages(new Request("http://localhost/?session_id=test&timestamp_before=NaN", { headers }))).status, 400);
  assert.equal((await getConversations(new Request("http://localhost/?page=0", { headers }))).status, 400);
});

test("rate limits retain Retry-After and stop requests until a manual resume", async () => {
  const adapter = axios.defaults.adapter;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    axios.defaults.adapter = async config => {
      const response = { config, status: 429, statusText: "Too Many Requests", headers: { "retry-after": "0" }, data: { reason: "rate_limited" } };
      throw new AxiosError("Request failed", "ERR_BAD_REQUEST", config, undefined, response);
    };
    const limited = await getMessages(new Request("http://localhost/?session_id=test", { headers }));
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "0");
    assert.equal(await limited.text(), '{"error":"rate_limited"}');
    globalThis.fetch = async () => {
      if (++calls === 1) return new Response('{"error":"rate_limited"}', { status: 429, headers: { "Retry-After": "0" } });
      return new Response('{"error":false,"data":[]}');
    };
    await assert.rejects(fetchCrispData("/api/crisp/messages?session_id=test", credentials), /rate_limited/);
    assert.equal(calls, 1, "a rate limit must not trigger automatic retries");
    assert.deepEqual(await fetchCrispData("/api/crisp/messages?session_id=test", credentials), []);
    assert.equal(calls, 2);
  } finally {
    axios.defaults.adapter = adapter;
    globalThis.fetch = originalFetch;
  }
});

test("temporary upstream failures can still retry without changing a pagination cursor", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  try {
    globalThis.fetch = async input => {
      urls.push(String(input));
      if (urls.length === 1) return new Response('{"error":"unavailable"}', { status: 502, headers: { "Retry-After": "0" } });
      return new Response('{"error":false,"data":[]}');
    };
    assert.deepEqual(await fetchCrispData("/api/crisp/messages?session_id=test&timestamp_before=123", credentials), []);
    assert.deepEqual(urls, ["/api/crisp/messages?session_id=test&timestamp_before=123", "/api/crisp/messages?session_id=test&timestamp_before=123"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP quota failure pauses the full loader and resumes with saved batches when quota returns", async () => {
  const originalFetch = globalThis.fetch;
  const checkpoint = createMessagesCheckpoint();
  const conversations = [{ session_id: "a" }, { session_id: "b" }];
  const calls: [string | null, string | null][] = [];
  let quotaAvailable = false;
  try {
    globalThis.fetch = async input => {
      const params = new URL(String(input), "http://localhost").searchParams;
      const sessionId = params.get("session_id");
      const before = params.get("timestamp_before");
      calls.push([sessionId, before]);
      if (sessionId === "a" && before === null) {
        return new Response(JSON.stringify({ error: false, data: [{ timestamp: 100, fingerprint: 1 }] }));
      }
      if (!quotaAvailable) return new Response('{"error":"quota_exceeded"}', { status: 429 });
      return new Response('{"error":false,"data":[]}');
    };
    const fetchBatch = (sessionId: string, before?: number) => {
      const params = new URLSearchParams({ session_id: sessionId });
      if (before !== undefined) params.set("timestamp_before", String(before));
      return fetchCrispData(`/api/crisp/messages?${params}`, credentials);
    };
    await assert.rejects(loadAllConversationMessages(conversations, checkpoint, fetchBatch), /quota_exceeded/);
    assert.deepEqual(calls, [["a", null], ["a", "100"]]);
    assert.equal(checkpoint.current.messages.length, 1);
    assert.equal(checkpoint.complete, false);
    quotaAvailable = true;
    const result = await loadAllConversationMessages(conversations, checkpoint, fetchBatch);
    assert.deepEqual(calls, [["a", null], ["a", "100"], ["a", "100"], ["b", null]]);
    assert.equal(result[0].messages.length, 1);
    assert.equal(checkpoint.complete, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
