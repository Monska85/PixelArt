// Every state of states.ts at 1,280 and 375 px, with the layout checks of layout.ts in place of a reference image:
// they need no container and no image, so they run with the end-to-end tests (`npm run e2e`). See
// playwright.layout.config.ts.

import { expectGoodLayout } from "./layout";
import { describeStates, states, type StateName } from "./states";

describeStates({
  names: Object.keys(states) as StateName[],
  themes: null,
  check: (page) => expectGoodLayout(page),
});
