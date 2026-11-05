// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

import { proxyConfig } from "./proxy.ts";

it("uses the configured provider and retains legacy vibeproxy selection", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-eval-proxy-"));
  try {
    for (const [configuration, expectedUrl] of [
      [
        '[model_providers.custom]\nbase_url = "http://localhost:8080/v1"',
        "http://localhost:8080/v1",
      ],
      [
        'model_provider = "custom"\n[model_providers.custom]\nbase_url = "http://localhost:8080/v1"\n[model_providers.vibeproxy]\nbase_url = "http://localhost:8317/v1"',
        "http://localhost:8080/v1",
      ],
      [
        '[model_providers.vibeproxy]\nbase_url = "http://localhost:8317/v1"',
        "http://localhost:8317/v1",
      ],
    ]) {
      NodeFS.writeFileSync(NodePath.join(directory, "config.toml"), configuration!);
      expect(proxyConfig(directory).url).toBe(expectedUrl);
    }
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
