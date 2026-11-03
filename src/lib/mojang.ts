// Looks up Java players' names at Mojang. The game image checks every name on
// a premium server's whitelist when the server starts and stops the start on
// a name with no Minecraft account ("Could not resolve user from Playerdb",
// ww123 2026-11-01), so the panel checks new names when they're saved.

const PREMIUM_NAME = /^[A-Za-z0-9_]{3,16}$/;

/** Of these names, the ones Mojang says have no Java account; none if Mojang can't be reached. */
export async function unknownJavaPlayers(names: string[]): Promise<string[]> {
  const asked = names.filter((n) => PREMIUM_NAME.test(n)).slice(0, 100);
  const found = await Promise.all(
    asked.map(async (name) => {
      try {
        const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, {
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        });
        // 404 (sometimes 204) means no such account; anything else, assume it's fine.
        return res.status === 404 || res.status === 204 ? name : null;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((n) => n !== null);
}
