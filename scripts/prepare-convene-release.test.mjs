import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeTest from "node:test";
import { prepareConveneRelease } from "./prepare-convene-release.mjs";

async function fixture(t) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "convene-release-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const artifacts = NodePath.join(root, "actions");
  const output = NodePath.join(root, "published");
  const version = "0.0.45-convene.23";
  const files = [
    ["desktop-linux-x64", `T3-Code-for-Convene-${version}-amd64.deb`],
    ["desktop-linux-x64", `T3-Code-for-Convene-${version}-x86_64.AppImage`],
    ["desktop-win-x64", `T3-Code-for-Convene-${version}-x64.exe`],
    ["desktop-mac-arm64", `T3-Code-for-Convene-${version}-arm64.dmg`],
  ];
  for (const [artifact, name] of files) {
    await NodeFSP.mkdir(NodePath.join(artifacts, artifact), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(artifacts, artifact, name), name);
  }
  const build = {
    build_id: "convene-123-1",
    version,
    source_commit: "accepted-commit",
    github_run_id: "123",
  };
  for (const directory of ["convene-web", ...new Set(files.map(([dir]) => dir))]) {
    await NodeFSP.mkdir(NodePath.join(artifacts, directory), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(artifacts, directory, "convene-build.json"),
      JSON.stringify(build),
    );
  }
  return { artifacts, output, version, commit: "accepted-commit", runId: "123", files };
}

NodeTest.test(
  "collects four packages with metadata usable by the platform publisher",
  async (t) => {
    const input = await fixture(t);
    await NodeFSP.writeFile(
      NodePath.join(input.artifacts, "desktop-mac-arm64", "unused-updater.zip"),
      "ignored",
    );
    await prepareConveneRelease(input);
    const linux = JSON.parse(
      await NodeFSP.readFile(NodePath.join(input.output, "linux-x64", "build-info.json"), "utf8"),
    );
    NodeAssert.equal(linux.product, "T3 Code for Convene");
    NodeAssert.equal(linux.source_commit, input.commit);
    NodeAssert.equal(linux.github_run_id, input.runId);
    NodeAssert.deepEqual(linux.integration_protocols, [{ major: 1, max_minor: 0 }]);
    NodeAssert.deepEqual(
      linux.packages.map((p) => p.format),
      ["deb", "appimage"],
    );
    const mac = JSON.parse(
      await NodeFSP.readFile(NodePath.join(input.output, "macos-arm64", "build-info.json"), "utf8"),
    );
    NodeAssert.equal(mac.packages.length, 1);
    for (const [artifact, name] of input.files) {
      const platform = artifact
        .replace("desktop-win-", "windows-")
        .replace("desktop-mac-", "macos-")
        .replace("desktop-", "");
      NodeAssert.equal(
        await NodeFSP.readFile(NodePath.join(input.output, platform, name), "utf8"),
        name,
      );
    }
  },
);

NodeTest.test("missing AppImage rejects before emitting a partial publication", async (t) => {
  const input = await fixture(t);
  await NodeFSP.unlink(NodePath.join(input.artifacts, ...input.files[1]));
  await NodeAssert.rejects(prepareConveneRelease(input), /expected one/);
  await NodeAssert.rejects(
    NodeFSP.readFile(NodePath.join(input.output, "linux-x64", "build-info.json")),
    {
      code: "ENOENT",
    },
  );
});

NodeTest.test("mixed versions cannot be labelled as one accepted candidate", async (t) => {
  const input = await fixture(t);
  await NodeAssert.rejects(
    prepareConveneRelease({ ...input, version: "0.0.45-convene.24" }),
    /Web build metadata/,
  );
});

NodeTest.test("rejects a desktop package built against a different Web", async (t) => {
  const input = await fixture(t);
  await NodeFSP.writeFile(
    NodePath.join(input.artifacts, "desktop-win-x64", "convene-build.json"),
    JSON.stringify({ build_id: "other" }),
  );
  await NodeAssert.rejects(prepareConveneRelease(input), /Web build mismatch/);
});
