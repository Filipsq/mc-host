// Masks swear words and slurs (Polish and English) in text other players see,
// such as opinions and their signatures on the home page: "Ni**r", "ku***a".
// The stored text stays as written; only what is shown is masked. Matching
// ignores case, Polish letters, simple digit swaps (n1gg3r) and stretched
// letters (kuuurwa), so the usual tricks still get caught.

// Parts that make any word containing them a swear word ("zajebisty", "spierdalaj").
const ROOTS = [
  "kurw", "chuj", "huj", "jeb", "pierdol", "pierdal", "pizd", "skurw", "kutas", "cwel", "dziwk", "szmul",
  "fuck", "shit", "cunt", "nigger", "nigga", "nigg", "fagot", "faggot", "bitch", "whore", "slut", "dick", "cock", "pussy", "asshol", "bastard", "retard",
  "pedal", "hitler",
];
// Words only bad on their own (they hide inside harmless words otherwise: "Nigeria", "kutasik" is covered above).
const WORDS = new Set([
  "niger", "nigers", "negr", "negro", "nygus", "cipa", "cipy", "cipe", "cipka", "fiut", "debil", "kretyn", "spermiarz", "dupek", "chuj",
  "ass", "fag", "fags", "kys", "jebac", "suka", "suki", "ruchac", "ruchanie", "zjeb", "zjeby", "niga", "nigas", "ciota", "cioty", "ciote", "nazi", "nazis",
]);
// Harmless words that contain a root above.
const SAFE = new Set(["dickens", "cocktail", "cocktails", "peacock", "hancock", "scunthorpe", "nazir", "pedaly", "pedalowac"]);

const LEET: Record<string, string> = { "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "8": "b" };

/** Lower case, no Polish letters, digits back to letters, no stretched letters. */
function plain(word: string): string {
  const s = word
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0-9!@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, "");
  return s.replace(/(.)\1+/g, "$1");
}

function bad(word: string): boolean {
  const p = plain(word);
  if (p.length < 3 || SAFE.has(p)) return false;
  if (WORDS.has(p)) return true;
  // Also check without collapsing, so "faggot" and "nigger" match their own spelling.
  const raw = word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9!@$]/g, "");
  return ROOTS.some((r) => p.includes(r) || raw.includes(r));
}

/** "Nigger" -> "Ni****r": first two letters and the last stay, so it's clear something was there. */
function mask(word: string): string {
  const chars = [...word];
  if (chars.length <= 3) return chars[0] + "*".repeat(chars.length - 1);
  return chars.slice(0, 2).join("") + "*".repeat(chars.length - 3) + chars[chars.length - 1];
}

/** The text with every swear word masked; everything else untouched. */
export function censor(text: string): string {
  return text.replace(/[\p{L}\p{N}!@$]+/gu, (w) => (bad(w) ? mask(w) : w));
}

/** Whether the text has anything censor() would mask. */
export function hasProfanity(text: string): boolean {
  return censor(text) !== text;
}
