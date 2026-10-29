const requiredJobs = [
  "changes",
  "lint",
  "build",
  "test",
  "test_web",
  "test_server",
  "rust",
  "mobile_native_static_analysis",
  "release_smoke",
];
const renamed = { build: ["build", "typecheck"], mobile_native_static_analysis: ["mobile_native"] };

function assertCiQuality({ results, expectedSha, full }) {
  if (!expectedSha) throw new Error("Missing candidate SHA");
  const gates = results.changes?.outputs ?? {};
  for (const name of requiredJobs) {
    if (!results[name]) throw new Error(`Missing required CI job: ${name}`);
    if (full && name !== "changes" && name !== "lint") {
      for (const gate of renamed[name] ?? [name]) {
        if (gates[gate] !== "true") throw new Error(`Full CI requires ${gate}`);
      }
    }
  }
  for (const [name, job] of Object.entries(results)) {
    if (job.result === "success") {
      if (job.outputs?.source_sha !== expectedSha)
        throw new Error(`Wrong or missing checkout SHA: ${name}`);
      continue;
    }
    if (
      !full &&
      job.result === "skipped" &&
      (renamed[name] ?? [name]).every((gate) => gates[gate] === "false")
    )
      continue;
    throw new Error(`CI job did not pass: ${name}`);
  }
}

module.exports = { assertCiQuality };

if (require.main === module) {
  const results = JSON.parse(process.env.RESULTS);
  console.log(
    Object.entries(results)
      .map(([name, job]) => `${name}: ${job.result}`)
      .join("\n"),
  );
  assertCiQuality({
    results,
    expectedSha: process.env.GITHUB_SHA,
    full: process.env.FULL_CI === "true",
  });
}
