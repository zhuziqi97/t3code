/** One identity for the server, Web bundle and every desktop package. */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

export const metadataPath = ".generated/convene-build.json";
export async function prepareBuild(root = process.cwd()) {
  const version = JSON.parse(
    await NodeFSP.readFile(NodePath.join(root, "apps/server/package.json"), "utf8"),
  ).version;
  const info = {
    build_id: process.env.GITHUB_RUN_ID
      ? `convene-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
      : `convene-local-${NodeCrypto.randomUUID()}`,
    version,
    web_mount_contract: 1,
    source_commit: NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    github_run_id: process.env.GITHUB_RUN_ID ?? "local",
  };
  await NodeFSP.mkdir(NodePath.join(root, ".generated"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(root, metadataPath), JSON.stringify(info, null, 2) + "\n");
  return info;
}

export async function exportWeb(root = process.cwd(), output = "release-web") {
  const info = JSON.parse(await NodeFSP.readFile(NodePath.join(root, metadataPath), "utf8"));
  // Export the copy actually bundled by the server, including its brand overrides.
  const source = NodePath.join(root, "apps/server/dist/client");
  const bundledInfo = JSON.parse(
    await NodeFSP.readFile(NodePath.join(source, "convene-build.json"), "utf8"),
  );
  if (JSON.stringify(info) !== JSON.stringify(bundledInfo))
    throw new Error("Web build identity mismatch");
  await NodeFSP.rm(NodePath.join(root, output), { recursive: true, force: true });
  await NodeFSP.cp(source, NodePath.join(root, output), {
    recursive: true,
    filter: (file) => !file.endsWith(".map"),
  });
  await NodeFSP.readFile(NodePath.join(root, output, ".vite/manifest.json"));
  return info;
}
if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  const command = process.argv[2];
  if (command === "prepare") console.log(JSON.stringify(await prepareBuild()));
  else if (command === "export") console.log(JSON.stringify(await exportWeb()));
  else throw new Error("Use prepare or export");
}
