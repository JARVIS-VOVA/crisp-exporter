import { test } from "node:test";
import assert from "node:assert/strict";
import { isOperatorReply, loadConversationMessages, parseConversations } from "./crisp";

test("pagination reads short and overlapping batches until empty, preserving repeated text", async () => {
  const batches = [
    [{ fingerprint: 4, timestamp: 4000, content: "same" }, { fingerprint: 3, timestamp: 3000, content: "same" }],
    [{ fingerprint: 3, timestamp: 3000, content: "same" }, { fingerprint: 2, timestamp: 2000, content: "same" }],
    [{ fingerprint: 1, timestamp: 1001, content: "oldest" }],
    [],
  ];
  const cursors: (number | undefined)[] = [];
  const messages = await loadConversationMessages(async before => {
    cursors.push(before);
    return batches.shift();
  });
  assert.deepEqual(cursors, [undefined, 3000, 2000, 1001]);
  assert.deepEqual(messages.map(message => message.fingerprint), [1, 2, 3, 4]);
  assert.equal(messages.filter(message => message.content === "same").length, 3);
});

test("equal timestamps retain source order and messages without IDs are not discarded", async () => {
  const batch = [{ timestamp: 0, content: "first" }, { timestamp: 0, content: "second" }];
  let calls = 0;
  const messages = await loadConversationMessages(async before => {
    if (++calls === 1) return batch;
    assert.equal(before, 0);
    return [];
  });
  assert.deepEqual(messages, batch);
});

test("repeated pages and malformed responses fail instead of returning partial history", async () => {
  await assert.rejects(loadConversationMessages(async () => [{ timestamp: 1 }]), /did not advance/);
  for (const invalid of [undefined, {}, [{ content: "missing time" }], [{ timestamp: NaN }], [{ timestamp: 8.65e15 }]]) {
    await assert.rejects(loadConversationMessages(async () => invalid), /invalid/);
  }
  let calls = 0;
  await assert.rejects(loadConversationMessages(async () => {
    if (++calls === 1) return [{ timestamp: 1 }];
    throw new Error("API unavailable");
  }), /API unavailable/);
  assert.throws(() => parseConversations({ error: "not an array" }), /invalid/);
});

test("operator replies accept omitted automated flags and exclude explicitly automated messages", () => {
  const reply = { timestamp: 1, from: "operator", type: "text", automated: false, content: "Thanks" };
  assert.equal(isOperatorReply(reply), true);
  const withoutFlag = { timestamp: 1, from: "operator", type: "text", content: "Thanks", user: { user_id: "operator_1", nickname: "Adam" } };
  assert.equal(isOperatorReply(withoutFlag), true);
  assert.equal(isOperatorReply({ ...reply, automated: undefined }), true);
  assert.equal(isOperatorReply({ ...reply, type: "file", content: { url: "https://example.test/file.pdf" } }), true);
  assert.equal(isOperatorReply({ ...reply, type: "audio", content: { url: "https://example.test/voice.ogg" } }), true);
  for (const patch of [
    { automated: true }, { from: "user" },
    { type: "note" }, { type: "event" }, { type: undefined },
    { stealth: true }, { content: " \r\n " }, { content: {} },
    { type: "file", content: { name: "missing-url" } },
  ]) {
    assert.equal(isOperatorReply({ ...reply, ...patch }), false);
  }
});
