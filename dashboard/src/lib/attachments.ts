// The composer's files: which picked files fit the per-message limits, and whether the draft's
// files are ready to send. Uploads happen as soon as files are picked, like other mail clients.
import type { MessageKey } from "../i18n/translate";

export interface DraftFile {
  /** Local key, stable while the file uploads. */
  key: string;
  name: string;
  sizeBytes: number;
  /** Set once the Worker has the file. */
  uploadId: string | null;
  status: "uploading" | "ready" | "failed";
  /** Why the upload failed, from the Worker or the network. */
  error: string | null;
}

export interface AttachmentLimits {
  maxBytes: number;
  maxFiles: number;
}

/**
 * The picked files that fit after the ones already attached, in order, and the first reason one
 * did not. Failed uploads do not count: they are about to be removed or retried.
 */
export function admitFiles<T extends { name: string; size: number }>(
  current: DraftFile[],
  picked: T[],
  limits: AttachmentLimits,
): { admitted: T[]; problem: MessageKey | null } {
  const kept = current.filter((file) => file.status !== "failed");
  let count = kept.length;
  let bytes = kept.reduce((total, file) => total + file.sizeBytes, 0);
  const admitted: T[] = [];
  let problem: MessageKey | null = null;
  for (const file of picked) {
    if (file.size === 0) problem ??= "compose.fileEmpty";
    else if (count + 1 > limits.maxFiles) problem ??= "compose.tooManyFiles";
    else if (bytes + file.size > limits.maxBytes) problem ??= "compose.filesTooLarge";
    else {
      admitted.push(file);
      count += 1;
      bytes += file.size;
    }
  }
  return { admitted, problem };
}

/** Why the draft cannot be sent yet because of its files, or null. */
export function filesProblem(files: DraftFile[]): MessageKey | null {
  if (files.some((file) => file.status === "uploading")) return "compose.filesUploading";
  if (files.some((file) => file.status === "failed")) return "compose.filesFailed";
  return null;
}

export function uploadIds(files: DraftFile[]): string[] {
  return files.flatMap((file) => (file.uploadId ? [file.uploadId] : []));
}
