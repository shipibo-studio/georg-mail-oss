import { IconAlertTriangle, IconCheck, IconInfoCircle } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { play } from "../lib/sounds";

type ToastKind = "success" | "info" | "error";

/** A button inside the toast, such as Undo; pressing it also closes the toast. */
interface ToastAction {
  label: string;
  run(): void;
}

interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
  /** Toasts with the same key replace each other with a bump instead of stacking. */
  key?: string;
  action?: ToastAction;
  bump: number;
}

interface ToastOptions {
  kind?: ToastKind;
  key?: string;
  action?: ToastAction;
}

const DISMISS_AFTER_MS = 2400;
const ERROR_DISMISS_AFTER_MS = 5000;
// Long enough to reach for Undo after an action that seemed to go wrong.
const ACTION_DISMISS_AFTER_MS = 6000;
const ICONS = { success: IconCheck, info: IconInfoCircle, error: IconAlertTriangle } as const;

const ToastContext = createContext<((text: string, options?: ToastOptions) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    timers.current.delete(id);
  }, []);

  const schedule = useCallback(
    (id: number, kind: ToastKind, action?: ToastAction) => {
      clearTimeout(timers.current.get(id));
      const delay = action ? ACTION_DISMISS_AFTER_MS : kind === "error" ? ERROR_DISMISS_AFTER_MS : DISMISS_AFTER_MS;
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), delay),
      );
    },
    [dismiss],
  );

  const show = useCallback(
    (text: string, { kind = "success", key, action }: ToastOptions = {}) => {
      if (kind === "error") play("error");
      setToasts((current) => {
        const existing = key ? current.find((toast) => toast.key === key) : undefined;
        if (existing) {
          schedule(existing.id, kind, action);
          return current.map((toast) =>
            toast.id === existing.id ? { ...toast, text, kind, action, bump: toast.bump + 1 } : toast,
          );
        }
        const id = nextId.current++;
        schedule(id, kind, action);
        return [...current, { id, text, kind, key, action, bump: 0 }];
      });
    },
    [schedule],
  );

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = ICONS[toast.kind];
            return (
              <motion.div
                key={toast.id}
                layout
                className={`toast toast-${toast.kind}`}
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: toast.bump % 2 ? [1, 1.03, 1] : 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.2 } }}
                transition={{ type: "spring", stiffness: 520, damping: 30 }}
                onClick={() => dismiss(toast.id)}
              >
                <Icon size={16} stroke={1.5} />
                <span>{toast.text}</span>
                {toast.action && (
                  <button type="button" className="toast-action" onClick={toast.action.run}>
                    {toast.action.label}
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside ToastProvider");
  return show;
}
