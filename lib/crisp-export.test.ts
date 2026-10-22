import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { buildExport, messageColumns, messageRows, toCsv, toWorkbook } from "./crisp-export";
import type { CrispMessage } from "./crisp";

const filters = { conversation_updated_from: null, conversation_updated_to: null };
const conversation = {
  session_id: "session_test",
  meta: { email: "client@example.test", nickname: "Клієнт", data: { plan: "pro", user_id: "client_123" }, device: { locales: ["uk"] }, segments: ["paid"] },
  custom: { untouched: true },
};
const messages: CrispMessage[] = [
  { fingerprint: 2, timestamp: 1720000000124, from: "operator", type: "note", origin: "chat", automated: false,
    content: 'Привіт, "Майк"_x000d_\nДругий рядок 😀', user: { user_id: "mike", nickname: "Майк" }, extra: { keep: 1 } },
  { fingerprint: 1, timestamp: 1720000000123, from: "operator", type: "text", origin: "urn:integration", automated: true, content: "Bot" },
  { fingerprint: 3, timestamp: 1720000000125, from: "user", type: "file", origin: "chat",
    content: { url: "https://example.test/image.png", name: "Помилка.png", type: "image/png", size: 42 } },
  { fingerprint: 4, timestamp: 1720000000125, from: "operator", type: "audio", content: { url: "https://example.test/voice.webm", type: "audio/webm", duration: 10 } },
];
const fixture = (items = messages) => buildExport([conversation], [{ session_id: conversation.session_id, messages: items }], filters, "2026-10-22T10:00:00.000Z");

test("JSON preserves raw payloads, metadata, notes, automated states, attachments and exact time", () => {
  const exported = JSON.parse(JSON.stringify(fixture()));
  assert.equal(exported.message_count, 4);
  assert.deepEqual(exported.conversations[0].raw, conversation);
  const result = exported.conversations[0].messages;
  assert.deepEqual(result.map((message: { automated: unknown }) => message.automated), [true, false, null, null]);
  assert.equal(result[0].timestamp_ms, 1720000000123);
  assert.equal(result[0].timestamp_iso, "2024-07-03T09:46:40.123Z");
  assert.deepEqual(result[1].raw, messages[0]);
  assert.equal(result[1].type, "note");
  assert.equal(result[1].operator_name, "Майк");
  assert.equal(result[1].text, messages[0].content);
  assert.equal(result[1].text_clean, 'Привіт, "Майк"\nДругий рядок 😀');
  assert.equal(result[2].text, "[image]");
  assert.deepEqual(result[2].attachments, [messages[2].content]);
  assert.equal(result[3].file_url, "https://example.test/voice.webm");
});

test("CSV round trip preserves multiline Unicode, literal escape sequences and metadata", () => {
  const options = { includeRaw: true };
  const rows = messageRows(fixture(), options);
  const csv = toCsv(rows, messageColumns(options));
  assert.ok(csv.startsWith("\uFEFF"));
  const workbook = XLSX.read(csv, { type: "string", raw: true });
  const parsed = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  assert.equal(parsed.length, 4);
  assert.equal(parsed[1].text, messages[0].content);
  assert.equal(parsed[1].user_email, "client@example.test");
  assert.deepEqual(JSON.parse(parsed[1].user_data_json), conversation.meta.data);
  assert.equal(parsed[1].user_id, "client_123");
  assert.deepEqual(JSON.parse(parsed[2].content_json), messages[2].content);
  assert.equal(parsed[1].automated, "false");
  assert.equal(parsed[2].automated, "");
  assert.equal(parsed[0].timestamp_ms, "1720000000123");
});

test("XLSX round trip retains strings, booleans, numeric milliseconds and raw payloads", () => {
  const bytes = XLSX.write(toWorkbook(fixture(), { includeRaw: true }), { type: "buffer", bookType: "xlsx" });
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Messages);
  assert.equal(rows[1].text, messages[0].content);
  assert.equal(rows[1].automated, false);
  assert.equal(rows[0].timestamp_ms, 1720000000123);
  assert.deepEqual(JSON.parse(String(rows[2].raw_message_json)), messages[2]);
  assert.deepEqual(JSON.parse(String(rows[0].conversation_raw_json)), conversation);
  assert.deepEqual(workbook.SheetNames, ["Messages", "Conversations", "Export Info"]);
});

test("XLSX stores oversized cells in recoverable overflow parts", () => {
  const text = "аб😀_x000d_".repeat(8000);
  const bytes = XLSX.write(toWorkbook(fixture([{ timestamp: 1, content: text, type: "text" }])), { type: "buffer", bookType: "xlsx" });
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets.Messages);
  const overflow = XLSX.utils.sheet_to_json<{ sheet: string; row: number; column: string; part: number; value: string }>(workbook.Sheets["Cell Overflow"]);
  const rest = overflow.filter(part => part.sheet === "Messages" && part.row === 2 && part.column === "text").sort((a, b) => a.part - b.part);
  assert.ok(rows[0].text + rest.map(part => part.value).join("") === text, "long text must survive XLSX without lost Unicode or escape tokens");
});

test("empty conversations remain in JSON/XLSX and incomplete loads cannot be exported", () => {
  const data = fixture([]);
  assert.equal(data.conversations.length, 1);
  assert.equal(data.message_count, 0);
  assert.equal(toCsv(messageRows(data)).split("\r\n").length, 2);
  assert.ok(toWorkbook(data).Sheets.Conversations);
  assert.throws(() => buildExport([conversation], [], filters), /Load all messages/);
  assert.throws(() => buildExport([conversation], [{ session_id: "another", messages: [] }], filters), /Load all messages/);
});

test("compact CSV/XLSX omit raw payload columns while retaining customer and attachment data", () => {
  const data = fixture();
  const rows = messageRows(data);
  const removed = ["raw_message_json", "conversation_raw_json", "conversation_meta_json", "content_json"];
  assert.ok(removed.every(column => !messageColumns().includes(column) && !(column in rows[0])));
  const csv = XLSX.read(toCsv(rows), { type: "string", raw: true });
  const csvRows = XLSX.utils.sheet_to_json<Record<string, string>>(csv.Sheets[csv.SheetNames[0]]);
  assert.ok(removed.every(column => !(column in csvRows[0])));
  assert.equal(csvRows[2].file_url, "https://example.test/image.png");
  assert.deepEqual(JSON.parse(csvRows[2].attachments_json), [messages[2].content]);
  assert.deepEqual(JSON.parse(csvRows[0].user_data_json), conversation.meta.data);
  assert.equal(csvRows[0].user_id, "client_123");
  const workbook = XLSX.read(XLSX.write(toWorkbook(data), { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  for (const name of ["Messages", "Conversations"]) {
    const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name]);
    assert.ok(removed.every(column => !(column in sheetRows[0])));
    assert.equal(sheetRows[0].user_id, "client_123");
  }
  // Full original data remains in JSON regardless of spreadsheet settings.
  assert.deepEqual(data.conversations[0].raw, conversation);
  assert.deepEqual(data.conversations[0].messages[2].raw, messages[2]);
});

test("operator reply filter handles omitted automation flags and keeps the entire conversation", () => {
  const human = { timestamp: 10, from: "operator", type: "text", automated: false, content: "Human reply" };
  const sessions = ["human", "bot", "note", "unknown", "empty"].map(session_id => ({ ...conversation, session_id }));
  const groups = [
    { session_id: "human", messages: [...messages, human] },
    { session_id: "bot", messages: [messages[1]] },
    { session_id: "note", messages: [messages[0]] },
    { session_id: "unknown", messages: [messages[3]] },
    { session_id: "empty", messages: [] },
  ];
  const data = buildExport(sessions, groups, { ...filters, only_conversations_with_operator_reply: true });
  assert.deepEqual(data.conversations.map(item => item.session_id), ["human", "unknown"]);
  assert.equal(data.conversation_count, 2);
  assert.equal(data.source_conversation_count, 5);
  assert.equal(data.excluded_conversation_count, 3);
  assert.equal(data.message_count, 6);
  assert.ok(data.conversations[0].messages.some(message => message.type === "note"));
  assert.ok(data.conversations[0].messages.some(message => message.automated === true));
  assert.equal(messageRows(data).length, 6);
  const all = buildExport(sessions, groups, { ...filters, only_conversations_with_operator_reply: false });
  assert.equal(all.conversation_count, 5);
  assert.equal(all.excluded_conversation_count, 0);
  assert.throws(() => buildExport(sessions, groups.slice(0, 1), { ...filters, only_conversations_with_operator_reply: true }), /Load all messages/);
});

test("customer IDs are never taken from operator IDs or substituted with a session ID", () => {
  const withoutId = { session_id: "no_customer_id", meta: { data: { plan: "current-plan" } } };
  const data = buildExport([withoutId], [{ session_id: withoutId.session_id, messages }], filters);
  assert.equal(messageRows(data)[0].user_id, null);
  assert.deepEqual(JSON.parse(String(messageRows(data)[0].user_data_json)), withoutId.meta.data);
});
