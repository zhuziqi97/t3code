const assert = require("node:assert/strict");
const test = require("node:test");
const { assertCiQuality } = require("./check-ci-quality.cjs");

const sha = "33b3a92fd9651408b24824e08927ba4f70fc801e";
function fixture() {
  const results = Object.fromEntries(
    [
      "changes",
      "lint",
      "build",
      "test",
      "test_web",
      "test_server",
      "rust",
      "mobile_native_static_analysis",
      "release_smoke",
    ].map((name) => [name, { result: "success", outputs: { source_sha: sha } }]),
  );
  results.changes.outputs = {
    source_sha: sha,
    build: "true",
    typecheck: "true",
    test: "true",
    test_web: "true",
    test_server: "true",
    rust: "true",
    mobile_native: "true",
    release_smoke: "true",
  };
  return { results, expectedSha: sha, full: true };
}

test("accepts all required jobs succeeding on the checked out candidate", () => {
  assert.doesNotThrow(() => assertCiQuality(fixture()));
});
test("rejects failed, cancelled, queued and unrun required work", () => {
  for (const result of ["failure", "cancelled", "queued", "in_progress", ""]) {
    const input = fixture();
    input.results.test_server.result = result;
    assert.throws(() => assertCiQuality(input));
  }
});
test("rejects a missing required job even when the remaining jobs succeeded", () => {
  const input = fixture();
  delete input.results.test_web;
  assert.throws(() => assertCiQuality(input));
});
test("rejects every required skipped job in a full run even if change detection excludes it", () => {
  const input = fixture();
  input.results.test_web.result = "skipped";
  input.results.changes.outputs.test_web = "false";
  assert.throws(() => assertCiQuality(input));
});
test("rejects a successful job that skipped the full server suite internally", () => {
  const input = fixture();
  input.results.changes.outputs.test_server = "false";
  assert.throws(() => assertCiQuality(input));
});
test("rejects successful jobs from a different checkout", () => {
  const input = fixture();
  input.results.test_server.outputs.source_sha = "70693ad5b633befb18c290ae6187eac9b22c1305";
  assert.throws(() => assertCiQuality(input));
});
test("rejects success without checkout provenance", () => {
  const input = fixture();
  delete input.results.lint.outputs.source_sha;
  assert.throws(() => assertCiQuality(input));
});
test("rejects a run without its candidate identity", () => {
  const input = fixture();
  input.expectedSha = "";
  assert.throws(() => assertCiQuality(input));
});
test("preserves a PR's explicitly unaffected test job", () => {
  const input = fixture();
  input.full = false;
  input.results.test_web = { result: "skipped", outputs: {} };
  input.results.changes.outputs.test_web = "false";
  assert.doesNotThrow(() => assertCiQuality(input));
});
test("requires both build and typecheck to be unaffected before a PR can skip their job", () => {
  const input = fixture();
  input.full = false;
  input.results.build = { result: "skipped", outputs: {} };
  input.results.changes.outputs.build = "false";
  assert.throws(() => assertCiQuality(input));
  input.results.changes.outputs.typecheck = "false";
  assert.doesNotThrow(() => assertCiQuality(input));
});
