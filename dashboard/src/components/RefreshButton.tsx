// Manual refresh: the dashboard does not poll. georg-ds's busy spinner takes the arrows' place while
// the visible data reloads, then they morph into a check for a moment, so the owner knows it is current.
import { useQueryClient } from "@tanstack/react-query";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { CHECK_ICON, REFRESH_ICON } from "./morph-icons";
import { useToast } from "./Toasts";
import { Tip } from "./Tooltip";

type RefreshState = "idle" | "refreshing" | "done";

// A refresh that answers instantly still shows the spinner a moment, so the press always feels acknowledged.
const MIN_SPIN_MS = 450;
const DONE_FOR_MS = 900;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function useRefresh() {
  const client = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const [state, setState] = useState<RefreshState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const refresh = async () => {
    if (state === "refreshing") return;
    setState("refreshing");
    const startedAt = Date.now();
    try {
      // Only what is on screen: other queries refresh when they are shown again.
      await client.refetchQueries({ type: "active" }, { throwOnError: true });
      await wait(Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt)));
      setState("done");
      timer.current = setTimeout(() => setState("idle"), DONE_FOR_MS);
    } catch {
      setState("idle");
      toast(t("error.generic"), { kind: "error" });
    }
  };
  return { state, refresh };
}

export function RefreshButton({ className = "g-button g-button-ghost g-button-icon" }: { className?: string }) {
  const { t } = useI18n();
  const { state, refresh } = useRefresh();
  return (
    <Tip label={t("nav.refresh")}>
      <motion.button
        type="button"
        className={`${className} refresh-button refresh-${state}`}
        aria-label={t("nav.refresh")}
        aria-busy={state === "refreshing" || undefined}
        onClick={() => void refresh()}
        whileTap={{ scale: 0.92 }}
      >
        <span className="g-spinner" aria-hidden="true" />
        <span className="refresh-icon">
          <MorphIcon
            icon={state === "done" ? CHECK_ICON : REFRESH_ICON}
            size={16}
            strokeWidth={1.5}
            spring="bouncy"
            reducedMotion="user"
          />
        </span>
      </motion.button>
    </Tip>
  );
}
