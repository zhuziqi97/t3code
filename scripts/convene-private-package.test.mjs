import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

const helper = new URL("./convene-private-package.mjs", import.meta.url);
NodeTest.test(
  "private packages round-trip without plaintext presets in transport and reject wrong keys",
  () => {
    const dir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "convene-private-NodeTest.test-"),
    );
    const key = NodeCrypto.randomBytes(32).toString("hex");
    const run = (...args) =>
      NodeChildProcess.spawnSync(process.execPath, [helper.pathname, ...args], {
        env: { ...process.env, CONVENE_PACKAGE_TRANSPORT_KEY: key },
        encoding: "utf8",
      });
    try {
      NodeFS.mkdirSync(NodePath.join(dir, "source"));
      const presets = '["https://private.example.NodeTest.test"]';
      NodeFS.writeFileSync(NodePath.join(dir, "source/convene-platforms.json"), presets);
      NodeAssert.equal(
        run("encrypt", NodePath.join(dir, "source"), NodePath.join(dir, "package.enc")).status,
        0,
      );
      NodeAssert.equal(
        NodeFS.readFileSync(NodePath.join(dir, "package.enc")).includes(
          Buffer.from("private.example.NodeTest.test"),
        ),
        false,
      );
      NodeAssert.equal(
        run("decrypt", NodePath.join(dir, "package.enc"), NodePath.join(dir, "restored")).status,
        0,
      );
      NodeAssert.equal(
        NodeFS.readFileSync(NodePath.join(dir, "restored/convene-platforms.json"), "utf8"),
        presets,
      );
      const wrong = NodeChildProcess.spawnSync(
        process.execPath,
        [
          helper.pathname,
          "decrypt",
          NodePath.join(dir, "package.enc"),
          NodePath.join(dir, "wrong"),
        ],
        {
          env: {
            ...process.env,
            CONVENE_PACKAGE_TRANSPORT_KEY: NodeCrypto.randomBytes(32).toString("hex"),
          },
          stdio: "ignore",
        },
      );
      NodeAssert.notEqual(wrong.status, 0);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  },
);
NodeTest.test(
  "configured builds reject missing presets instead of silently shipping an empty list",
  () => {
    const dir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "convene-private-NodeTest.test-"),
    );
    try {
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [helper.pathname, "presets", NodePath.join(dir, "presets.json")],
        { env: { ...process.env, CONVENE_PLATFORM_URLS: "" }, stdio: "ignore" },
      );
      NodeAssert.notEqual(result.status, 0);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  },
);
