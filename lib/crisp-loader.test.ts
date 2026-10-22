import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createConversationsCheckpoint, createMessagesCheckpoint,
  loadedMessageGroups, loadAllConversationMessages, loadConversations,
} from "./crisp-loader";

test("conversation loading resumes at the failed page and retains previous metadata", async () => {
  const checkpoint = createConversationsCheckpoint();
  const calls: number[] = [];
  let limited = true;
  const fetchPage = async (page: number) => {
    calls.push(page);
    if (page === 1) return [{ session_id: "a", meta: { data: { plan: "pro" } } }];
    if (limited) throw new Error("quota_exceeded");
    if (page === 2) return [{ session_id: "a" }, { session_id: "b" }];
    return [];
  };
  await assert.rejects(loadConversations(checkpoint, fetchPage), /quota_exceeded/);
  assert.equal(checkpoint.nextPage, 2);
  assert.equal(checkpoint.complete, false);
  assert.deepEqual(checkpoint.conversations, [{ session_id: "a", meta: { data: { plan: "pro" } } }]);
  limited = false;
  const result = await loadConversations(checkpoint, fetchPage);
  assert.deepEqual(calls, [1, 2, 2, 3]);
  assert.deepEqual(result.map(item => item.session_id), ["a", "b"]);
  assert.equal(checkpoint.complete, true);
  await loadConversations(checkpoint, fetchPage);
  assert.deepEqual(calls, [1, 2, 2, 3], "completed loads do not repeat requests");
});

test("message loading survives repeated quota pauses inside a conversation without restarting history", async () => {
  const conversations = [{ session_id: "a" }, { session_id: "b" }];
  const checkpoint = createMessagesCheckpoint();
  const calls: [string, number | undefined][] = [];
  let limited = true;
  const fetchBatch = async (sessionId: string, before?: number) => {
    calls.push([sessionId, before]);
    if (sessionId === "a") return before === undefined ? [{ fingerprint: 1, timestamp: 100 }] : [];
    if (before === undefined) return [{ fingerprint: 3, timestamp: 300 }, { fingerprint: 2, timestamp: 200 }];
    if (limited) throw new Error("quota_exceeded");
    return before === 200 ? [{ fingerprint: 2, timestamp: 200 }, { fingerprint: 4, timestamp: 100 }] : [];
  };
  await assert.rejects(loadAllConversationMessages(conversations, checkpoint, fetchBatch), /quota_exceeded/);
  assert.equal(checkpoint.conversationIndex, 1);
  assert.equal(checkpoint.completed.length, 1);
  assert.equal(checkpoint.current.timestampBefore, 200);
  assert.equal(checkpoint.current.pages, 1);
  const partial = loadedMessageGroups(checkpoint, conversations);
  assert.deepEqual(partial.map(group => group.messages.length), [1, 2]);
  await assert.rejects(loadAllConversationMessages(conversations, checkpoint, fetchBatch), /quota_exceeded/);
  assert.deepEqual(loadedMessageGroups(checkpoint, conversations), partial);
  limited = false;
  const result = await loadAllConversationMessages(conversations, checkpoint, fetchBatch);
  assert.equal(checkpoint.complete, true);
  assert.deepEqual(calls, [["a", undefined], ["a", 100], ["b", undefined], ["b", 200], ["b", 200], ["b", 200], ["b", 100]]);
  assert.deepEqual(result[0].messages.map(message => message.fingerprint), [1]);
  assert.deepEqual(result[1].messages.map(message => message.fingerprint), [4, 2, 3]);
  await loadAllConversationMessages(conversations, checkpoint, fetchBatch);
  assert.equal(calls.length, 7);
  assert.equal(checkpoint.completed.length, 2);
});

test("a failed final batch stays pending until an empty response confirms completion", async () => {
  const conversations = [{ session_id: "a" }];
  const checkpoint = createMessagesCheckpoint();
  let calls = 0;
  await assert.rejects(loadAllConversationMessages(conversations, checkpoint, async () => {
    if (++calls === 1) return [{ timestamp: 100, content: "kept even without fingerprint" }];
    throw new Error("network error");
  }), /network error/);
  assert.equal(checkpoint.complete, false);
  assert.equal(checkpoint.current.complete, false);
  assert.equal(checkpoint.completed.length, 0);
  const result = await loadAllConversationMessages(conversations, checkpoint, async (sessionId, before) => {
    assert.equal(sessionId, "a");
    assert.equal(before, 100);
    return [];
  });
  assert.equal(result[0].messages.length, 1);
  assert.equal(checkpoint.complete, true);
});

test("invalid message batches do not overwrite the last successful cursor or saved messages", async () => {
  const conversations = [{ session_id: "a" }];
  const checkpoint = createMessagesCheckpoint();
  await assert.rejects(loadAllConversationMessages(conversations, checkpoint, async (sessionId, before) => {
    assert.equal(sessionId, "a");
    return before === undefined ? [{ timestamp: 200, fingerprint: 2 }] : [{ content: "missing timestamp" }];
  }), /invalid/);
  assert.equal(checkpoint.current.timestampBefore, 200);
  assert.deepEqual(checkpoint.current.messages, [{ timestamp: 200, fingerprint: 2 }]);
  const result = await loadAllConversationMessages(conversations, checkpoint, async (sessionId, before) => {
    assert.equal(sessionId, "a");
    return before === 200 ? [{ timestamp: 100, fingerprint: 1 }] : [];
  });
  assert.deepEqual(result[0].messages.map(message => message.fingerprint), [1, 2]);
});

test("empty completed conversations are not re-fetched when the next conversation fails", async () => {
  const conversations = [{ session_id: "empty" }, { session_id: "next" }];
  const checkpoint = createMessagesCheckpoint();
  await assert.rejects(loadAllConversationMessages(conversations, checkpoint, async sessionId => {
    if (sessionId === "empty") return [];
    throw new Error("quota_exceeded");
  }), /quota_exceeded/);
  assert.equal(checkpoint.conversationIndex, 1);
  assert.deepEqual(checkpoint.completed, [{ session_id: "empty", messages: [] }]);
  const result = await loadAllConversationMessages(conversations, checkpoint, async sessionId => {
    assert.equal(sessionId, "next");
    return [];
  });
  assert.deepEqual(result.map(group => group.session_id), ["empty", "next"]);
});
