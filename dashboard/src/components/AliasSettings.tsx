// The mailbox's addresses in Settings: its own, and the aliases the owner adds from the addresses
// the install accepts (PERSONAL_MAILBOX_ADDRESSES). Mail to an alias lands in the same inbox.
import { IconAt, IconPlus, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ApiError } from "../api/client";
import { useAliasChange } from "../api/queries";
import type { Mailbox } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import { BusyLabel, ButtonSpinner, busyButton } from "./controls";
import { useToast } from "./Toasts";

export function AliasSettings({ mailbox }: { mailbox: Mailbox }) {
  const { t } = useI18n();
  const toast = useToast();
  const { add, remove } = useAliasChange();
  const [choice, setChoice] = useState("");
  const claimable = mailbox.claimableAliases;
  const selected = claimable.includes(choice) ? choice : (claimable[0] ?? "");
  const failed = (error: unknown) =>
    toast(error instanceof ApiError ? error.message : t("error.generic"), { kind: "error" });

  return (
    <div className="alias-settings">
      <ul className="alias-list">
        <li className="alias-row">
          <IconAt size={14} stroke={1.5} />
          <span className="mono">{mailbox.address}</span>
          <span className="alias-main">{t("aliases.main")}</span>
        </li>
        <AnimatePresence initial={false}>
          {mailbox.aliases.map((alias) => (
            <motion.li
              key={alias}
              className="alias-row"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <IconAt size={14} stroke={1.5} />
              <span className="mono">{alias}</span>
              <button
                type="button"
                className="g-button g-button-ghost g-button-icon"
                aria-label={t("aliases.remove", { address: alias })}
                {...busyButton(remove.isPending && remove.variables === alias)}
                disabled={remove.isPending && remove.variables !== alias}
                onClick={() =>
                  remove.mutate(alias, {
                    onSuccess: () => toast(t("aliases.removed", { address: alias })),
                    onError: failed,
                  })
                }
              >
                <ButtonSpinner />
                <BusyLabel>
                  <IconX size={14} stroke={1.5} />
                </BusyLabel>
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {claimable.length > 0 ? (
        <div className="alias-add">
          <select
            className="g-input select mono"
            aria-label={t("aliases.choose")}
            value={selected}
            onChange={(event) => setChoice(event.target.value)}
          >
            {claimable.map((address) => (
              <option key={address} value={address}>
                {address}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="g-button"
            {...busyButton(add.isPending)}
            disabled={!selected}
            onClick={() =>
              add.mutate(selected, {
                onSuccess: () => toast(t("aliases.added", { address: selected })),
                onError: failed,
              })
            }
          >
            <IconPlus size={14} stroke={1.5} />
            {t("aliases.add")}
          </button>
        </div>
      ) : (
        <p className="muted small">{t("aliases.howToAdd")}</p>
      )}
    </div>
  );
}
