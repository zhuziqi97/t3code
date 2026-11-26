// @effect-diagnostics nodeBuiltinImport:off - Exercises the packaging filesystem and readelf.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { glibcElfFixture } from "./linux-glibc.fixture.ts";
import afterPack from "./linux-after-pack.ts";
import { parseGlibcNeeds, scanGlibcNeeds } from "./linux-glibc.ts";

it.each([
  ["GLIBC_2.9", "2.9"],
  ["GLIBC_2.34", "2.34"],
  ["GLIBC_2.10", "2.10"],
  ["GLIBC_2.2.5", "2.2.5"],
  ["GLIBC_ABI_DT_RELR", "2.36"],
])("reads required %s without counting newer definitions", (name, expected) => {
  expect(
    parseGlibcNeeds(`
Version definition section '.gnu.version_d' contains 1 entry:
  0x0010: Rev: 1 Flags: none Index: 2 Cnt: 1 Name: GLIBC_2.99
Version needs section '.gnu.version_r' contains 1 entry:
  000000: Version: 1 File: libc.so.6 Cnt: 3
  0x0010: Name: GLIBC_2.2 Flags: none Version: 3
  0x0020: Name: ${name} Flags: none Version: 4
  0x0030: Name: GLIBCXX_3.4.30 Flags: none Version: 5
`),
  ).toBe(expected);
});

it("ignores definitions, symbol tables, and unversioned/static binaries", () => {
  expect(parseGlibcNeeds("No version information found in this file.")).toBeUndefined();
  expect(
    parseGlibcNeeds(`
Version symbols section '.gnu.version' contains 1 entry:
  000: 2 (GLIBC_2.99)
Version definition section '.gnu.version_d' contains 1 entry:
  0x0010: Rev: 1 Flags: none Index: 2 Cnt: 1 Name: GLIBC_2.99
`),
  ).toBeUndefined();
});

// Rust std links pidfd_spawnp@GLIBC_2.39 weakly; the loader only warns when a weak version is missing.
it("does not count weak requirements", () => {
  expect(
    parseGlibcNeeds(`Version needs section '.gnu.version_r' contains 1 entry:
  0x0010: Version: 1  File: libc.so.6  Cnt: 2
  0x0150:   Name: GLIBC_2.34  Flags: none  Version: 2
  0x0160:   Name: GLIBC_2.39  Flags: WEAK  Version: 10
`),
  ).toBe("2.34");
});

it.each(["GLIBC_PRIVATE", "GLIBC_ABI_UNKNOWN"])("rejects unhandled requirement %s", (name) => {
  expect(() =>
    parseGlibcNeeds(`Version needs section '.gnu.version_r' contains 1 entry:
  0x0010: Name: ${name} Flags: none Version: 3
`),
  ).toThrow(name);
});

describe.skipIf(HostProcess.Platform.defaultValue() !== "linux")("packaged ELF scan", () => {
  it.each([62, 183])(
    "checks executable, addon and extensionless ELF requirements for machine %s",
    async (machine) => {
      const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-glibc-"));
      try {
        const app = NodePath.join(root, "app");
        const native = NodePath.join(app, "resources/app.asar.unpacked/node_modules/addon");
        await NodeFSP.mkdir(native, { recursive: true });
        await NodeFSP.writeFile(NodePath.join(app, "t3code"), glibcElfFixture(machine, "2.25"));
        await NodeFSP.writeFile(
          NodePath.join(native, "pty.node"),
          glibcElfFixture(machine, "2.34"),
        );
        await NodeFSP.writeFile(NodePath.join(app, "not-elf"), "GLIBC_2.99");
        await NodeFSP.writeFile(NodePath.join(root, "outside"), glibcElfFixture(machine, "2.99"));
        await NodeFSP.symlink("../outside", NodePath.join(app, "symlink"));
        expect(await scanGlibcNeeds(app)).toEqual({ minimum: "2.34", elfCount: 2 });
        const deb = { name: "deb", options: { depends: ["libnss3"] } };
        for (let arch = 0; arch < 2; arch++) {
          await afterPack({ appOutDir: app, electronPlatformName: "linux", targets: [deb] });
        }
        expect(deb.options.depends).toEqual(["libnss3", "libc6 (>= 2.34)"]);
        await NodeFSP.writeFile(NodePath.join(native, "helper"), glibcElfFixture(machine, "2.40"));
        await expect(
          afterPack({ appOutDir: app, electronPlatformName: "linux", targets: [deb] }),
        ).rejects.toThrow(/helper.*GLIBC_2\.40.*2\.39/s);
        await NodeFSP.writeFile(NodePath.join(native, "helper"), Buffer.from("\x7fELFbroken"));
        await expect(scanGlibcNeeds(app)).rejects.toThrow(/helper/);
      } finally {
        await NodeFSP.rm(root, { recursive: true, force: true });
      }
    },
  );
});
