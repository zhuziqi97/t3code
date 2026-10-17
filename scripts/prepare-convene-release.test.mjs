import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { prepareConveneRelease } from "./prepare-convene-release.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "convene-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = join(root, "actions");
  const output = join(root, "published");
  const version = "0.0.45-convene.23";
  const files = [
    ["desktop-linux-x64", `T3-Code-for-Convene-${version}-amd64.deb`],
    ["desktop-linux-x64", `T3-Code-for-Convene-${version}-x86_64.AppImage`],
    ["desktop-win-x64", `T3-Code-for-Convene-${version}-x64.exe`],
    ["desktop-mac-arm64", `T3-Code-for-Convene-${version}-arm64.dmg`],
  ];
  for (const [artifact, name] of files) {
    await mkdir(join(artifacts, artifact), { recursive: true });
    await writeFile(join(artifacts, artifact, name), name);
  }
  const build = {
    build_id: "convene-123-1",
    version,
    source_commit: "accepted-commit",
    github_run_id: "123",
  };
  for (const directory of ["convene-web", ...new Set(files.map(([dir]) => dir))]) {
    await mkdir(join(artifacts, directory), { recursive: true });
    await writeFile(join(artifacts, directory, "convene-build.json"), JSON.stringify(build));
  }
  return { artifacts, output, version, commit: "accepted-commit", runId: "123", files };
}

test("collects four packages with metadata usable by the platform publisher", async (t) => {
  const input = await fixture(t);
  await writeFile(join(input.artifacts, "desktop-mac-arm64", "unused-updater.zip"), "ignored");
  await prepareConveneRelease(input);
  const linux = JSON.parse(
    await readFile(join(input.output, "linux-x64", "build-info.json"), "utf8"),
  );
  assert.equal(linux.product, "T3 Code for Convene");
  assert.equal(linux.source_commit, input.commit);
  assert.equal(linux.github_run_id, input.runId);
  assert.deepEqual(linux.integration_protocols, [{ major: 1, max_minor: 0 }]);
  assert.deepEqual(
    linux.packages.map((p) => p.format),
    ["deb", "appimage"],
  );
  const mac = JSON.parse(
    await readFile(join(input.output, "macos-arm64", "build-info.json"), "utf8"),
  );
  assert.equal(mac.packages.length, 1);
  for (const [artifact, name] of input.files) {
    const platform = artifact
      .replace("desktop-win-", "windows-")
      .replace("desktop-mac-", "macos-")
      .replace("desktop-", "");
    assert.equal(await readFile(join(input.output, platform, name), "utf8"), name);
  }
});

test("missing AppImage rejects before emitting a partial publication", async (t) => {
  const input = await fixture(t);
  await unlink(join(input.artifacts, ...input.files[1]));
  await assert.rejects(prepareConveneRelease(input), /expected one/);
  await assert.rejects(readFile(join(input.output, "linux-x64", "build-info.json")), {
    code: "ENOENT",
  });
});

test("mixed versions cannot be labelled as one accepted candidate", async (t) => {
  const input = await fixture(t);
  await assert.rejects(
    prepareConveneRelease({ ...input, version: "0.0.45-convene.24" }),
    /Web build metadata/,
  );
});

test("rejects a desktop package built against a different Web", async (t) => {
  const input = await fixture(t);
  await writeFile(
    join(input.artifacts, "desktop-win-x64", "convene-build.json"),
    JSON.stringify({ build_id: "other" }),
  );
  await assert.rejects(prepareConveneRelease(input), /Web build mismatch/);
});
