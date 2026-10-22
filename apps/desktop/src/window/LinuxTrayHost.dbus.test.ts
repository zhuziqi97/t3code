// @effect-diagnostics nodeBuiltinImport:off -- Test an isolated D-Bus daemon, never the user's shell.
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import { Message, NameFlag, Variant, sessionBus, type MessageBus } from "dbus-next";
import { expect, it } from "vite-plus/test";
import { LinuxTrayHost } from "./LinuxTrayHost.ts";

const WATCHER = "org.kde.StatusNotifierWatcher";
const PATH = "/StatusNotifierWatcher";
const ITEM = "org.t3.TrayTest/StatusNotifierItem";
const hasDbus = NodeChildProcess.spawnSync("dbus-daemon", ["--version"]).status === 0;

it.runIf(hasDbus)(
  "requires a host and this process's registered item, then follows shell loss",
  async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-tray-dbus-"));
    let daemon: NodeChildProcess.ChildProcess | undefined;
    let server: MessageBus | undefined;
    let host: LinuxTrayHost | undefined;
    let foreign: LinuxTrayHost | undefined;
    try {
      daemon = NodeChildProcess.spawn(
        "dbus-daemon",
        [
          "--session",
          "--nofork",
          "--nopidfile",
          "--print-address",
          `--address=unix:path=${NodePath.join(directory, "bus")}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const lines = NodeReadline.createInterface({ input: daemon.stdout! });
      const [address] = await Promise.race([
        NodeEvents.EventEmitter.once(lines, "line"),
        NodeEvents.EventEmitter.once(daemon, "exit").then(() => {
          throw new Error("Private tray D-Bus daemon failed to start.");
        }),
      ]);
      lines.close();
      server = sessionBus({ busAddress: String(address) });
      server.on("error", () => undefined);
      await server.requestName(WATCHER, NameFlag.DO_NOT_QUEUE);
      await server.requestName("org.t3.TrayTest", NameFlag.DO_NOT_QUEUE);
      let registered = false;
      let items: string[] = [ITEM];
      server.addMethodHandler((message: Message) => {
        if (message.path !== PATH || message.member !== "GetAll") return false;
        server!.send(
          Message.newMethodReturn(message, "a{sv}", [
            {
              IsStatusNotifierHostRegistered: new Variant("b", registered),
              RegisteredStatusNotifierItems: new Variant("as", items),
            },
          ]),
        );
        return true;
      });
      let onLoss = () => {};
      host = new LinuxTrayHost(() => onLoss(), sessionBus({ busAddress: String(address) }));
      expect(await host.isAvailable()).toBe(false);
      registered = true;
      items = [];
      expect(await host.isAvailable()).toBe(false);
      items = [ITEM];
      foreign = new LinuxTrayHost(
        () => {},
        sessionBus({ busAddress: String(address) }),
        process.pid + 1,
      );
      expect(await foreign.isAvailable()).toBe(false);
      expect(await host.isAvailable()).toBe(true);

      let lost = new Promise<void>((resolve) => {
        onLoss = resolve;
      });
      registered = false;
      server.send(Message.newSignal(PATH, WATCHER, "StatusNotifierHostUnregistered"));
      await lost;
      expect(await host.isAvailable()).toBe(false);
      registered = true;
      expect(await host.isAvailable()).toBe(true);

      lost = new Promise<void>((resolve) => {
        onLoss = resolve;
      });
      items = [];
      server.send(Message.newSignal(PATH, WATCHER, "StatusNotifierItemUnregistered", "s", [ITEM]));
      await lost;
      expect(await host.isAvailable()).toBe(false);
      items = [ITEM];
      expect(await host.isAvailable()).toBe(true);

      lost = new Promise<void>((resolve) => {
        onLoss = resolve;
      });
      await server.releaseName(WATCHER);
      await lost;
      expect(await host.isAvailable()).toBe(false);
      await server.requestName(WATCHER, NameFlag.DO_NOT_QUEUE);
      expect(await host.isAvailable()).toBe(true);
    } finally {
      host?.close();
      foreign?.close();
      server?.disconnect();
      if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
        const exited = NodeEvents.EventEmitter.once(daemon, "exit");
        daemon.kill("SIGTERM");
        await exited;
      }
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  },
);
