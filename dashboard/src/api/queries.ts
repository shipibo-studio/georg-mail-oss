import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DraftInput } from "../lib/drafts";
import type { Folder } from "../lib/route";
import { api } from "./client";
import type { FullMessage, MailBox, Mailbox, MessagePage, SenderVerdict, SendRequest } from "./types";

// No polling: data refreshes when the owner asks (the refresh button) or comes back to the tab.

export const keys = {
  mailbox: ["mailbox"] as const,
  folder: (folder: Folder) => ["messages", folder] as const,
  search: (query: string) => ["messages", "search", query] as const,
  drafts: ["drafts"] as const,
  message: (id: string) => ["message", id] as const,
};

export function useMailbox() {
  return useQuery({ queryKey: keys.mailbox, queryFn: api.mailbox });
}

export function useFolder(folder: Folder) {
  return useInfiniteQuery({
    queryKey: keys.folder(folder),
    queryFn: ({ pageParam }) => api.messages(folder, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
}

/** Search results, newest first; nothing is fetched without a query. */
export function useSearch(query: string | null) {
  return useInfiniteQuery({
    queryKey: keys.search(query ?? ""),
    queryFn: ({ pageParam }) => api.search(query ?? "", pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: query !== null,
  });
}

type FolderData = InfiniteData<MessagePage, string | null>;

/** Takes a message out of every list at once, search results included: it has been moved or deleted. */
function dropFromFolders(client: ReturnType<typeof useQueryClient>, id: string) {
  client.setQueriesData<FolderData>({ queryKey: ["messages"] }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({ ...page, messages: page.messages.filter((item) => item.id !== id) })),
        }
      : data,
  );
}

function updateFolderMessages(
  client: ReturnType<typeof useQueryClient>,
  folder: Folder,
  update: (messages: MessagePage["messages"]) => MessagePage["messages"],
) {
  client.setQueryData<FolderData>(keys.folder(folder), (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, messages: update(page.messages) })) } : data,
  );
}

export function useMessage(id: string | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.message(id ?? "none"),
    enabled: id !== null,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const message = await api.message(id ?? "");
      // Opening a message marks it read on the server; reflect that in the list and the counter.
      updateFolderMessages(client, "inbox", (messages) =>
        messages.map((item) => (item.id === message.id ? { ...item, readAt: message.readAt } : item)),
      );
      client.invalidateQueries({ queryKey: keys.mailbox });
      return message;
    },
  });
}

export function useSendMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ message, idempotencyKey }: { message: SendRequest; idempotencyKey: string }) =>
      api.send(message, idempotencyKey),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.folder("sent") });
      client.invalidateQueries({ queryKey: keys.drafts });
    },
  });
}

export function useDeleteMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.remove(id),
    onMutate: (id) => {
      dropFromFolders(client, id);
      client.removeQueries({ queryKey: keys.message(id) });
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: keys.mailbox });
      client.invalidateQueries({ queryKey: ["messages"] });
    },
  });
}

/** Archive, Spam, Trash, or back to Inbox or Sent with `null`. The message leaves its list at once. */
export function useMoveMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, box, sender }: { id: string; box: MailBox | null; sender?: SenderVerdict | null }) =>
      api.move(id, box, sender),
    onMutate: ({ id, box }) => {
      dropFromFolders(client, id);
      client.setQueryData<FullMessage>(keys.message(id), (message) => (message ? { ...message, box } : message));
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: keys.mailbox });
      client.invalidateQueries({ queryKey: ["messages"] });
    },
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.updateSettings,
    // The switch moves at once; a failure puts it back.
    onMutate: async (settings) => {
      await client.cancelQueries({ queryKey: keys.mailbox });
      const previous = client.getQueryData<Mailbox>(keys.mailbox);
      if (previous) client.setQueryData<Mailbox>(keys.mailbox, { ...previous, ...settings });
      return { previous };
    },
    onError: (_error, _settings, context) => {
      if (context?.previous) client.setQueryData(keys.mailbox, context.previous);
    },
    onSuccess: (mailbox) =>
      client.setQueryData<Mailbox>(keys.mailbox, (previous) => ({ ...mailbox, unread: previous?.unread })),
  });
}

export function useDrafts() {
  return useQuery({ queryKey: keys.drafts, queryFn: api.drafts });
}

/** Creates the draft the first time, then keeps replacing it. */
export function useSaveDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: DraftInput }) =>
      id ? api.updateDraft(id, input) : api.createDraft(input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.drafts }),
  });
}

export function useDeleteDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.deleteDraft,
    onSettled: () => client.invalidateQueries({ queryKey: keys.drafts }),
  });
}
