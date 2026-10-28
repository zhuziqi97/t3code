import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import {
  managedAcpRegistryUpdateTarget,
  runAcpRegistryUpdate,
  type AcpRegistryUpdateState,
} from "./acpRegistryUpdate.ts";

const target = {
  environmentId: EnvironmentId.make("remote"),
  instanceId: ProviderInstanceId.make("registry-work"),
  agentId: "agent",
};
const prepared = AsyncResult.success({
  agentId: "agent",
  version: "2.0.0",
  distribution: "binary" as const,
  prepared: true as const,
});
const failure = AsyncResult.failure(Cause.fail(new Error("offline")));

describe("managed Registry updates", () => {
  it.each(["binary", "npx", "uvx"] as const)(
    "preserves the configured %s distribution through preparation",
    async (distribution) => {
      const configured = managedAcpRegistryUpdateTarget({
        driver: ProviderDriverKind.make("acpRegistry"),
        config: { agentId: "agent", distribution },
      });
      expect(configured).toEqual({ agentId: "agent", distribution });
      const commands = {
        prepare: vi.fn(async () => AsyncResult.success({ ...prepared.value, distribution })),
        refresh: vi.fn(async () => AsyncResult.success({})),
      };
      await runAcpRegistryUpdate(
        { ...target, ...configured! },
        { phase: "idle" },
        commands,
        () => undefined,
      );
      expect(commands.prepare).toHaveBeenCalledWith({
        environmentId: target.environmentId,
        input: { agentId: "agent", distribution },
      });
    },
  );
  it("does not claim success when the environment prepares a different distribution", async () => {
    const commands = {
      prepare: vi.fn(async () => prepared),
      refresh: vi.fn(async () => AsyncResult.success({})),
    };
    let state: AcpRegistryUpdateState = { phase: "idle" };
    await runAcpRegistryUpdate({ ...target, distribution: "npx" }, state, commands, (next) => {
      state = next;
    });
    expect(state).toMatchObject({ phase: "failed", stage: "prepare" });
    expect(commands.refresh).not.toHaveBeenCalled();
  });
  it("accepts configured Registry agents and excludes local commands and executable overrides", () => {
    const instance = {
      driver: ProviderDriverKind.make("acpRegistry"),
      config: { agentId: " agent " },
    };
    expect(managedAcpRegistryUpdateTarget(instance)).toEqual({ agentId: "agent" });
    expect(
      managedAcpRegistryUpdateTarget({
        ...instance,
        config: { ...instance.config, commandPath: "  " },
      }),
    ).toEqual({ agentId: "agent" });
    expect(
      managedAcpRegistryUpdateTarget({
        ...instance,
        config: { ...instance.config, source: "local" },
      }),
    ).toBeNull();
    expect(
      managedAcpRegistryUpdateTarget({
        ...instance,
        config: { ...instance.config, commandPath: "/custom/agent" },
      }),
    ).toBeNull();
    expect(
      managedAcpRegistryUpdateTarget({ ...instance, driver: ProviderDriverKind.make("codex") }),
    ).toBeNull();
    expect(managedAcpRegistryUpdateTarget(undefined)).toBeNull();
  });

  it("waits for preparation ACK before refreshing only the selected environment's instance", async () => {
    const ack = Promise.withResolvers<typeof prepared>();
    const commands = {
      prepare: vi.fn(() => ack.promise),
      refresh: vi.fn(async () => AsyncResult.success({})),
    };
    const states: AcpRegistryUpdateState[] = [];
    const running = runAcpRegistryUpdate(target, { phase: "idle" }, commands, (state) =>
      states.push(state),
    );
    expect(states).toEqual([{ phase: "preparing" }]);
    expect(commands.refresh).not.toHaveBeenCalled();
    ack.resolve(prepared);
    await running;
    expect(commands.prepare).toHaveBeenCalledWith({
      environmentId: target.environmentId,
      input: { agentId: "agent" },
    });
    expect(commands.refresh).toHaveBeenCalledWith({
      environmentId: target.environmentId,
      input: { instanceId: target.instanceId },
    });
    expect(states.map((state) => state.phase)).toEqual(["preparing", "refreshing", "succeeded"]);
  });

  it("retains prepare failures and retries installation without refreshing an unchanged provider", async () => {
    const commands = {
      prepare: vi.fn().mockResolvedValueOnce(failure).mockResolvedValue(prepared),
      refresh: vi.fn(async () => AsyncResult.success({})),
    };
    let state: AcpRegistryUpdateState = { phase: "idle" };
    const publish = (next: AcpRegistryUpdateState) => {
      state = next;
    };
    await runAcpRegistryUpdate(target, state, commands, publish);
    expect(state).toEqual({ phase: "failed", stage: "prepare", error: "offline" });
    expect(commands.refresh).not.toHaveBeenCalled();
    await runAcpRegistryUpdate(target, state, commands, publish);
    expect(commands.prepare).toHaveBeenCalledTimes(2);
    expect(state).toEqual({ phase: "succeeded" });
  });

  it("retries only status refresh after preparation succeeded", async () => {
    const commands = {
      prepare: vi.fn(async () => prepared),
      refresh: vi.fn().mockResolvedValueOnce(failure).mockResolvedValue(AsyncResult.success({})),
    };
    let state: AcpRegistryUpdateState = { phase: "idle" };
    const publish = (next: AcpRegistryUpdateState) => {
      state = next;
    };
    await runAcpRegistryUpdate(target, state, commands, publish);
    expect(state).toEqual({ phase: "failed", stage: "refresh", error: "offline" });
    await runAcpRegistryUpdate(target, state, commands, publish);
    expect(commands.prepare).toHaveBeenCalledTimes(1);
    expect(commands.refresh).toHaveBeenCalledTimes(2);
    expect(state).toEqual({ phase: "succeeded" });
  });
});
