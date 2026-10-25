// Interface sounds: the recipes stay short and soft, each click picks the right cue, and the
// switch in Settings silences all of them.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installClickSounds, play, SOUND_EVENT, SOUND_RECIPES, setSounds, soundForClick } from "../src/lib/sounds";

const MAX_DURATION_S = 0.4;

function element(html: string): Element {
  document.body.innerHTML = html;
  const found = document.body.querySelector("[data-target]") ?? document.body.firstElementChild;
  if (!found) throw new Error("no element");
  return found;
}

describe("recipes", () => {
  test("every sound is short, soft and audible", () => {
    for (const [name, tones] of Object.entries(SOUND_RECIPES)) {
      expect(tones.length, name).toBeGreaterThan(0);
      for (const tone of tones) {
        expect(tone.at + tone.duration, name).toBeLessThanOrEqual(MAX_DURATION_S);
        expect(tone.gain, name).toBeGreaterThan(0);
        expect(tone.gain, name).toBeLessThanOrEqual(1);
        for (const frequency of [tone.from, "to" in tone ? tone.to : tone.from]) {
          expect(frequency, name).toBeGreaterThanOrEqual(60);
          expect(frequency, name).toBeLessThanOrEqual(4000);
        }
      }
    }
  });
});

describe("which sound a click makes", () => {
  test("buttons tap, primary buttons press, moving between places ticks", () => {
    expect(soundForClick(element('<button class="g-button">Save</button>'))).toBe("tap");
    expect(
      soundForClick(element('<button class="g-button g-button-primary"><span data-target>Send</span></button>')),
    ).toBe("press");
    expect(soundForClick(element('<button class="folder">Inbox</button>'))).toBe("tick");
    expect(soundForClick(element('<button class="msg">A message</button>'))).toBe("tick");
    expect(soundForClick(element('<button role="radio" aria-checked="false">Dark</button>'))).toBe("tick");
    expect(soundForClick(element('<input type="radio" name="x">'))).toBe("tick");
  });

  test("a switch sounds the way it moved", () => {
    expect(soundForClick(element('<input type="checkbox" role="switch" checked>'))).toBe("toggleOn");
    expect(soundForClick(element('<input type="checkbox" role="switch">'))).toBe("toggleOff");
  });

  test("controls with their own sound, disabled ones, selects and plain text stay quiet here", () => {
    expect(soundForClick(element('<button data-sound="none">Copy</button>'))).toBeNull();
    expect(soundForClick(element('<button data-sound="send">Send</button>'))).toBe("send");
    expect(soundForClick(element('<button data-sound="boom">?</button>'))).toBeNull();
    expect(soundForClick(element('<button class="g-button" disabled>Wait</button>'))).toBeNull();
    expect(soundForClick(element('<a class="g-button" aria-disabled="true">Docs</a>'))).toBeNull();
    expect(soundForClick(element("<select><option>A</option></select>"))).toBeNull();
    expect(soundForClick(element("<p>Just text</p>"))).toBeNull();
  });
});

describe("playing", () => {
  const heard: string[] = [];
  const listen = (event: Event) => heard.push((event as CustomEvent<string>).detail);
  beforeEach(() => {
    heard.length = 0;
    localStorage.clear();
    setSounds("on");
    window.addEventListener(SOUND_EVENT, listen);
  });
  afterEach(() => window.removeEventListener(SOUND_EVENT, listen));

  test("a sound plays once, even when asked twice at the same moment", () => {
    expect(play("copy", 1_000)).toBe(true);
    expect(play("copy", 1_020)).toBe(false);
    expect(play("copy", 1_100)).toBe(true);
    expect(heard).toEqual(["copy", "copy"]);
  });

  test("switched off, nothing plays, and the choice is remembered", () => {
    setSounds("off");
    expect(play("arrive", 5_000)).toBe(false);
    expect(heard).toEqual([]);
    expect(localStorage.getItem("georg-mail.sounds")).toBe("off");
  });

  test("clicks and chosen options across the page sound, until the listener is removed", () => {
    const remove = installClickSounds(document);
    document.body.innerHTML =
      '<button class="g-button">Go</button><select><option>a</option><option>b</option></select>';
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    document.querySelector("button")?.click();
    document.querySelector("select")?.dispatchEvent(new Event("change", { bubbles: true }));
    remove();
    vi.mocked(performance.now).mockReturnValue(20_000);
    document.querySelector("button")?.click();
    expect(heard).toEqual(["tap", "tick"]);
    vi.restoreAllMocks();
  });
});
