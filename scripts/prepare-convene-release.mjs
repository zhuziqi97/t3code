/** 将同一次 Actions 的桌面工件整理为平台下载发布输入。 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { CONVENE_SUPPORTED_PROTOCOLS } from "../packages/contracts/src/conveneProtocol.ts";

const targets = [
  [
    "desktop-linux-x64",
    "linux-x64",
    [
      [".deb", "deb"],
      [".AppImage", "appimage"],
    ],
  ],
  ["desktop-win-x64", "windows-x64", [[".exe", "nsis"]]],
  ["desktop-mac-arm64", "macos-arm64", [[".dmg", "dmg"]]],
];

export async function prepareConveneRelease({ artifacts, output, version, commit, runId }) {
  const web = NodePath.join(artifacts, "convene-web");
  const build = JSON.parse(
    await NodeFSP.readFile(NodePath.join(web, "convene-build.json"), "utf8"),
  );
  if (build.version !== version || build.source_commit !== commit || build.github_run_id !== runId)
    throw new Error("Web build metadata does not match accepted candidate");
  // 先收齐四包，避免缺包时写出一份看似完整的发行输入。
  const packages = [];
  for (const [artifact, platform, formats] of targets) {
    const directory = NodePath.join(artifacts, artifact);
    const desktop = JSON.parse(
      await NodeFSP.readFile(NodePath.join(directory, "convene-build.json"), "utf8"),
    );
    if (JSON.stringify(desktop) !== JSON.stringify(build))
      throw new Error(`${platform}: Web build mismatch`);
    const names = await NodeFSP.readdir(directory);
    for (const [extension, format] of formats) {
      const matches = names.filter((name) => name.endsWith(extension));
      if (matches.length !== 1 || !matches[0].includes(`-${version}-`)) {
        throw new Error(`${platform}: expected one ${version} ${extension} package`);
      }
      const source = NodePath.join(directory, matches[0]);
      if ((await NodeFSP.stat(source)).size === 0) throw new Error(`${platform}: empty package`);
      packages.push({ platform, source, name: matches[0], format });
    }
  }
  for (const [, platform] of targets) {
    const directory = NodePath.join(output, platform);
    await NodeFSP.mkdir(directory, { recursive: true });
    const selected = packages.filter((item) => item.platform === platform);
    for (const item of selected)
      await NodeFSP.copyFile(item.source, NodePath.join(directory, item.name));
    await NodeFSP.writeFile(
      NodePath.join(directory, "build-info.json"),
      JSON.stringify(
        {
          product: "T3 Code for Convene",
          client_type: "t3",
          ...build,
          version,
          source_commit: commit,
          github_run_id: runId,
          platform,
          integration_protocols: CONVENE_SUPPORTED_PROTOCOLS.map(({ MAJOR, MAX_MINOR }) => ({
            major: MAJOR,
            max_minor: MAX_MINOR,
          })),
          packages: selected.map(({ name, format }) => ({ name, format })),
        },
        null,
        2,
      ) + "\n",
    );
  }
  await NodeFSP.cp(web, NodePath.join(output, "web"), { recursive: true });
}

if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  const { values } = NodeUtil.parseArgs({
    options: Object.fromEntries(
      ["artifacts", "output", "version", "commit", "run-id"].map((key) => [
        key,
        { type: "string" },
      ]),
    ),
  });
  if (Object.keys(values).length !== 5)
    throw new Error("Required: --artifacts --output --version --commit --run-id");
  await prepareConveneRelease({
    artifacts: values.artifacts,
    output: values.output,
    version: values.version,
    commit: values.commit,
    runId: values["run-id"],
  });
}
