export type CrispObject = Record<string, unknown>;

export interface CrispConversation extends CrispObject {
  session_id: string;
  meta?: CrispObject;
}

export interface CrispMessage extends CrispObject {
  timestamp: number;
  fingerprint?: number | string;
  from?: string;
  type?: string;
  origin?: string;
  automated?: boolean;
  content?: unknown;
  user?: CrispObject;
}

export interface ConversationMessages {
  session_id: string;
  messages: CrispMessage[];
}

/** Crisp may omit automated on operator replies; only explicit true excludes one. */
export function isOperatorReply(message: CrispMessage): boolean {
  if (message.from !== "operator" || message.automated === true || message.stealth === true) return false;
  if (!["text", "file", "animation", "audio", "picker", "field", "carousel"].includes(message.type ?? "")) return false;
  if (typeof message.content === "string") return message.content.trim().length > 0;
  const content = asObject(message.content);
  if (["file", "animation", "audio"].includes(message.type ?? "")) {
    return typeof content.url === "string" && content.url.trim().length > 0;
  }
  return message.type !== "text" && Object.keys(content).length > 0;
}

export function asObject(value: unknown): CrispObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as CrispObject
    : {};
}

export function parseConversations(data: unknown): CrispConversation[] {
  if (!Array.isArray(data) || !data.every(item =>
    typeof asObject(item).session_id === "string" && asObject(item).session_id !== ""
  )) {
    throw new Error("Crisp returned an invalid conversation list. Export stopped.");
  }
  return data;
}

export function parseMessages(data: unknown): CrispMessage[] {
  if (!Array.isArray(data) || !data.every(item => {
    const timestamp = asObject(item).timestamp;
    return typeof timestamp === "number" && Number.isSafeInteger(timestamp)
      && Math.abs(timestamp) <= 8.64e15;
  })) {
    throw new Error("Crisp returned messages with an invalid timestamp or format. Export stopped.");
  }
  return data;
}

export interface MessageCheckpoint {
  messages: CrispMessage[];
  timestampBefore?: number;
  pages: number;
  complete: boolean;
}

export function createMessageCheckpoint(): MessageCheckpoint {
  return { messages: [], pages: 0, complete: false };
}

/** Commit each successful batch so a failed request can resume at the same cursor. */
export async function loadConversationMessages(
  fetchBatch: (timestampBefore?: number) => Promise<unknown>,
  onBatch?: (page: number, count: number) => void,
  checkpoint: MessageCheckpoint = createMessageCheckpoint(),
): Promise<CrispMessage[]> {
  const messages = checkpoint.messages;
  const seen = new Set(messages.flatMap(message =>
    message.fingerprint == null ? [] : [String(message.fingerprint)]
  ));

  while (!checkpoint.complete) {
    const before = checkpoint.timestampBefore;
    const batch = parseMessages(await fetchBatch(before));
    if (batch.length === 0) {
      checkpoint.complete = true;
      break;
    }

    const oldest = batch.reduce((min, message) => Math.min(min, message.timestamp), Infinity);
    if (before !== undefined && oldest >= before) {
      throw new Error("Crisp message pagination did not advance. Export stopped to avoid an incomplete history.");
    }
    for (const message of batch) {
      // Never deduplicate by content: repeated replies may be legitimate.
      if (message.fingerprint !== undefined && message.fingerprint !== null) {
        const key = String(message.fingerprint);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      messages.push(message);
    }
    checkpoint.timestampBefore = oldest;
    checkpoint.pages++;
    onBatch?.(checkpoint.pages, messages.length);
  }

  // Stable sort retains source order for equal millisecond timestamps.
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}
