// georg-ds tooltip on Radix: a short label for a control, on hover and on keyboard focus after
// 400 ms, never on a mouse click, dismissed with Escape (WCAG 1.4.13). It supplements the
// control's accessible name, never replaces it: icon-only buttons keep their aria-label.
// See ../georg-ds/docs/components.md#tooltip.
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

/** georg-ds: a tooltip shows after 400 ms, so a pointer passing over a toolbar opens nothing. */
const TOOLTIP_DELAY_MS = 400;
const TOOLTIP_OFFSET_PX = 6;

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={TOOLTIP_DELAY_MS}>{children}</RadixTooltip.Provider>;
}

interface TipProps {
  /** A few words; nothing the user must read to finish a task, and nothing interactive. */
  label: ReactNode;
  /** One element that takes a ref and forwards props to the DOM: a button, a link, a span. */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  /** Breaks long unbroken text, such as a URL. */
  wrapAnywhere?: boolean;
}

export function Tip({ label, children, side = "top", wrapAnywhere = false }: TipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          className={`tooltip fade-in${wrapAnywhere ? " tooltip-wrap-anywhere" : ""}`}
          side={side}
          sideOffset={TOOLTIP_OFFSET_PX}
          collisionPadding={8}
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
