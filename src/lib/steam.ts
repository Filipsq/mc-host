import "server-only";
import { TMOD_APP_ID } from "./terraria";

// Looks up tModLoader mods on the Steam Workshop through Steam's public Web
// API (ISteamRemoteStorage, which needs no API key). Searching the Workshop
// would need a key (IPublishedFileService/QueryFiles), so owners paste a mod's
// link or ID, or pick one of the popular mods (src/lib/terraria.ts).

const API = () => process.env.STEAM_API_URL ?? "https://api.steampowered.com";

export type WorkshopItem = {
  id: string;
  title: string;
  isCollection: boolean;
};

type Details = {
  publishedfileid: string;
  result: number; // 1: found
  title?: string;
  consumer_app_id?: number;
  file_size?: number | string;
  filename?: string;
};
type Collection = { publishedfileid: string; result: number; children?: { publishedfileid: string; filetype: number }[] };

/** `revalidate` keeps the answer for that many seconds. */
async function post<T>(method: string, fields: Record<string, string>, revalidate?: number): Promise<T> {
  const res = await fetch(`${API()}/ISteamRemoteStorage/${method}/v1/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(10_000),
    ...(revalidate ? { next: { revalidate } } : { cache: "no-store" }),
  });
  if (!res.ok) throw new Error(`Steam answered ${res.status} for ${method}`);
  return ((await res.json()) as { response: T }).response;
}

const listed = (ids: string[]) => Object.fromEntries(ids.map((id, i) => [`publishedfileids[${i}]`, id]));

/** tModLoader Workshop items among these IDs; ones that aren't (or don't exist) are left out. */
export async function getWorkshopItems(ids: string[], revalidate?: number): Promise<Map<string, WorkshopItem>> {
  const items = new Map<string, WorkshopItem>();
  if (ids.length === 0) return items;
  const res = await post<{ publishedfiledetails?: Details[] }>(
    "GetPublishedFileDetails",
    { itemcount: String(ids.length), ...listed(ids) },
    revalidate,
  );
  for (const d of res.publishedfiledetails ?? []) {
    if (d.result !== 1 || d.consumer_app_id !== TMOD_APP_ID) continue;
    // A collection is a list of items with no file of its own.
    const isCollection = !d.filename && Number(d.file_size ?? 0) === 0;
    items.set(d.publishedfileid, { id: d.publishedfileid, title: d.title || d.publishedfileid, isCollection });
  }
  return items;
}

/** Names of the server's mods for the panel, kept a day; empty if Steam doesn't answer. */
export async function getWorkshopTitles(ids: string[]): Promise<Map<string, string>> {
  try {
    const items = await getWorkshopItems(ids, 24 * 3600);
    return new Map([...items].map(([id, item]) => [id, item.title]));
  } catch (err) {
    console.error("Steam Workshop lookup failed", err);
    return new Map();
  }
}

/**
 * The mods to add for a pasted item: a mod and the mods it needs (Steam keeps
 * those as the item's children), or everything in a collection. Null if it
 * isn't a tModLoader item; throws if Steam doesn't answer.
 */
export async function resolveWorkshopItem(id: string): Promise<WorkshopItem[] | null> {
  const item = (await getWorkshopItems([id])).get(id);
  if (!item) return null;
  const res = await post<{ collectiondetails?: Collection[] }>("GetCollectionDetails", { collectioncount: "1", ...listed([id]) });
  const children = (res.collectiondetails?.[0]?.children ?? []).filter((c) => c.filetype === 0).map((c) => c.publishedfileid);
  const found = children.length > 0 ? await getWorkshopItems(children.slice(0, 100)) : new Map<string, WorkshopItem>();
  const mods = [...found.values()].filter((m) => !m.isCollection);
  return item.isCollection ? mods : [item, ...mods];
}
