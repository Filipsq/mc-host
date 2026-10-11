import type { Locale } from "./config";
import pl from "./messages/pl";
import en from "./messages/en";

// Polish is the source of truth; every other language must match its shape.
export type Messages = typeof pl;

export const messages: Record<Locale, Messages> = { pl, en };

// Fills {name} placeholders, e.g. format("Up to {n} players", { n: 10 }).
export function format(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}
