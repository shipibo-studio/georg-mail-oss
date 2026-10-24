// Tabler icon geometry (MIT, https://tabler.io/icons) as data for morphicons, which morphs one
// icon into another. @tabler/icons-react only exports components, so the few icons that morph
// are copied here in Tabler's own node format.
import type { IconNode } from "morphicons/react";

export const COPY_ICON: IconNode = [
  [
    "path",
    {
      d: "M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666",
    },
  ],
  ["path", { d: "M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" }],
];

export const CHECK_ICON: IconNode = [["path", { d: "M5 12l5 5l10 -10" }]];

export const SEND_ICON: IconNode = [
  ["path", { d: "M10 14l11 -11" }],
  ["path", { d: "M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5" }],
];

export const SUN_ICON: IconNode = [
  ["path", { d: "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" }],
  ["path", { d: "M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" }],
];

export const MOON_ICON: IconNode = [
  ["path", { d: "M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008" }],
];

export const DESKTOP_ICON: IconNode = [
  ["path", { d: "M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10" }],
  ["path", { d: "M7 20h10" }],
  ["path", { d: "M9 16v4" }],
  ["path", { d: "M15 16v4" }],
];

export const REFRESH_ICON: IconNode = [
  ["path", { d: "M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" }],
  ["path", { d: "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" }],
];
