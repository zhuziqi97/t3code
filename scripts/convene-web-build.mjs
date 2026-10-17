/** One identity for the server, Web bundle and every desktop package. */
import { mkdir, readFile, cp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const metadataPath = ".generated/convene-build.json";
export async function prepareBuild(root = process.cwd()) {
  const version = JSON.parse(
    await readFile(join(root, "apps/server/package.json"), "utf8"),
  ).version;
  const info = {
    build_id: process.env.GITHUB_RUN_ID
      ? `convene-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
      : `convene-local-${randomUUID()}`,
    version,
    source_commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    github_run_id: process.env.GITHUB_RUN_ID ?? "local",
  };
  await mkdir(join(root, ".generated"), { recursive: true });
  await writeFile(join(root, metadataPath), JSON.stringify(info, null, 2) + "\n");
  return info;
}

export async function exportWeb(root = process.cwd(), output = "release-web") {
  const info = JSON.parse(await readFile(join(root, metadataPath), "utf8"));
  // Export the copy actually bundled by the server, including its brand overrides.
  const source = join(root, "apps/server/dist/client");
  const bundledInfo = JSON.parse(await readFile(join(source, "convene-build.json"), "utf8"));
  if (JSON.stringify(info) !== JSON.stringify(bundledInfo))
    throw new Error("Web build identity mismatch");
  await rm(join(root, output), { recursive: true, force: true });
  await cp(source, join(root, output), {
    recursive: true,
    filter: (file) => !file.endsWith(".map"),
  });
  await readFile(join(root, output, ".vite/manifest.json"));
  return info;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  if (command === "prepare") console.log(JSON.stringify(await prepareBuild()));
  else if (command === "export") console.log(JSON.stringify(await exportWeb()));
  else throw new Error("Use prepare or export");
}
