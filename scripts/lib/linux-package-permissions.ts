// @effect-diagnostics nodeBuiltinImport:off - electron-builder invokes this hook outside the Effect build runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

export default async function afterPack(context: {
  readonly appOutDir: string;
  readonly electronPlatformName: string;
}): Promise<void> {
  if (context.electronPlatformName !== "linux") return;
  async function normalize(path: string): Promise<void> {
    const info = await NodeFSP.lstat(path);
    if (!info.isFile() && !info.isDirectory()) return;
    if (info.mode & 0o022) await NodeFSP.chmod(path, info.mode & 0o7777 & ~0o022);
    if (info.isDirectory()) {
      for (const name of await NodeFSP.readdir(path)) await normalize(NodePath.join(path, name));
    }
  }
  await normalize(context.appOutDir);
}
