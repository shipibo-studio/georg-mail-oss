// Small interaction primitives from georg-ds: copy with a morphing icon, switch, press-and-hold
// delete and avatar.

import { EASE_OUT, SPRING } from "@shipibo-studio/georg-ds/georg-motion.mjs";
import { MorphIcon } from "morphicons/react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { avatarSeed, senderAvatarUri } from "../lib/avatar";
import { useAvatarStyle } from "../lib/avatar-style";
import { avatarHue, expiryLevel, initials } from "../lib/format";
import { play, type Sound } from "../lib/sounds";
import { CHECK_ICON, COPY_ICON } from "./morph-icons";
import { Tip } from "./Tooltip";

const COPIED_FOR_MS = 1600;
const HOLD_TO_CONFIRM_MS = 900;

/**
 * georg-ds's busy button: spread on a g-button whose first child is <ButtonSpinner /> and whose
 * label is wrapped in <BusyLabel>. The label slides out and the spinner in, keeping the width.
 * The button stays enabled so focus stays on it; a press while busy (Enter and Space included,
 * which pointer-events cannot stop) does nothing, and does not submit its form.
 */
export function busyButton(pending: boolean) {
  return {
    "aria-busy": pending || undefined,
    onClickCapture: (event: MouseEvent) => {
      if (!pending) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

export function ButtonSpinner() {
  return <span className="g-spinner" aria-hidden="true" />;
}

/** A button's label, icon included, as the one element that slides out while it is busy. */
export function BusyLabel({ children }: { children: ReactNode }) {
  return <span className="busy-label">{children}</span>;
}

export function useCopy(onCopied?: () => void) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    play("copy");
    setCopied(true);
    onCopied?.();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
  };
  return { copied, copy };
}

export function CopyIcon({ copied, size = 16 }: { copied: boolean; size?: number }) {
  return (
    <MorphIcon
      icon={copied ? CHECK_ICON : COPY_ICON}
      size={size}
      strokeWidth={1.5}
      spring="bouncy"
      reducedMotion="user"
    />
  );
}

/**
 * georg-ds's g-copy: copy, then the icon morphs into a check and the label slides from "Copy" to
 * "Copied". React sets data-copied itself, so georg-copy.js is not needed.
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  onCopied,
  className = "g-button",
}: {
  text: string;
  label: string;
  copiedLabel: string;
  onCopied?: () => void;
  className?: string;
}) {
  const { copied, copy } = useCopy(onCopied);
  return (
    <button
      type="button"
      className={`${className} g-copy`}
      data-copied={copied || undefined}
      data-sound="none"
      onClick={() => copy(text)}
    >
      <CopyIcon copied={copied} />
      <span className="g-copy-swap" aria-live="polite">
        <span className="g-copy-idle" aria-hidden={copied}>
          {label}
        </span>
        <span className="g-copy-done" aria-hidden={!copied}>
          {copiedLabel}
        </span>
      </span>
    </button>
  );
}

export function Switch({
  checked,
  disabled,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
  label: string;
  id?: string;
}) {
  // georg-ds's g-switch: a native checkbox, so Space toggles it and forms read it. aria-checked is
  // implied by `checked`; it is set too so the state reads the same as every other switch.
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className="g-switch"
      aria-checked={checked}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/**
 * Destructive action without a modal: hold for 900 ms while the button fills; releasing early
 * cancels. Enter or Space held down does the same from the keyboard.
 */
export function HoldButton({
  onConfirm,
  label,
  children,
  className = "g-button g-button-ghost g-button-icon",
  sound = "remove",
}: {
  onConfirm(): void;
  label: string;
  children: ReactNode;
  className?: string;
  /** What it sounds like once confirmed: most holds delete, a reply sends. */
  sound?: Sound;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const start = () => {
    if (holding) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      play(sound);
      onConfirm();
    }, HOLD_TO_CONFIRM_MS);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      start();
    }
  };

  return (
    <Tip label={label}>
      <button
        type="button"
        className={`${className} hold ${holding ? "holding" : ""}`}
        aria-label={label}
        // The press only starts the hold; the sound comes when it completes.
        data-sound="none"
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onKeyDown={onKeyDown}
        onKeyUp={cancel}
        onBlur={cancel}
      >
        {children}
      </button>
    </Tip>
  );
}

// The owner's avatar: DiceBear "gaze" (CC0), generated by `pnpm avatar:generate`. An <img>, so the
// SVG can never run code; its animation follows prefers-reduced-motion.
const OWNER_AVATAR_URL = `${import.meta.env.BASE_URL}avatar-georg.svg`;

export function OwnerAvatar({ size = 28 }: { size?: number }) {
  return <img className="avatar avatar-owner" src={OWNER_AVATAR_URL} alt="" width={size} height={size} />;
}

/**
 * A sender's avatar, the same every time: their DiceBear face (see lib/avatar.ts) or, if the owner
 * prefers, their initials on a tint of their own.
 */
export function Avatar({ name, address, size = 28 }: { name: string | null; address: string | null; size?: number }) {
  const style = useAvatarStyle();
  const seed = avatarSeed(name, address);
  const uri = useMemo(() => (style === "faces" ? senderAvatarUri(seed) : null), [seed, style]);
  if (!uri) {
    return (
      <span
        className="avatar avatar-initials"
        aria-hidden="true"
        style={{ width: size, height: size, ["--avatar-hue" as string]: String(avatarHue(seed)) }}
      >
        {initials(name, address)}
      </span>
    );
  }
  return <img className="avatar avatar-sender" src={uri} alt="" width={size} height={size} aria-hidden="true" />;
}

/** Unread counter: appears and leaves with a spring; a new number pops in place of the old one. */
export function CountBadge({ count }: { count: number }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.span
          key="badge"
          className="g-badge"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={SPRING.pop}
        >
          <motion.span
            key={count}
            className="badge-count"
            initial={{ scale: 0.4 }}
            animate={{ scale: [0.4, 1.18, 1] }}
            transition={{ duration: 0.42 }}
          >
            {count}
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** The current time, refreshed every `intervalMs` while mounted (countdowns, elapsed times). */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * georg-ds countdown: a 2 px ring that empties as an inbox runs out of time, green, then amber
 * under 5 minutes, then red under 1 minute.
 */
export function ExpiryRing({
  createdAt,
  expiresAt,
  now,
  size = 16,
}: {
  createdAt: string;
  expiresAt: string;
  now: number;
  size?: number;
}) {
  const end = new Date(expiresAt).getTime();
  const total = Math.max(1, end - new Date(createdAt).getTime());
  const left = end - now;
  const fraction = Math.min(1, Math.max(0, left / total));
  const radius = size / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className={`expiry-ring expiry-ring-${expiryLevel(left)}`} width={size} height={size} aria-hidden="true">
      <circle className="track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={2} />
      <circle
        className="bar"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
      />
    </svg>
  );
}

/** An empty state: icon in a soft tile that settles with a spring, a title and one line. */
export function EmptyPanel({ icon, title, body }: { icon: ReactNode; title: string; body?: string }) {
  return (
    <motion.div
      className="g-empty"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
    >
      <motion.span
        className="g-empty-icon"
        initial={{ scale: 0.8, rotate: -8 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ ...SPRING.playful, delay: 0.08 }}
      >
        {icon}
      </motion.span>
      <p className="g-empty-title">{title}</p>
      {body && <p className="g-empty-body">{body}</p>}
    </motion.div>
  );
}

/** Tabs with the georg-ds sliding indicator. */
export function TabBar<T extends string>({
  id,
  tabs,
  value,
  onChange,
}: {
  id: string;
  tabs: { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={`tab ${tab.value === value ? "active" : ""}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.value === value && (
            <motion.span layoutId={`${id}-indicator`} className="tab-indicator" transition={SPRING.selection} />
          )}
        </button>
      ))}
    </div>
  );
}
