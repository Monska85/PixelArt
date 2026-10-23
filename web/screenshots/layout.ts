import { expect, type Page } from "@playwright/test";

/** How far, in pixels, things may be off before the layout checks fail, and the width from which a list row is one line. */
const LIMITS = {
  /** An element's edge past the window or the box that clips it. */
  edge: 1,
  /** The spread of the vertical centres of the cells of one table row. */
  centre: 4,
  /** The spread of the right ends of the last action of every table row. */
  actionEnd: 2,
  /** A playlist item's mark from the left edge of its animation field. */
  markOffset: 2,
  /** From this width a list row is one line (Tailwind's `sm`); below it a row is two lines. */
  oneLineRows: 640,
};

/** Tables whose rows are meant to start at the top: long diagnostic messages wrap over several lines. */
const TOP_ALIGNED_TABLES = ["Diagnostics"];

/**
 * Layout checks for a state in place of a reference image. Each problem names the element, so a failure says what
 * moved:
 * - nothing scrolls sideways, and no element sticks out of the window or of the box that clips it;
 * - every control a person can reach has an accessible name;
 * - the cells of a table row are centred on one line (from 640 px, where a row is one line), and the last action of
 *   every row ends at the same place;
 * - a playlist item's mark sits under its animation field, aligned with its left edge.
 */
export async function expectGoodLayout(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const problems = await page.evaluate(
    ({ limits, topAligned }) => {
      const found: string[] = [];
      const width = document.documentElement.clientWidth;

      const describe = (element: Element): string => {
        const name = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40) ?? "";
        return `<${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}> "${name}"`;
      };
      const shown = (element: Element): boolean => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };

      /** The nearest ancestor below the body that clips or scrolls sideways, or null for the window. */
      const clippingBox = (element: Element): DOMRect | null => {
        for (let node = element.parentElement; node && node !== document.body; node = node.parentElement)
          if (getComputedStyle(node).overflowX !== "visible") return node.getBoundingClientRect();
        return null;
      };

      const checkOverflow = (): void => {
        if (document.documentElement.scrollWidth > width) found.push("the page scrolls sideways");
        const boxes =
          "button, a, input, select, textarea, h1, h2, h3, [role=tab], table, [role=dialog], [role=alert], li";
        for (const element of document.querySelectorAll(boxes)) {
          if (!shown(element)) continue;
          const box = element.getBoundingClientRect();
          const frame = clippingBox(element) ?? new DOMRect(0, 0, width, window.innerHeight);
          if (box.right > frame.right + limits.edge || box.left < frame.left - limits.edge)
            found.push(
              `${describe(element)} sticks out of ${clippingBox(element) ? "the box that clips it" : "the window"}`,
            );
        }
      };

      const accessibleName = (element: Element): string => {
        const labelledBy = element.getAttribute("aria-labelledby");
        const byIds = labelledBy
          ? labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
              .join(" ")
          : "";
        const labels = [...((element as HTMLInputElement).labels ?? [])].map((l) => l.textContent?.trim() ?? "");
        const image = element.querySelector("img[alt]")?.getAttribute("alt") ?? "";
        return (
          [
            element.getAttribute("aria-label"),
            byIds,
            ...labels,
            element.getAttribute("title"),
            element.textContent,
            image,
          ]
            .map((text) => text?.trim() ?? "")
            .find((text) => text !== "") ?? ""
        );
      };

      const checkNames = (): void => {
        const controls =
          "button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=menuitem], [role=menuitemradio], [role=checkbox], [role=switch], [role=slider]";
        for (const element of document.querySelectorAll(controls)) {
          if (!shown(element) || element.closest('[aria-hidden="true"], [inert]')) continue;
          if (accessibleName(element) === "") found.push(`${describe(element)} has no accessible name`);
        }
      };

      /** The box around everything shown in a cell, or around its text when it has no elements. */
      const contentBox = (cell: Element): DOMRect | null => {
        const parts = [...cell.querySelectorAll("*")].filter(shown).map((e) => e.getBoundingClientRect());
        if (parts.length === 0) {
          const range = document.createRange();
          range.selectNodeContents(cell);
          const text = range.getBoundingClientRect();
          return text.height > 0 ? text : null;
        }
        const top = Math.min(...parts.map((b) => b.top));
        const bottom = Math.max(...parts.map((b) => b.bottom));
        const left = Math.min(...parts.map((b) => b.left));
        const right = Math.max(...parts.map((b) => b.right));
        return new DOMRect(left, top, right - left, bottom - top);
      };
      const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);

      const checkTableRows = (): void => {
        for (const table of document.querySelectorAll("table")) {
          if (!shown(table)) continue;
          const label = table.getAttribute("aria-label") ?? "a table";
          const actionEnds: number[] = [];
          for (const row of table.querySelectorAll("tbody tr")) {
            const boxes = [...row.children].map(contentBox).filter((b): b is DOMRect => b !== null);
            if (width >= limits.oneLineRows && !topAligned.includes(label) && boxes.length > 1)
              if (spread(boxes.map((b) => b.top + b.height / 2)) > limits.centre)
                found.push(`the cells of a row of ${label} are not centred on one line (${describe(row)})`);
            // The buttons themselves, not the box around them: a wrapper always ends at the cell's edge.
            const actions = [...(row.lastElementChild?.querySelectorAll("button, a") ?? [])].filter(shown);
            const last = actions.at(-1);
            if (last) actionEnds.push(last.getBoundingClientRect().right);
          }
          if (actionEnds.length > 1 && spread(actionEnds) > limits.actionEnd)
            found.push(`the row actions of ${label} do not end at the same place`);
        }
      };

      const checkPlaylistMarks = (): void => {
        for (const mark of document.querySelectorAll('[data-testid^="item-missing-"]')) {
          const field = mark.closest("li")?.querySelector("select");
          if (!field || !shown(mark)) continue;
          const markBox = mark.getBoundingClientRect();
          const fieldBox = field.getBoundingClientRect();
          const dx = Math.abs(markBox.left - fieldBox.left);
          if (dx > limits.markOffset) found.push(`${describe(mark)} is ${Math.round(dx)} px off its animation field`);
          if (markBox.top < fieldBox.bottom) found.push(`${describe(mark)} is not under its animation field`);
        }
      };

      checkOverflow();
      checkNames();
      checkTableRows();
      checkPlaylistMarks();
      return found;
    },
    { limits: LIMITS, topAligned: TOP_ALIGNED_TABLES },
  );
  expect(problems, "layout problems").toEqual([]);
}
