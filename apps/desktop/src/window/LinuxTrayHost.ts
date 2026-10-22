// @effect-diagnostics globalTimers:off -- Bound native D-Bus calls so closing a window cannot hang on the shell.
import { Message, MessageType, sessionBus, type MessageBus, type MessageLike } from "dbus-next";
import * as Schema from "effect/Schema";

const WATCHER = "org.kde.StatusNotifierWatcher";
const WATCHER_PATH = "/StatusNotifierWatcher";
const DBUS = "org.freedesktop.DBus";
const DBUS_PATH = "/org/freedesktop/DBus";
const decodeProperties = Schema.decodeUnknownSync(
  Schema.Struct({
    IsStatusNotifierHostRegistered: Schema.Struct({ value: Schema.Boolean }),
    RegisteredStatusNotifierItems: Schema.Struct({ value: Schema.Array(Schema.String) }),
  }),
);
const decodePid = Schema.decodeUnknownSync(Schema.Tuple([Schema.Int]));

/** Electron's Linux Tray object alone does not establish a usable shell entry. */
export class LinuxTrayHost {
  private readonly bus: MessageBus;
  private readonly ready: Promise<void>;
  private readonly onUnavailable: () => void;
  private readonly processId: number;
  private watching = false;
  private closed = false;
  private owner = "";
  private item: string | undefined;

  constructor(onUnavailable: () => void, bus: MessageBus = sessionBus(), processId = process.pid) {
    this.bus = bus;
    this.onUnavailable = onUnavailable;
    this.processId = processId;
    bus.on("error", this.unavailable);
    bus.on("message", this.message);
    this.ready = this.subscribe().catch(this.unavailable);
  }

  close() {
    this.closed = true;
    this.bus.removeListener("message", this.message);
    this.bus.removeListener("error", this.unavailable);
    this.bus.disconnect();
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.ready;
      if (this.closed || !this.watching) return false;
      const reply = await this.call({
        destination: WATCHER,
        path: WATCHER_PATH,
        interface: "org.freedesktop.DBus.Properties",
        member: "GetAll",
        signature: "s",
        body: [WATCHER],
      });
      this.owner = reply.sender;
      const properties = decodeProperties(reply.body[0]);
      if (!properties.IsStatusNotifierHostRegistered.value) {
        this.unavailable();
        return false;
      }
      const candidates = await Promise.all(
        properties.RegisteredStatusNotifierItems.value.map(async (item) => {
          const service = item.split("/", 1)[0]!;
          try {
            const owner = await this.call({
              destination: DBUS,
              path: DBUS_PATH,
              interface: DBUS,
              member: "GetConnectionUnixProcessID",
              signature: "s",
              body: [service],
            });
            return decodePid(owner.body)[0] === this.processId ? item : undefined;
          } catch {
            // Other applications can unregister while the shell's list is being read.
            return undefined;
          }
        }),
      );
      this.item = candidates.find((item) => item !== undefined);
      if (this.closed || !this.item) {
        this.unavailable();
        return false;
      }
      return true;
    } catch {
      this.unavailable();
      return false;
    }
  }

  private unavailable = () => {
    this.item = undefined;
    if (!this.closed) this.onUnavailable();
  };

  private async call(message: MessageLike) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        this.bus.call(new Message(message)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Tray host did not answer.")), 1_000);
        }),
      ]);
      if (!reply) throw new Error("Missing tray host reply.");
      return reply;
    } finally {
      clearTimeout(timer);
    }
  }

  private async subscribe() {
    for (const rule of [
      `type='signal',sender='${WATCHER}',path='${WATCHER_PATH}',interface='${WATCHER}'`,
      `type='signal',sender='${DBUS}',interface='${DBUS}',member='NameOwnerChanged',arg0='${WATCHER}'`,
    ]) {
      await this.call({
        destination: DBUS,
        path: DBUS_PATH,
        interface: DBUS,
        member: "AddMatch",
        signature: "s",
        body: [rule],
      });
    }
    this.watching = true;
  }

  private message = (message: Message) => {
    if (this.closed || message.type !== MessageType.SIGNAL) return;
    if (
      message.sender === DBUS &&
      message.interface === DBUS &&
      message.member === "NameOwnerChanged" &&
      message.body[0] === WATCHER &&
      message.body[1] !== message.body[2]
    ) {
      this.unavailable();
    } else if (
      message.sender === this.owner &&
      message.path === WATCHER_PATH &&
      message.interface === WATCHER &&
      (message.member === "StatusNotifierHostUnregistered" ||
        (message.member === "StatusNotifierItemUnregistered" && message.body[0] === this.item))
    ) {
      this.unavailable();
    }
  };
}
