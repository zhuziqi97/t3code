import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { prepareBuild, exportWeb } from "./convene-web-build.mjs";

test("a rebuilt version gets a distinct identity; exporting cannot relabel another build", async (t) => {
  const root = await mkdtemp(join(process.cwd(), ".generated-build-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "apps/server"), { recursive: true });
  await writeFile(join(root, "apps/server/package.json"), JSON.stringify({ version: "1.0.0" }));
  const first = await prepareBuild(root);
  const second = await prepareBuild(root);
  assert.equal(first.version, second.version);
  assert.notEqual(first.build_id, second.build_id);
  const client = join(root, "apps/server/dist/client");
  await mkdir(join(client, ".vite"), { recursive: true });
  await writeFile(join(client, ".vite/manifest.json"), "{}");
  await writeFile(join(client, "convene-build.json"), JSON.stringify(first));
  await assert.rejects(exportWeb(root), /identity mismatch/);
  await writeFile(join(client, "convene-build.json"), JSON.stringify(second));
  await exportWeb(root);
  assert.deepEqual(
    JSON.parse(await readFile(join(root, "release-web/convene-build.json"))),
    second,
  );
});
