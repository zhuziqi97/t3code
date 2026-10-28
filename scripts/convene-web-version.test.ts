// @effect-diagnostics nodeBuiltinImport:off - Compile only the branding module in memory with Vite's real define values; no server or browser is started.
import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";
import { build } from "esbuild";
import { expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  metadata: undefined as { build_id: string; source_commit: string } | undefined,
}));

vi.mock("./lib/public-config", () => ({ loadRepoEnv: () => ({}) }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const isBuildInfo = (path: unknown) =>
    path instanceof URL && path.pathname.endsWith("/.generated/convene-build.json");
  return {
    ...fs,
    existsSync: (...args: Parameters<typeof fs.existsSync>) =>
      isBuildInfo(args[0]) ? fixture.metadata !== undefined : fs.existsSync(...args),
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) =>
      isBuildInfo(args[0]) ? JSON.stringify(fixture.metadata) : fs.readFileSync(...args),
  };
});

it.each([true, false])(
  "injects distinct upstream, product and existing build identities (metadata=%s)",
  async (packaged) => {
    const previousAppVersion = process.env.APP_VERSION;
    process.env.APP_VERSION = "0.2.3-convene.99";
    using _releaseVersion = {
      [Symbol.dispose]() {
        if (previousAppVersion === undefined) delete process.env.APP_VERSION;
        else process.env.APP_VERSION = previousAppVersion;
      },
    };
    fixture.metadata = packaged
      ? {
          build_id: "convene-fixture-42-2",
          source_commit: "1234567890abcdef1234567890abcdef12345678",
        }
      : undefined;
    vi.resetModules();
    const { default: configure } = await import(
      new URL("../apps/web/vite.config.ts", import.meta.url).href
    );
    if (typeof configure !== "function") throw new Error("Expected the Web config factory");
    const config = await configure({ command: "build", mode: "production" });
    const source = new URL("../apps/web/src/branding.ts", import.meta.url);
    const result = await build({
      stdin: {
        contents: await NodeFSP.readFile(source, "utf8"),
        resolveDir: NodeURL.fileURLToPath(new URL(".", source)),
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      define: { ...config.define, "import.meta.env.DEV": "false" },
    });
    const module = { exports: {} as Record<string, string> };
    new Function("module", result.outputFiles[0]!.text)(module);
    expect(module.exports.APP_VERSION).toBe("0.2.3-convene.99");
    expect(module.exports.UPSTREAM_VERSION).toBe("0.1.3");
    expect(module.exports.CONVENE_BUILD_ID).toBe(fixture.metadata?.build_id ?? "");
    expect(module.exports.CONVENE_SOURCE_COMMIT).toBe(fixture.metadata?.source_commit ?? "");
    expect(module.exports.APP_DISPLAY_NAME).toBe("T3 Code for Convene (Beta)");
  },
);
