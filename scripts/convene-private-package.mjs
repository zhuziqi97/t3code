import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeStreamPromises from "node:stream/promises";
// Private deployment configuration must never enter plaintext Actions artifacts.

function key() {
  const value = process.env.CONVENE_PACKAGE_TRANSPORT_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Private package transport key is missing or invalid");
  return Buffer.from(value, "hex");
}
function tar(args) {
  // Git Bash's GNU tar treats native drive letters as remote archive hosts.
  const executable =
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone transport also runs outside the workspace without Effect services.
    process.platform === "win32"
      ? NodePath.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  const result = NodeChildProcess.spawnSync(executable, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Private package archive operation failed");
}
const [mode, input, output] = process.argv.slice(2);
if (mode === "presets") {
  const values = JSON.parse(process.env.CONVENE_PLATFORM_URLS ?? "null");
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((v) => {
      if (typeof v !== "string") return true;
      try {
        return !["http:", "https:"].includes(new URL(v).protocol);
      } catch {
        return true;
      }
    })
  )
    throw new Error("Private platform presets are missing or invalid");
  await NodeFSP.writeFile(input, JSON.stringify(values), { mode: 0o600 });
} else if (mode === "encrypt" || mode === "decrypt") {
  const transportKey = key();
  const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "convene-package-"));
  const archive = NodePath.join(temporary, "package.tar");
  try {
    if (mode === "encrypt") {
      tar(["-cf", archive, "-C", input, "."]);
      const nonce = NodeCrypto.randomBytes(12);
      const cipher = NodeCrypto.createCipheriv("aes-256-gcm", transportKey, nonce);
      await NodeFSP.writeFile(output, nonce, { mode: 0o600 });
      await NodeStreamPromises.pipeline(
        NodeFS.createReadStream(archive),
        cipher,
        NodeFS.createWriteStream(output, { flags: "a" }),
      );
      await NodeFSP.writeFile(output, cipher.getAuthTag(), { flag: "a" });
    } else {
      const encrypted = await NodeFSP.readFile(input);
      const decipher = NodeCrypto.createDecipheriv(
        "aes-256-gcm",
        transportKey,
        encrypted.subarray(0, 12),
      );
      decipher.setAuthTag(encrypted.subarray(-16));
      await NodeFSP.writeFile(
        archive,
        Buffer.concat([decipher.update(encrypted.subarray(12, -16)), decipher.final()]),
        { mode: 0o600 },
      );
      await NodeFSP.mkdir(output, { recursive: true });
      tar(["-xf", archive, "-C", output]);
    }
  } finally {
    await NodeFSP.rm(temporary, { recursive: true, force: true });
  }
} else throw new Error("Expected presets, encrypt or decrypt");
