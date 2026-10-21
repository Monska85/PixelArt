import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

interface Options<K> {
  /** The list whose element children are the items, in the order of `keys`. */
  list: RefObject<HTMLElement | null>;
  /** The keys of the items, in order. */
  keys: readonly K[];
  /** Moves the item at `from` to `to`. */
  move: (from: number, to: number) => void;
  /** How the announcements name an item. */
  name: (key: K) => string;
  /** Says a sentence to screen readers. */
  announce: (text: string) => void;
}

interface Drag<K> {
  key: K;
  /** Where the item was when it was picked up, to put it back when the drag is cancelled. */
  from: number;
}

/** How close to the edge of the scrolling area a dragged item makes it scroll, and by how much per move. */
const EDGE = 48;
const STEP = 16;

/** The nearest ancestor that scrolls vertically, or null for the page. */
function scroller(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Reordering of a vertical list. Drag handles serve a pointer (mouse, pen or touch): an item is dragged over the
 * others, and near an edge of the scrolling area the list keeps scrolling while the pointer rests there. The handles
 * are not focusable; keyboard users move items with buttons that call `moveBy`. Every move is announced. The handle
 * needs `touch-action: none`, so a touch drags instead of scrolling the page.
 */
export function useReorder<K>({ list, keys, move, name, announce }: Options<K>) {
  const [drag, setDrag] = useState<Drag<K> | null>(null);
  // Removes the page listeners of a pointer drag; also when the list goes away in the middle of one.
  const stopListening = useRef(() => {});
  // The frame of the edge scrolling, while the pointer rests near an edge of the scrolling area.
  const scrolling = useRef<number | null>(null);
  useEffect(() => () => stopListening.current(), []);
  // Pointer moves can come faster than renders: the order and the drag as the handlers last changed them.
  const order = useRef(keys);
  const current = useRef(drag);
  useLayoutEffect(() => {
    order.current = keys;
    current.current = drag;
  });

  const position = (index: number): string => `position ${index + 1} of ${order.current.length}`;

  function moveTo(key: K, to: number): number {
    const from = order.current.indexOf(key);
    if (from < 0 || to < 0 || to >= order.current.length || to === from) return from;
    const next = [...order.current];
    next.splice(from, 1);
    next.splice(to, 0, key);
    order.current = next;
    move(from, to);
    return to;
  }

  function start(next: Drag<K> | null): void {
    current.current = next;
    setDrag(next);
  }

  function drop(): void {
    const active = current.current;
    if (!active) return;
    const at = order.current.indexOf(active.key);
    start(null);
    announce(
      at === active.from
        ? `${name(active.key)} dropped at its place, ${position(at)}.`
        : `${name(active.key)} dropped at ${position(at)}.`,
    );
  }

  function cancel(): void {
    const active = current.current;
    if (!active) return;
    moveTo(active.key, active.from);
    start(null);
    announce(`Move cancelled. ${name(active.key)} is back at ${position(active.from)}.`);
  }

  /** Puts the dragged item after every other item whose middle is above the pointer. */
  function follow(clientY: number, key: K): void {
    if (current.current?.key !== key || !list.current) return;
    const at = order.current.indexOf(key);
    let target = 0;
    [...list.current.children].forEach((row, index) => {
      if (index === at) return;
      const box = row.getBoundingClientRect();
      if (clientY > box.top + box.height / 2) target++;
    });
    moveTo(key, target);
  }

  /** How far to scroll `area` (null: the page) for a pointer at `clientY`: STEP up or down near an edge, else 0. */
  function edgeStep(area: HTMLElement | null, clientY: number): number {
    const top = area ? area.getBoundingClientRect().top : 0;
    const bottom = area ? area.getBoundingClientRect().bottom : window.innerHeight;
    return clientY < top + EDGE ? -STEP : clientY > bottom - EDGE ? STEP : 0;
  }

  /** Scrolls `area` (null: the page) and says whether it moved: false once it cannot scroll further that way. */
  function scrollArea(area: HTMLElement | null, by: number): boolean {
    const position = (): number => (area ? area.scrollTop : window.scrollY);
    const before = position();
    (area ?? window).scrollBy(0, by);
    return position() !== before;
  }

  /**
   * Scrolls once per frame while the pointer rests in an edge zone, and keeps the item under it. It stops when the
   * drag ends, the pointer leaves the zone, or the area cannot scroll further.
   */
  function scrollWhileAtEdge(pointer: { clientY: number }, key: K): void {
    if (scrolling.current !== null) return;
    const step = (): void => {
      scrolling.current = null;
      if (current.current?.key !== key || !list.current) return;
      const area = scroller(list.current);
      const by = edgeStep(area, pointer.clientY);
      if (by === 0 || !scrollArea(area, by)) return;
      follow(pointer.clientY, key);
      scrolling.current = requestAnimationFrame(step);
    };
    scrolling.current = requestAnimationFrame(step);
  }

  /** Moves an item one place up or down and announces it: what the move buttons do. */
  function moveBy(key: K, by: -1 | 1): void {
    const from = order.current.indexOf(key);
    const to = moveTo(key, from + by);
    announce(to === from ? `${name(key)} is already at ${position(to)}.` : `${name(key)} moved to ${position(to)}.`);
  }

  return {
    /** The item being dragged, or null. */
    moving: drag?.key ?? null,
    moveBy,
    /** The props of the drag handle of the item with `key`. */
    handleProps: (key: K) => ({
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || current.current) return;
        event.preventDefault();
        start({ key, from: order.current.indexOf(key) });
        // The page listens, not the handle: React moves the item's element while it is dragged, and a moved element
        // loses pointer capture.
        const pointer = event.pointerId;
        const last = { clientY: event.clientY };
        const onMove = (e: globalThis.PointerEvent): void => {
          if (e.pointerId !== pointer) return;
          last.clientY = e.clientY;
          follow(e.clientY, key);
          scrollWhileAtEdge(last, key);
        };
        const onEnd = (e: globalThis.PointerEvent): void => {
          if (e.pointerId !== pointer) return;
          stopListening.current();
          if (e.type === "pointercancel") cancel();
          else drop();
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onEnd);
        window.addEventListener("pointercancel", onEnd);
        stopListening.current = () => {
          if (scrolling.current !== null) cancelAnimationFrame(scrolling.current);
          scrolling.current = null;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onEnd);
          window.removeEventListener("pointercancel", onEnd);
          stopListening.current = () => {};
        };
      },
    }),
  };
}
