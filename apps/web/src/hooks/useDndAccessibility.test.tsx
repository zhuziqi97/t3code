// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DndContext,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../i18n";
import { useDndAccessibility } from "./useDndAccessibility";

const itemId = "Raw item / 原文";
const targetId = "Raw destination / 目标";
let root: Root;
let container: HTMLDivElement;
const started = vi.fn();
const cancelled = vi.fn();
const dropped = vi.fn();

function Item() {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: itemId });
  return (
    <button ref={setNodeRef} {...attributes} {...listeners}>
      {itemId}
    </button>
  );
}

function Target() {
  const { setNodeRef } = useDroppable({ id: targetId });
  return <div ref={setNodeRef}>{targetId}</div>;
}

function Screen({ withTarget = false }: { withTarget?: boolean }) {
  const accessibility = useDndAccessibility();
  const sensors = useSensors(useSensor(KeyboardSensor));
  return (
    <DndContext
      accessibility={accessibility}
      sensors={sensors}
      collisionDetection={() => (withTarget ? [{ id: targetId }] : [])}
      onDragStart={started}
      onDragCancel={cancelled}
      onDragEnd={dropped}
    >
      <Item />
      {withTarget ? <Target /> : null}
    </DndContext>
  );
}

async function key(code: string) {
  const button = container.querySelector("button")!;
  button.focus();
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  started.mockClear();
  cancelled.mockClear();
  dropped.mockClear();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("updates instructions and cancels an existing keyboard drag in the new language", async () => {
  await act(async () => root.render(<Screen />));
  const button = container.querySelector("button")!;
  const instruction = document.getElementById(button.getAttribute("aria-describedby")!)!;
  expect(instruction.textContent).toContain("press the space bar");
  await key("Space");
  expect(started).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    `Picked up draggable item ${itemId}.`,
  );
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector("button")).toBe(button);
  expect(instruction.textContent).toContain("按空格键开始拖动");
  expect(started).toHaveBeenCalledOnce();
  await key("Escape");
  expect(cancelled).toHaveBeenCalledOnce();
  expect(cancelled.mock.calls[0]![0].active.id).toBe(itemId);
  expect(dropped).not.toHaveBeenCalled();
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    `已取消拖动并放下 ${itemId}。`,
  );
});

it("announces the raw item and target when a keyboard drop finishes after switching language", async () => {
  await act(async () => root.render(<Screen withTarget />));
  await key("Space");
  await act(async () => changeLanguage("zh"));
  await key("Space");
  expect(started).toHaveBeenCalledOnce();
  expect(dropped).toHaveBeenCalledOnce();
  expect(dropped.mock.calls[0]![0]).toMatchObject({
    active: { id: itemId },
    over: { id: targetId },
  });
  expect(cancelled).not.toHaveBeenCalled();
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    `${itemId} 已放到区域 ${targetId}。`,
  );
});
