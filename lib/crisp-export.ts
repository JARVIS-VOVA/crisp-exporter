import * as XLSX from "xlsx";
import { asObject, isOperatorReply, type CrispConversation, type CrispMessage, type ConversationMessages } from "./crisp";

type Cell = string | number | boolean | null;
export type ExportRow = Record<string, Cell>;
export interface ExportFilters {
  conversation_updated_from: string | null;
  conversation_updated_to: string | null;
  only_conversations_with_operator_reply?: boolean;
}

export interface SpreadsheetExportOptions {
  includeRaw?: boolean;
}

const stringOrNull = (value: unknown) => typeof value === "string" ? value : null;
const json = (value: unknown) => JSON.stringify(value ?? null);

function customerId(conversation: CrispConversation): string | null {
  const id = asObject(asObject(conversation.meta).data).user_id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function normalizeMessage(sessionId: string, message: CrispMessage, index: number) {
  const content = asObject(message.content);
  const user = asObject(message.user);
  const isAttachment = ["file", "animation", "audio"].includes(message.type ?? "");
  const fileType = stringOrNull(content.type);
  const text = typeof message.content === "string" ? message.content
    : stringOrNull(content.text) ?? (isAttachment
      ? fileType?.startsWith("image/") ? "[image]" : `[${message.type}]`
      : "");

  return {
    session_id: sessionId,
    message_id: message.fingerprint ?? null,
    message_index: index + 1,
    timestamp_ms: message.timestamp,
    timestamp_iso: new Date(message.timestamp).toISOString(),
    from: message.from ?? null,
    operator_id: message.from === "operator" ? stringOrNull(user.user_id) : null,
    operator_name: message.from === "operator" ? stringOrNull(user.nickname) : null,
    sender_id: stringOrNull(user.user_id),
    sender_name: stringOrNull(user.nickname),
    automated: typeof message.automated === "boolean" ? message.automated : null,
    type: message.type ?? null,
    origin: message.origin ?? null,
    text,
    text_clean: text.replace(/_x000d_/gi, "\r").replace(/\r\n?/g, "\n"),
    file_url: isAttachment ? stringOrNull(content.url) : null,
    file_name: isAttachment ? stringOrNull(content.name) : null,
    file_mime_type: isAttachment ? fileType : null,
    attachments: isAttachment ? [message.content] : [],
    content: message.content ?? null,
    raw: message,
  };
}

export function buildExport(
  conversations: CrispConversation[],
  groups: ConversationMessages[],
  filters: ExportFilters,
  exportedAt = new Date().toISOString(),
) {
  const bySession = new Map(groups.map(group => [group.session_id, group.messages]));
  if (bySession.size !== conversations.length || groups.length !== conversations.length
    || conversations.some(conversation => !bySession.has(conversation.session_id))) {
    throw new Error("Load all messages for the current conversations before exporting.");
  }
  const selected = filters.only_conversations_with_operator_reply
    ? conversations.filter(conversation => bySession.get(conversation.session_id)!.some(isOperatorReply))
    : conversations;
  const data = selected.map(conversation => ({
    session_id: conversation.session_id,
    user_id: customerId(conversation),
    raw: conversation,
    messages: [...bySession.get(conversation.session_id)!]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((message, index) => normalizeMessage(conversation.session_id, message, index)),
  }));
  return {
    schema_version: 1,
    exported_at: exportedAt,
    filters,
    source_conversation_count: conversations.length,
    excluded_conversation_count: conversations.length - data.length,
    conversation_count: data.length,
    message_count: data.reduce((count, conversation) => count + conversation.messages.length, 0),
    conversations: data,
  };
}

export type CrispExport = ReturnType<typeof buildExport>;

export const MESSAGE_COLUMNS = [
  "session_id", "message_id", "message_index", "timestamp_ms", "timestamp_iso", "from",
  "operator_id", "operator_name", "sender_id", "sender_name", "automated", "type", "origin",
  "text", "text_clean", "file_url", "file_name", "file_mime_type", "attachments_json",
  "user_id", "user_email", "user_nickname", "user_locales_json", "user_segments_json", "user_data_json",
] as const;

export function messageColumns(options: SpreadsheetExportOptions = {}): readonly string[] {
  return options.includeRaw
    ? [...MESSAGE_COLUMNS, "conversation_meta_json", "conversation_raw_json", "content_json", "raw_message_json"]
    : MESSAGE_COLUMNS;
}

export function messageRows(data: CrispExport, options: SpreadsheetExportOptions = {}): ExportRow[] {
  return data.conversations.flatMap(conversation => {
    const meta = asObject(conversation.raw.meta);
    return conversation.messages.map(message => ({
      session_id: message.session_id,
      message_id: message.message_id,
      message_index: message.message_index,
      timestamp_ms: message.timestamp_ms,
      timestamp_iso: message.timestamp_iso,
      from: message.from,
      operator_id: message.operator_id,
      operator_name: message.operator_name,
      sender_id: message.sender_id,
      sender_name: message.sender_name,
      automated: message.automated,
      type: message.type,
      origin: message.origin,
      text: message.text,
      text_clean: message.text_clean,
      file_url: message.file_url,
      file_name: message.file_name,
      file_mime_type: message.file_mime_type,
      attachments_json: json(message.attachments),
      user_id: conversation.user_id,
      user_email: stringOrNull(meta.email),
      user_nickname: stringOrNull(meta.nickname),
      user_locales_json: json(asObject(meta.device).locales),
      user_segments_json: json(meta.segments),
      user_data_json: json(meta.data),
      ...(options.includeRaw ? {
        conversation_meta_json: json(meta),
        conversation_raw_json: json(conversation.raw),
        content_json: json(message.content),
        raw_message_json: json(message.raw),
      } : {}),
    }));
  });
}

/** RFC 4180: quoting preserves commas, quotes and multiline Unicode text. */
export function toCsv(rows: ExportRow[], columns: readonly string[] = MESSAGE_COLUMNS): string {
  const quote = (value: Cell | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return "\uFEFF" + [columns.map(quote).join(","),
    ...rows.map(row => columns.map(column => quote(row[column])).join(",")),
  ].join("\r\n") + "\r\n";
}

// SheetJS 0.18 interprets literal OOXML escapes on read but does not escape them
// on write. Protect them explicitly, and split only between complete codepoints
// or escape tokens so Excel's cell limit cannot damage text or emoji.
function escapeExcelText(value: string): string {
  return value.replace(/_x[\da-f]{4}_/gi, token => `_x005f_${token.slice(1)}`);
}

function excelTextParts(value: string): string[] {
  if (value.length <= 16000) return [value];
  const parts: string[] = [];
  let chunk = "";
  let encodedLength = 0;
  for (const [token] of value.matchAll(/_x[\da-f]{4}_|[\s\S]/giu)) {
    const length = token.length === 7 ? 13 : token.length;
    if (encodedLength + length > 32767) {
      parts.push(chunk);
      chunk = "";
      encodedLength = 0;
    }
    chunk += token;
    encodedLength += length;
  }
  parts.push(chunk);
  return parts;
}

export function toWorkbook(data: CrispExport, options: SpreadsheetExportOptions = {}): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const overflow: ExportRow[] = [];
  const addSheet = (name: string, rows: ExportRow[], columns?: readonly string[]) => {
    const safeRows = rows.map((row, index) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      // Retain long cell remainders in an indexed sheet (Excel's text limit).
      if (typeof value !== "string") return [key, value];
      const parts = excelTextParts(value);
      parts.slice(1).forEach((part, partIndex) => {
        overflow.push({ sheet: name, row: index + 2, column: key, part: partIndex + 2, value: part });
      });
      return [key, escapeExcelText(parts[0])];
    })));
    const sheet = XLSX.utils.json_to_sheet(safeRows, columns ? { header: [...columns] } : undefined);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };

  addSheet("Messages", messageRows(data, options), messageColumns(options));
  addSheet("Conversations", data.conversations.map(conversation => ({
    session_id: conversation.session_id,
    user_id: conversation.user_id,
    message_count: conversation.messages.length,
    user_email: stringOrNull(asObject(conversation.raw.meta).email),
    ...(options.includeRaw ? { conversation_raw_json: json(conversation.raw) } : {}),
  })));
  addSheet("Export Info", [{
    schema_version: data.schema_version,
    exported_at: data.exported_at,
    conversation_count: data.conversation_count,
    source_conversation_count: data.source_conversation_count,
    excluded_conversation_count: data.excluded_conversation_count,
    message_count: data.message_count,
    include_raw_columns: options.includeRaw ?? false,
    ...data.filters,
    long_cell_storage: "Long cells: first part in the original cell; remaining parts in Cell Overflow, ordered by part. Row is the 1-based worksheet row including header. Concatenate parts to recover the full value.",
  }]);
  if (overflow.length) addSheet("Cell Overflow", overflow);
  return workbook;
}

export function downloadText(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
