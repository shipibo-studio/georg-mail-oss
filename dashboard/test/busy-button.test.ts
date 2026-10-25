// georg-ds's busy button: announced with aria-busy, never disabled, and a press while busy does
// nothing (it neither runs the button's handler nor submits its form).
import type { MouseEvent } from "react";
import { describe, expect, test, vi } from "vitest";
import { busyButton } from "../src/components/controls";

function press() {
  return { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
}

describe("busy buttons", () => {
  test("say they are busy only while pending, and never as false", () => {
    expect(busyButton(true)["aria-busy"]).toBe(true);
    expect(busyButton(false)["aria-busy"]).toBeUndefined();
    expect(busyButton(true)).not.toHaveProperty("disabled");
  });

  test("swallow a press while busy, and let it through otherwise", () => {
    const busy = press();
    busyButton(true).onClickCapture(busy);
    expect(busy.preventDefault).toHaveBeenCalled();
    expect(busy.stopPropagation).toHaveBeenCalled();

    const idle = press();
    busyButton(false).onClickCapture(idle);
    expect(idle.preventDefault).not.toHaveBeenCalled();
    expect(idle.stopPropagation).not.toHaveBeenCalled();
  });
});
