import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  AcpRegistryManagedBinaryUninstallInput,
  AcpRegistryManagedBinaryUninstallResult,
  AcpRegistryPrepareInput,
  officialAcpRegistryIconUrlForAgentId,
  resolveOfficialAcpRegistryIconUrl,
} from "./acpRegistry.ts";

const decodeUninstallInput = Schema.decodeUnknownSync(AcpRegistryManagedBinaryUninstallInput);
const decodeUninstallResult = Schema.decodeUnknownSync(AcpRegistryManagedBinaryUninstallResult);
const decodePrepareInput = Schema.decodeUnknownSync(AcpRegistryPrepareInput);
const prepareCodec = Schema.fromJsonString(AcpRegistryPrepareInput);
const encodePrepare = Schema.encodeSync(prepareCodec);
const decodePrepare = Schema.decodeSync(prepareCodec);

describe("ACP Registry contracts", () => {
  it.each([undefined, "binary", "npx", "uvx"])(
    "round trips preparation distribution %s without changing omitted defaults",
    (distribution) => {
      const input = {
        agentId: "example-agent",
        ...(distribution === undefined ? {} : { distribution }),
      };
      const decoded = decodePrepareInput(input);
      expect(decodePrepare(encodePrepare(decoded))).toEqual(input);
    },
  );
  it("accepts only official Registry icon URLs and safe agent IDs", () => {
    expect(officialAcpRegistryIconUrlForAgentId("antigravity-acp")).toBe(
      "https://cdn.agentclientprotocol.com/registry/v1/latest/antigravity-acp.svg",
    );
    expect(officialAcpRegistryIconUrlForAgentId("../antigravity-acp")).toBeNull();
    expect(
      resolveOfficialAcpRegistryIconUrl(
        "https://cdn.agentclientprotocol.com/registry/v1/latest/pi-acp.svg",
      ),
    ).toBe("https://cdn.agentclientprotocol.com/registry/v1/latest/pi-acp.svg");
    expect(
      resolveOfficialAcpRegistryIconUrl(
        "https://cdn.agentclientprotocol.com.evil/registry/v1/latest/pi-acp.svg",
      ),
    ).toBeNull();
    expect(
      resolveOfficialAcpRegistryIconUrl(
        "https://user@cdn.agentclientprotocol.com/registry/v1/latest/pi-acp.svg",
      ),
    ).toBeNull();
  });

  it("decodes managed binary uninstall payloads and rejects unsafe agent IDs", () => {
    expect(decodeUninstallInput({ agentId: "  example-agent  " })).toEqual({
      agentId: "example-agent",
    });
    expect(decodeUninstallResult({ agentId: "example-agent", removed: false })).toEqual({
      agentId: "example-agent",
      removed: false,
    });
    expect(() => decodeUninstallInput({ agentId: "../example-agent" })).toThrow();
  });
});
