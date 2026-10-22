import {
  createMessageCheckpoint, loadConversationMessages, parseConversations,
  type ConversationMessages, type CrispConversation, type MessageCheckpoint,
} from "./crisp";

export interface ConversationsCheckpoint {
  conversations: CrispConversation[];
  nextPage: number;
  complete: boolean;
}

export function createConversationsCheckpoint(): ConversationsCheckpoint {
  return { conversations: [], nextPage: 1, complete: false };
}

export async function loadConversations(
  checkpoint: ConversationsCheckpoint,
  fetchPage: (page: number) => Promise<unknown>,
  onProgress?: () => void,
): Promise<CrispConversation[]> {
  const bySession = new Map(checkpoint.conversations.map(conversation => [conversation.session_id, conversation]));
  while (!checkpoint.complete) {
    onProgress?.();
    const batch = parseConversations(await fetchPage(checkpoint.nextPage));
    if (!batch.length) {
      checkpoint.complete = true;
      break;
    }
    if (batch.every(conversation => bySession.has(conversation.session_id))) {
      throw new Error("Crisp conversation pagination did not advance. Progress is saved; you can retry or reset the load.");
    }
    for (const conversation of batch) bySession.set(conversation.session_id, conversation);
    checkpoint.conversations = [...bySession.values()];
    checkpoint.nextPage++;
    onProgress?.();
  }
  return checkpoint.conversations;
}

export interface MessagesCheckpoint {
  completed: ConversationMessages[];
  conversationIndex: number;
  current: MessageCheckpoint;
  complete: boolean;
}

export function createMessagesCheckpoint(): MessagesCheckpoint {
  return { completed: [], conversationIndex: 0, current: createMessageCheckpoint(), complete: false };
}

/** Include the current partial conversation for counters and clipboard recovery. */
export function loadedMessageGroups(checkpoint: MessagesCheckpoint, conversations: CrispConversation[]): ConversationMessages[] {
  const conversation = conversations[checkpoint.conversationIndex];
  return [
    ...checkpoint.completed,
    ...(conversation && checkpoint.current.messages.length ? [{
      session_id: conversation.session_id,
      messages: [...checkpoint.current.messages],
    }] : []),
  ];
}

export async function loadAllConversationMessages(
  conversations: CrispConversation[],
  checkpoint: MessagesCheckpoint,
  fetchBatch: (sessionId: string, timestampBefore?: number) => Promise<unknown>,
  onProgress?: () => void,
): Promise<ConversationMessages[]> {
  while (checkpoint.conversationIndex < conversations.length) {
    const conversation = conversations[checkpoint.conversationIndex];
    onProgress?.();
    const messages = await loadConversationMessages(
      before => fetchBatch(conversation.session_id, before),
      () => onProgress?.(),
      checkpoint.current,
    );
    checkpoint.completed.push({ session_id: conversation.session_id, messages });
    checkpoint.conversationIndex++;
    checkpoint.current = createMessageCheckpoint();
    onProgress?.();
  }
  checkpoint.complete = true;
  return checkpoint.completed;
}
