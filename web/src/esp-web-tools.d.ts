import type { DetailedHTMLProps, HTMLAttributes } from "react";

// The install button of ESP Web Tools, a custom element registered when `esp-web-tools` is imported.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "esp-web-install-button": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { manifest?: string };
    }
  }
}
