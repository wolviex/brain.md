import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyQueueState, enqueueCommits, markHandled, isHandled } from "../src/capture/queue";
import type { CapturedCommit } from "../src/capture/filter";

function commit(sha: string): CapturedCommit {
  return { sha, subject: sha, body: sha, author: "someone", date: new Date().toISOString(), files: ["src/a.ts"] };
}

test("enqueueCommits adds new commits to pending", () => {
  const state = enqueueCommits(emptyQueueState(), [commit("a"), commit("b")]);
  assert.deepEqual(state.pending.map((c) => c.sha), ["a", "b"]);
});

test("enqueueCommits skips a commit already pending", () => {
  let state = enqueueCommits(emptyQueueState(), [commit("a")]);
  state = enqueueCommits(state, [commit("a"), commit("b")]);
  assert.deepEqual(state.pending.map((c) => c.sha), ["a", "b"]);
});

test("enqueueCommits never re-adds a handled commit", () => {
  let state = enqueueCommits(emptyQueueState(), [commit("a")]);
  state = markHandled(state, ["a"]);
  state = enqueueCommits(state, [commit("a"), commit("b")]);
  assert.deepEqual(state.pending.map((c) => c.sha), ["b"]);
});

test("markHandled removes commits from pending and records them as handled", () => {
  let state = enqueueCommits(emptyQueueState(), [commit("a"), commit("b")]);
  state = markHandled(state, ["a"]);
  assert.deepEqual(state.pending.map((c) => c.sha), ["b"]);
  assert.equal(isHandled(state, "a"), true);
  assert.equal(isHandled(state, "b"), false);
});

test("enqueueCommits bounds pending to the most recent 200", () => {
  const many = Array.from({ length: 250 }, (_, i) => commit(`sha-${i}`));
  const state = enqueueCommits(emptyQueueState(), many);
  assert.equal(state.pending.length, 200);
  assert.equal(state.pending[0]?.sha, "sha-50");
  assert.equal(state.pending[199]?.sha, "sha-249");
});

test("markHandled bounds handledShas to the most recent 500", () => {
  let state = emptyQueueState();
  for (let batch = 0; batch < 6; batch++) {
    const shas = Array.from({ length: 100 }, (_, i) => `batch${batch}-${i}`);
    state = markHandled(state, shas);
  }
  assert.equal(state.handledShas.length, 500);
  assert.equal(isHandled(state, "batch0-0"), false); // fell off the front
  assert.equal(isHandled(state, "batch5-99"), true);
});
