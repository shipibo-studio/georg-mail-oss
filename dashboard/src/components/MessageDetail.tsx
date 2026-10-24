import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowLeft,
  IconArrowUpRight,
  IconDownload,
  IconFileZip,
  IconInbox,
  IconLock,
  IconLockOpen,
  IconPaperclip,
  IconRosetteDiscountCheck,
  IconShieldHalf,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { downloads } from "../api/client";
import type { Attachment, FullMessage, MessageLink } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import { formatBytes, formatFullDate } from "../lib/format";
import { isSwipeBack, useIsPhone } from "../lib/media";
import { Avatar, CopyButton, HoldButton, OwnerAvatar } from "./controls";
import { EmailFrame } from "./EmailFrame";
import { useToast } from "./Toasts";
import { Tip } from "./Tooltip";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
type Tab = "preview" | "text";
const MAX_LINKS = 8;

/** Emails repeat the same link (logo, button, footer); each destination is shown once. */
function uniqueLinks(links: MessageLink[]): MessageLink[] {
  const seen = new Set<string>();
  return links.filter((link) => !seen.has(link.url) && seen.add(link.url)).slice(0, MAX_LINKS);
}

function EmptyDetail() {
  const { t } = useI18n();
  return (
    <div className="detail-empty">
      <motion.span
        className="empty-icon"
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 3.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      >
        <IconInbox size={28} stroke={1.5} />
      </motion.span>
      <p className="display empty-title">{t("detail.emptyTitle")}</p>
      <p className="empty-body">{t("detail.emptyHint")}</p>
      <div className="shortcut-hints" aria-hidden="true">
        <span className="kbd">J</span>
        <span className="kbd">K</span>
        <span className="kbd">C</span>
        <span className="kbd">R</span>
        <span className="kbd">E</span>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="detail-inner" aria-hidden="true">
      <div className="skeleton" style={{ height: 30, width: 180, marginBottom: 22 }} />
      <div className="skeleton" style={{ height: 22, width: "70%", marginBottom: 14 }} />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div className="skeleton" style={{ width: 30, height: 30, borderRadius: 99 }} />
        <div className="skeleton" style={{ height: 12, width: 260 }} />
      </div>
      <div className="skeleton" style={{ height: 260, marginTop: 28, borderRadius: 8 }} />
    </div>
  );
}

function CodeCard({ code }: { code: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const middle = Math.ceil(code.length / 2);
  return (
    <motion.div
      className="card code-card"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT, delay: 0.06 }}
    >
      <div>
        <div className="label">
          <IconSparkles size={14} stroke={1.5} /> {t("detail.code")}
        </div>
        <span className="sr-only">{code}</span>
        <div className="code-value mono" aria-hidden="true">
          {Array.from(code).map((digit, index) => (
            <motion.span
              // biome-ignore lint/suspicious/noArrayIndexKey: digits repeat; their position is the identity
              key={index}
              className={index === middle - 1 && code.length > 4 ? "digit gap" : "digit"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 20, delay: 0.1 + index * 0.035 }}
            >
              {digit}
            </motion.span>
          ))}
        </div>
      </div>
      <CopyButton
        text={code}
        label={t("detail.copyCode")}
        copiedLabel={t("detail.copied")}
        onCopied={() => toast(t("toast.codeCopied"))}
      />
    </motion.div>
  );
}

function LinkChip({ link, index }: { link: MessageLink; index: number }) {
  const { t } = useI18n();
  const warning = link.privateTarget
    ? t("detail.linkPrivate")
    : !link.secure
      ? t("detail.linkInsecure")
      : link.fromVerifiedSender
        ? t("detail.linkFromSender")
        : t("detail.linkUnverified");
  const safe = link.secure && !link.privateTarget;
  const href = /^https?:/i.test(link.url) ? link.url : undefined;
  return (
    <Tip
      wrapAnywhere
      label={
        <>
          <span className="mono">{link.url}</span>
          <br />
          {warning}
        </>
      }
    >
      <motion.a
        className={`link-chip ${link.fromVerifiedSender && safe ? "verified" : ""} ${safe ? "" : "unsafe"}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: EASE_OUT, delay: 0.1 + Math.min(index, 8) * 0.03 }}
      >
        {safe ? <IconLock size={14} stroke={1.5} /> : <IconLockOpen size={14} stroke={1.5} />}
        <span className="host mono">{link.domain ?? link.url.slice(0, 40)}</span>
        {link.fromVerifiedSender && safe && (
          <IconRosetteDiscountCheck size={14} stroke={1.5} className="verified-mark" />
        )}
        <IconArrowUpRight size={14} stroke={1.5} className="muted" />
      </motion.a>
    </Tip>
  );
}

function Tabs({ tab, onTab, hasHtml }: { tab: Tab; onTab(tab: Tab): void; hasHtml: boolean }) {
  const { t } = useI18n();
  const tabs: Tab[] = hasHtml ? ["preview", "text"] : ["text"];
  return (
    <LayoutGroup id="detail-tabs">
      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={`tab ${tab === item ? "active" : ""}`}
            onClick={() => onTab(item)}
          >
            {t(item === "preview" ? "detail.tabPreview" : "detail.tabText")}
            {tab === item && (
              <motion.span
                layoutId="tab-indicator"
                className="tab-indicator"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

/** Where a message's files download from: the personal mailbox, or a test inbox through /v1. */
export interface MessageDownloads {
  original(messageId: string): string;
  attachment?(messageId: string, attachmentId: string): string;
}

interface MessageDetailProps {
  message: FullMessage | undefined;
  loading: boolean;
  selectedId: string | null;
  /** Absent for test inboxes: only the personal mailbox replies to the outside world. */
  onReply?(message: FullMessage): void;
  /** Deleting for good, behind a hold. The personal mailbox offers it only inside Trash. */
  onDelete?(id: string): void;
  /** Toolbar buttons before the delete, for example Archive and Move to Trash. */
  actions?(message: FullMessage): ReactNode;
  onBack(): void;
  /** Shown above the message, for example the way back to its inbox. */
  backLabel?: string;
  files?: MessageDownloads;
  /** Extra controls under an attachment, for example reading a PDF as text in a test inbox. */
  attachmentExtra?(messageId: string, attachment: Attachment): ReactNode;
}

export function MessageDetail({
  message,
  loading,
  selectedId,
  onReply,
  onDelete,
  actions,
  onBack,
  backLabel,
  files = downloads,
  attachmentExtra,
}: MessageDetailProps) {
  const { t, plural, locale, clock } = useI18n();
  const [tab, setTab] = useState<Tab>("preview");
  const isPhone = useIsPhone();

  if (!selectedId)
    return (
      <main className="detail">
        <EmptyDetail />
      </main>
    );
  if (loading || !message)
    return (
      <main className="detail">
        <DetailSkeleton />
      </main>
    );

  const hasHtml = Boolean(message.html);
  const activeTab: Tab = hasHtml ? tab : "text";
  const sent = message.direction === "sent";
  const senderName = sent ? t("detail.sentBy") : message.from.name || message.from.address || "?";
  const risky = message.risk.level !== "low";

  return (
    <main className="detail">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={message.id}
          className="detail-inner"
          initial={isPhone ? { opacity: 0, x: 28 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
          // On phones, swiping the message to the right goes back to the list.
          drag={isPhone ? "x" : false}
          dragDirectionLock
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={{ left: 0, right: 0.6 }}
          dragSnapToOrigin
          onDragEnd={(_, info) => {
            if (isSwipeBack(info.offset.x, info.velocity.x)) onBack();
          }}
        >
          <div className="toolbar">
            {backLabel ? (
              <button type="button" className="btn ghost" onClick={onBack}>
                <IconArrowLeft size={16} stroke={1.5} /> {backLabel}
              </button>
            ) : (
              <button
                type="button"
                className="btn ghost icon back-button"
                onClick={onBack}
                aria-label={t("detail.back")}
              >
                <IconArrowLeft size={16} stroke={1.5} />
              </button>
            )}
            {onReply && (
              <Tip label={`${t("detail.reply")} (R)`}>
                <motion.button
                  type="button"
                  className="btn"
                  onClick={() => onReply(message)}
                  whileTap={{ scale: 0.97 }}
                >
                  <IconArrowBackUp size={16} stroke={1.5} /> {t("detail.reply")}
                </motion.button>
              </Tip>
            )}
            {message.originalAvailable && (
              <Tip label={t("detail.downloadOriginal")}>
                <a
                  className="btn ghost icon"
                  href={files.original(message.id)}
                  download
                  aria-label={t("detail.downloadOriginal")}
                >
                  <IconDownload size={16} stroke={1.5} />
                </a>
              </Tip>
            )}
            {actions?.(message)}
            {onDelete && (
              <HoldButton label={t("detail.holdToDelete")} onConfirm={() => onDelete(message.id)}>
                <IconTrash size={16} stroke={1.5} />
              </HoldButton>
            )}
            <span className="grow" />
            {!sent && (
              <Tip label={t("detail.untrustedHint")} side="bottom">
                {/* Focusable so keyboard users reach the explanation too. */}
                {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a tooltip trigger must take keyboard focus */}
                <span className="untrusted" tabIndex={0}>
                  <IconShieldHalf size={14} stroke={1.5} />
                  <span className="untrusted-label">{t("detail.untrusted")}</span>
                </span>
              </Tip>
            )}
          </div>

          <h1 className="subject-title">{message.subject || t("list.noSubject")}</h1>

          <div className="from-line">
            {sent ? (
              <OwnerAvatar size={32} />
            ) : (
              <Avatar name={message.from.name} address={message.from.address} size={32} />
            )}
            <div className="from-who">
              <div>
                <b>{senderName}</b>{" "}
                {!sent && message.from.address && <span className="mono">&lt;{message.from.address}&gt;</span>}
                {!sent && (
                  <span className={`sender-badge ${message.from.verified ? "verified" : "unverified"}`}>
                    {message.from.verified ? (
                      <IconRosetteDiscountCheck size={14} stroke={1.5} />
                    ) : (
                      <IconAlertTriangle size={14} stroke={1.5} />
                    )}
                    {t(message.from.verified ? "detail.verified" : "detail.unverified")}
                  </span>
                )}
              </div>
              <div className="muted">
                {t("detail.to")}{" "}
                <span className="mono">{sent ? (message.recipients ?? []).join(", ") : message.to}</span>
              </div>
            </div>
            <time dateTime={message.receivedAt}>{formatFullDate(message.receivedAt, locale, clock)}</time>
          </div>

          {message.box === "spam" && message.spamReason && (
            <div className="risk-banner spam-banner">
              <IconAlertOctagon size={16} stroke={1.5} />
              <div>
                <b>{t("detail.inSpam")}</b>
                <span>{t(`spam.${message.spamReason}`)}</span>
              </div>
            </div>
          )}

          {risky && (
            <motion.div
              className={`risk-banner risk-${message.risk.level}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <IconAlertTriangle size={16} stroke={1.5} />
              <div>
                <b>{t(message.risk.level === "high" ? "detail.riskHigh" : "detail.riskMedium")}</b>
                <span>{message.risk.reasons.map((reason) => t(`risk.${reason}`)).join(" · ")}</span>
              </div>
            </motion.div>
          )}

          {!sent && message.codes[0] && <CodeCard code={message.codes[0]} />}

          {!sent && message.links.length > 0 && (
            <section className="links" aria-label={t("detail.links")}>
              {uniqueLinks(message.links).map((link, index) => (
                <LinkChip key={link.url} link={link} index={index} />
              ))}
            </section>
          )}

          {!message.bodyParsed && (
            <motion.div
              className="card large-mail"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.06 }}
            >
              <span className="setting-icon">
                <IconFileZip size={18} stroke={1.5} />
              </span>
              <div>
                <b>{t("detail.largeTitle")}</b>
                <p className="muted small">{t("detail.largeBody", { size: formatBytes(message.sizeBytes, locale) })}</p>
              </div>
              {message.originalAvailable && (
                <a className="btn" href={files.original(message.id)} download>
                  <IconDownload size={16} stroke={1.5} /> {t("detail.downloadOriginal")}
                </a>
              )}
            </motion.div>
          )}

          {message.attachments.length > 0 && (
            <div className="card attachments">
              <div className="label">
                <IconPaperclip size={14} stroke={1.5} /> {plural("detail.attachments", message.attachmentCount)}
              </div>
              <ul>
                {message.attachments.map((attachment, index) => {
                  const name = attachment.filename ?? attachment.kind;
                  return (
                    <motion.li
                      key={attachment.id}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.24, ease: EASE_OUT, delay: 0.08 + index * 0.04 }}
                    >
                      {message.attachmentsDownloadable && files.attachment ? (
                        <Tip label={t("detail.downloadAttachment", { name })}>
                          <a className="attachment-link" href={files.attachment?.(message.id, attachment.id)} download>
                            <IconDownload size={14} stroke={1.5} />
                            <span className="mono">{name}</span>
                          </a>
                        </Tip>
                      ) : (
                        <span className="mono">{name}</span>
                      )}
                      <span className="muted">{formatBytes(attachment.sizeBytes, locale)}</span>
                      {attachmentExtra?.(message.id, attachment)}
                    </motion.li>
                  );
                })}
              </ul>
              {message.risk.reasons.includes("risky_attachment") && (
                <p className="attachment-warning small">
                  <IconAlertTriangle size={14} stroke={1.5} /> {t("detail.riskyAttachment")}
                </p>
              )}
              {!message.attachmentsDownloadable && <p className="muted small">{t("detail.attachmentsNote")}</p>}
            </div>
          )}

          {message.bodyParsed && (
            <>
              <Tabs tab={activeTab} onTab={setTab} hasHtml={hasHtml} />
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeTab}
                  className="panel"
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={{ duration: 0.24, ease: EASE_OUT }}
                >
                  {activeTab === "preview" && message.html ? (
                    <EmailFrame html={message.html} messageId={message.id} />
                  ) : message.text ? (
                    <pre className="raw">{message.text}</pre>
                  ) : (
                    <p className="muted">{t("detail.noBody")}</p>
                  )}
                  {message.bodyTruncated && <p className="muted small notice">{t("detail.truncated")}</p>}
                  {message.parseFailed && <p className="muted small notice">{t("detail.parseFailed")}</p>}
                </motion.div>
              </AnimatePresence>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}
