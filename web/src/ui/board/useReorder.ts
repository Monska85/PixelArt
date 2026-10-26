// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { EDGE_SCROLL, edgeSpeed, scrollDistance } from "./edgeScroll";

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

/**
 * The part of `area` (null: the window) where the list shows: below the bars that stick to its top and above those
 * that stick to its bottom, such as a panel's title and buttons, so both edge zones lie over the list itself.
 */
function visibleBand(area: HTMLElement | null): { top: number; bottom: number } {
  if (!area) return { top: 0, bottom: window.innerHeight };
  const box = area.getBoundingClientRect();
  let { top, bottom } = box;
  for (const child of area.children) {
    if (getComputedStyle(child).position !== "sticky") continue;
    const bar = child.getBoundingClientRect();
    if (bar.top <= box.top + 1) top = Math.max(top, bar.bottom);
    else if (bar.bottom >= box.bottom - 1) bottom = Math.min(bottom, bar.top);
  }
  return { top, bottom };
}

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
 * others, and near an edge of the scrolling area the list keeps scrolling while the pointer rests there, faster the
 * nearer the edge, the same way up and down. The handles are not focusable; keyboard users move items with buttons
 * that call `moveBy`. Every move is announced. The handle needs `touch-action: none`, so a touch drags instead of
 * scrolling the page.
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

  /** The pointer's speed into an edge zone of `area` (null: the page), in pixels per 60 Hz frame; 0 outside. */
  function speedAt(area: HTMLElement | null, clientY: number): number {
    const { top, bottom } = visibleBand(area);
    return edgeSpeed(clientY, top, bottom);
  }

  /** Scrolls `area` (null: the page) and says whether it moved: false once it cannot scroll further that way. */
  function scrollArea(area: HTMLElement | null, by: number): boolean {
    const position = (): number => (area ? area.scrollTop : window.scrollY);
    const before = position();
    (area ?? window).scrollBy(0, by);
    return position() !== before;
  }

  /**
   * Scrolls every frame while the pointer rests in an edge zone, faster the deeper it is (see edgeScroll.ts), and
   * keeps the item under it. A drag that started inside the zone waits until `holdUntil` first. It stops when the
   * drag ends, the pointer leaves the zone, or the area cannot scroll further.
   */
  function scrollWhileAtEdge(pointer: { clientY: number; holdUntil: number }, key: K): void {
    if (scrolling.current !== null) return;
    let last: number | null = null;
    let carried = 0;
    const step = (now: number): void => {
      scrolling.current = null;
      if (current.current?.key !== key || !list.current) return;
      const area = scroller(list.current);
      const speed = speedAt(area, pointer.clientY);
      if (speed === 0) return;
      const elapsed = last === null ? EDGE_SCROLL.frameMs : now - last;
      last = now;
      if (now >= pointer.holdUntil) {
        const distance = scrollDistance(speed, elapsed, carried);
        carried = distance.carried;
        if (distance.pixels !== 0 && !scrollArea(area, distance.pixels)) return;
        follow(pointer.clientY, key);
      }
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
        // A drag that starts inside an edge zone waits a moment before the list scrolls.
        const startArea = list.current && scroller(list.current);
        const last = {
          clientY: event.clientY,
          holdUntil: speedAt(startArea, event.clientY) === 0 ? 0 : performance.now() + EDGE_SCROLL.startDelayMs,
        };
        // Scroll anchoring would shift the area each time the dragged item moves past the item the browser anchors
        // to, which made scrolling up several times faster than down: it is off for the length of the drag.
        const anchored = startArea ?? document.documentElement;
        const anchoring = anchored.style.overflowAnchor;
        anchored.style.overflowAnchor = "none";
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
          anchored.style.overflowAnchor = anchoring;
          if (scrolling.current !== null) cancelAnimationFrame(scrolling.current);
          scrolling.current = null;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onEnd);
          window.removeEventListener("pointercancel", onEnd);
          stopListening.current = () => {
            anchored.style.overflowAnchor = anchoring;
          };
        };
      },
    }),
  };
}
