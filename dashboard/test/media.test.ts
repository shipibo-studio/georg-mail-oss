import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import { isSwipeBack, isSwipeDown, PHONE_QUERY, useIsPhone } from "../src/lib/media";

describe("swipe gestures", () => {
  test.each([
    [120, 0, true],
    [91, 0, true],
    [60, 200, false],
    [40, 800, true],
    [10, 2000, false],
    [-150, -900, false],
  ])("offset %d at %d px/s is a swipe: %s", (offset, velocity, expected) => {
    expect(isSwipeBack(offset, velocity)).toBe(expected);
    expect(isSwipeDown(offset, velocity)).toBe(expected);
  });
});

describe("useIsPhone", () => {
  test("follows the phone media query as it changes", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let matches = false;
    const listeners = new Set<() => void>();
    const queries: string[] = [];
    window.matchMedia = ((query: string) => {
      queries.push(query);
      return {
        get matches() {
          return matches;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      };
    }) as unknown as typeof window.matchMedia;

    const seen: boolean[] = [];
    function Probe() {
      seen.push(useIsPhone());
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(false);
    expect(queries).toContain(PHONE_QUERY);

    matches = true;
    act(() => {
      for (const listener of listeners) listener();
    });
    expect(seen.at(-1)).toBe(true);
    act(() => root.unmount());
    expect(listeners.size).toBe(0);
  });
});
