// SPDX-License-Identifier: GPL-3.0-or-later

// The layout checks of screenshots/layout.ts, each shown failing on a small page that breaks its rule, so a check that
// stops seeing its problem fails here rather than passing every state quietly.

import { expect, test } from "@playwright/test";
import { expectGoodLayout } from "../screenshots/layout";

test.use({ viewport: { width: 1280, height: 800 } });

const row = (cells: string, style = "") =>
  `<tr style="${style}"><td style="vertical-align:middle;height:48px">Ball</td><td style="vertical-align:middle">${cells}</td></tr>`;
const table = (rows: string) => `<table aria-label="Files" style="width:600px"><tbody>${rows}</tbody></table>`;
const actions = (justify = "flex-end") =>
  `<div style="display:flex;justify-content:${justify};width:200px"><button aria-label="Edit">E</button></div>`;

const cases: Array<{ rule: string; html: string; problem: RegExp }> = [
  { rule: "the page scrolls sideways", html: `<div style="width:2000px">wide</div>`, problem: /scrolls sideways/ },
  {
    rule: "an element sticks out of the box that clips it",
    html: `<div style="width:300px;overflow:hidden"><button style="position:relative;left:400px">Delete</button></div>`,
    problem: /Delete\\?" sticks out of the box that clips it/,
  },
  {
    rule: "a control without a name",
    html: `<button><svg width="16" height="16"></svg></button>`,
    problem: /has no accessible name/,
  },
  {
    rule: "a row's cells off one line",
    html: table(
      `<tr><td style="vertical-align:middle;height:48px">Ball</td><td style="vertical-align:top">1</td></tr>`,
    ),
    problem: /not centred on one line/,
  },
  {
    rule: "row actions that end at different places",
    html: table(row(actions()) + row(actions("flex-start"))),
    problem: /row actions of Files do not end at the same place/,
  },
  {
    rule: "a playlist mark off its field",
    html: `<ol><li><select aria-label="Animation" style="margin-left:80px"><option>ball</option></select><span data-testid="item-missing-1">Not stored</span></li></ol>`,
    problem: /Not stored\\?" is \d+ px off its animation field/,
  },
  {
    rule: "a playlist mark beside its field",
    html: `<ol><li><select aria-label="Animation"><option>ball</option></select><span data-testid="item-missing-1" style="position:absolute;left:0;top:0">Not stored</span></li></ol>`,
    problem: /Not stored\\?" is not under its animation field/,
  },
];

for (const { rule, html, problem } of cases)
  test(`the layout checks catch ${rule}`, async ({ page }) => {
    await page.setContent(`<body style="margin:0">${html}</body>`);
    await expect(expectGoodLayout(page)).rejects.toThrow(problem);
  });

test("the layout checks pass a page that follows every rule", async ({ page }) => {
  await page.setContent(
    `<body style="margin:0"><button>Save</button>${table(row(actions()) + row(actions()))}` +
      `<ol><li><select aria-label="Animation"><option>ball</option></select><div><span data-testid="item-missing-1">Not stored</span></div></li></ol></body>`,
  );
  await expectGoodLayout(page);
});
