import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import { useGeorgTheme } from "../src/lib/theme";

type State = { pref: "system" | "light" | "dark"; theme: "light" | "dark"; accent: "purple" | "green" };

function installFakeTheme(initial: State) {
  let state = initial;
  const listeners = new Set<(next: State) => void>();
  window.georgTheme = {
    get: () => ({ ...state }),
    setTheme: () => {},
    setAccent: () => {},
    onChange: (listener) => {
      listeners.add(listener as (next: State) => void);
      return () => listeners.delete(listener as (next: State) => void);
    },
    ACCENTS: {} as typeof window.georgTheme.ACCENTS,
    PREFS: ["system", "light", "dark"],
  };
  return (next: State) => {
    state = next;
    for (const listener of listeners) listener(next);
  };
}

describe("useGeorgTheme", () => {
  test("follows georgTheme changes and keeps a stable snapshot in between", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const change = installFakeTheme({ pref: "system", theme: "light", accent: "purple" });
    const seen: State[] = [];
    function Probe() {
      seen.push(useGeorgTheme() as State);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toEqual({ pref: "system", theme: "light", accent: "purple" });
    expect(seen.at(-1)).toBe(seen.at(-2));

    act(() => change({ pref: "dark", theme: "dark", accent: "green" }));
    expect(seen.at(-1)).toEqual({ pref: "dark", theme: "dark", accent: "green" });
    act(() => root.unmount());
  });
});
