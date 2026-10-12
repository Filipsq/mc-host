import "server-only";
import type { Server } from "@prisma/client";
import { AgentError } from "./agent";
import type { Messages } from "@/i18n/messages";

export type FileError = keyof Messages["files"]["errors"];

/** The biggest file the editor opens. */
export const EDIT_MAX_BYTES = 1024 * 1024;

/** Unpaid servers' files can only be downloaded (and before the first payment there are none). */
export const canChangeFiles = (server: Pick<Server, "status">) =>
  server.status !== "SUSPENDED" && server.status !== "AWAITING_PAYMENT";

/** What went wrong with a file change, in the panel's words. */
export function fileError(err: unknown): FileError {
  if (err instanceof AgentError) {
    switch (err.status) {
      case 409:
        return err.message === "busy" ? "busy" : "exists";
      case 404:
        return "notFound";
      case 413:
        return "tooBig";
      case 507:
        return err.message === "quota" ? "quota" : "noSpace";
      case 400:
        return /zip|archive/.test(err.message) ? "badArchive" : "badName";
    }
  }
  console.error("file change failed", err);
  return "failed";
}
