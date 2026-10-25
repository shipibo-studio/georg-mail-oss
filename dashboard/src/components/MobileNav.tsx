import { GESTURE, SPRING } from "@shipibo-studio/georg-ds/georg-motion.mjs";
import { IconDots, type IconInbox, IconPencilPlus, IconSettings } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { WORKSPACE_DESTINATIONS } from "../editions/workspace";
import { useI18n } from "../i18n/I18nProvider";
import { isSwipeDown } from "../lib/media";
import type { Route } from "../lib/route";
import { CountBadge } from "./controls";
import { ACCOUNT_ITEMS, MAIL_ITEMS, type NavItem } from "./nav-items";
import { VersionPanel } from "./UpdateDialog";

const [INBOX_ITEM, ...OTHER_FOLDERS] = MAIL_ITEMS;
const WORKSPACE_TABS = WORKSPACE_DESTINATIONS.filter((destination) => destination.phoneTab);
/** Two tabs beside Compose: the workspace's own, or the mail client's next folders without one. */
const SIDE_TABS: NavItem[] = (WORKSPACE_TABS.length > 0 ? WORKSPACE_TABS : OTHER_FOLDERS).slice(0, 2);
const MORE_ITEMS: NavItem[] = [...OTHER_FOLDERS, ...WORKSPACE_DESTINATIONS, ...ACCOUNT_ITEMS].filter(
  (item) => !SIDE_TABS.includes(item),
);

interface MobileNavProps {
  route: Route;
  unread: number;
  navigate(route: Route): void;
  onCompose(): void;
  onSettings(): void;
  onUpdate(): void;
}

function Tab({
  active,
  label,
  icon,
  badge = 0,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  badge?: number;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={`mobile-tab ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {active && (
        <motion.span layoutId="mobile-tab-highlight" className="mobile-tab-highlight" transition={SPRING.nav} />
      )}
      <span className="mobile-tab-icon">
        {icon}
        <CountBadge count={badge} />
      </span>
      <span className="mobile-tab-label">{label}</span>
    </button>
  );
}

/** The rest of the sidebar, as a bottom sheet that closes with a swipe down. */
function MoreSheet({
  open,
  onClose,
  items,
  onUpdate,
}: {
  open: boolean;
  onClose(): void;
  items: { label: string; icon: ReactNode; run(): void }[];
  onUpdate(): void;
}) {
  const { t } = useI18n();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            className="dialog more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.more")}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SPRING.sheet}
            drag="y"
            dragDirectionLock
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: GESTURE.sheetElastic }}
            dragSnapToOrigin
            onDragEnd={(_, info) => {
              if (isSwipeDown(info.offset.y, info.velocity.y)) onClose();
            }}
          >
            <span className="sheet-grabber" aria-hidden="true" />
            {items.map((item, index) => (
              <motion.button
                key={item.label}
                type="button"
                className="more-item"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + index * 0.04 }}
                onClick={() => {
                  onClose();
                  item.run();
                }}
              >
                {item.icon}
                {item.label}
              </motion.button>
            ))}
            {/* The sidebar's version panel, which phones do not show. */}
            <VersionPanel
              onUpdate={() => {
                onClose();
                onUpdate();
              }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Phones only (hidden by CSS elsewhere): the sidebar's destinations within thumb reach. */
export function MobileNav({ route, unread, navigate, onCompose, onSettings, onUpdate }: MobileNavProps) {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const inMore = MORE_ITEMS.some((item) => item.active(route));
  const icon = (Icon: typeof IconInbox) => <Icon size={20} stroke={1.5} />;
  const tab = (item: NavItem, badge = 0) => (
    <Tab
      key={item.id}
      active={item.active(route)}
      label={t(item.label)}
      icon={icon(item.Icon)}
      badge={badge}
      onClick={() => navigate(item.route)}
    />
  );
  return (
    <>
      <nav className="mobile-nav" aria-label={t("nav.folders")}>
        {INBOX_ITEM && tab(INBOX_ITEM, unread)}
        {SIDE_TABS[0] && tab(SIDE_TABS[0])}
        <motion.button
          type="button"
          className="mobile-compose"
          aria-label={t("nav.compose")}
          onClick={onCompose}
          whileTap={{ scale: 0.9 }}
          transition={SPRING.pop}
        >
          <IconPencilPlus size={22} stroke={1.5} />
        </motion.button>
        {SIDE_TABS[1] && tab(SIDE_TABS[1])}
        <Tab active={inMore} label={t("nav.more")} icon={icon(IconDots)} onClick={() => setMoreOpen(true)} />
      </nav>
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onUpdate={onUpdate}
        items={[
          ...MORE_ITEMS.map((item) => ({
            label: t(item.label),
            icon: icon(item.Icon),
            run: () => navigate(item.route),
          })),
          { label: t("nav.settings"), icon: icon(IconSettings), run: onSettings },
        ]}
      />
    </>
  );
}
