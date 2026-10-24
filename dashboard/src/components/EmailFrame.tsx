import { IconPhotoOff } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { type PreparedEmail, prepareEmailDocument } from "../lib/email-html";
import { useToast } from "./Toasts";

const MIN_HEIGHT = 120;

// No allow-scripts: nothing in the email can run. allow-same-origin lets the app measure the
// content to size the frame; without scripts it gives the email no power. Popups let links open in
// a new tab, outside the sandbox, with no referrer.
const SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

export function EmailFrame({ html, messageId }: { html: string; messageId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  // A different message starts blocked again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on message change only
  useEffect(() => {
    setAllowRemoteImages(false);
    setLoaded(false);
  }, [messageId]);

  const prepared = useMemo<PreparedEmail | null>(() => {
    try {
      return prepareEmailDocument(html, { allowRemoteImages });
    } catch {
      // The sanitizer cannot run: show nothing rather than unsanitized HTML.
      return null;
    }
  }, [html, allowRemoteImages]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let observer: ResizeObserver | undefined;
    const measure = () => {
      const body = element.contentDocument?.body;
      if (body) setHeight(Math.max(MIN_HEIGHT, body.scrollHeight));
    };
    const onLoad = () => {
      setLoaded(true);
      measure();
      const body = element.contentDocument?.body;
      if (body) {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };
    element.addEventListener("load", onLoad);
    return () => {
      element.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, []);

  if (!prepared) return <p className="muted">{t("detail.htmlUnavailable")}</p>;

  return (
    <div className="email-frame">
      <AnimatePresence initial={false}>
        {prepared.hasRemoteContent && !allowRemoteImages && (
          <motion.div
            className="blocked"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <IconPhotoOff size={16} stroke={1.5} />
            <span>{t("detail.imagesBlocked")}</span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAllowRemoteImages(true);
                toast(t("toast.imagesLoaded"), { kind: "info" });
              }}
            >
              {t("detail.loadImages")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <iframe
        ref={frame}
        className={`mail ${loaded ? "loaded" : ""}`}
        title={t("detail.tabPreview")}
        sandbox={SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={prepared.document}
        style={{ height }}
      />
    </div>
  );
}
