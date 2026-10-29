import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import { prepareBuild, exportWeb } from "./convene-web-build.mjs";

NodeTest.test(
  "a local rebuild gets a distinct identity; exporting cannot relabel another build",
  async (t) => {
    const githubRunId = process.env.GITHUB_RUN_ID;
    delete process.env.GITHUB_RUN_ID;
    t.after(() => {
      if (githubRunId === undefined) delete process.env.GITHUB_RUN_ID;
      else process.env.GITHUB_RUN_ID = githubRunId;
    });
    const root = await NodeFSP.mkdtemp(
      NodePath.join(process.cwd(), ".generated-build-NodeTest.test-"),
    );
    t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
    await NodeFSP.mkdir(NodePath.join(root, "apps/server"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(root, "apps/server/package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    const first = await prepareBuild(root);
    const second = await prepareBuild(root);
    NodeAssert.equal(first.web_mount_contract, 1);
    NodeAssert.equal(first.version, second.version);
    NodeAssert.notEqual(first.build_id, second.build_id);
    const client = NodePath.join(root, "apps/server/dist/client");
    await NodeFSP.mkdir(NodePath.join(client, ".vite"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(client, ".vite/manifest.json"), "{}");
    await NodeFSP.writeFile(NodePath.join(client, "convene-build.json"), JSON.stringify(first));
    await NodeAssert.rejects(exportWeb(root), /identity mismatch/);
    await NodeFSP.writeFile(NodePath.join(client, "convene-build.json"), JSON.stringify(second));
    await exportWeb(root);
    NodeAssert.deepEqual(
      JSON.parse(await NodeFSP.readFile(NodePath.join(root, "release-web/convene-build.json"))),
      second,
    );
  },
);
