import "server-only";

// The game machines ("nodes"). The main one runs next to the site and is set
// up by AGENT_URL, AGENT_TOKEN, MEMORY_LIMIT_MB, GAME_HOST and GAME_ARCH. Extra machines
// run only the agent and are listed in NODES as JSON (deploy/add-node.sh writes it):
//   NODES='[{"id":"n2","url":"http://10.88.0.2:8081","token":"…","host":"n2.example.com","memoryLimitMb":2560,"arch":"amd64"}]'
// An entry may add "overbook": 2.5 to sell that machine's memory more (or less) times than MEMORY_OVERBOOK.
// Each server stays on the machine it was created on (Server.node). Java
// players still connect through the main machine, whose router passes
// addresses it doesn't host on to the others (agent/peers.go); Bedrock and
// Terraria players connect straight to the server's machine at `host`.

export const MAIN_NODE = "main";

export type GameNode = {
  id: string;
  url: string;
  token: string;
  host: string; // what Bedrock and Terraria players type to reach this machine
  memoryLimitMb: number; // plan memory its servers may share; 0 means no limit
  arch: string; // its processor, amd64 or arm64 (deploy/setup.sh and add-node.sh find out); empty if not known
  overbook?: number; // how many times its memory is sold to paid plans, instead of MEMORY_OVERBOOK (extra machines only)
};

let cached: GameNode[] | undefined;

export function nodes(): GameNode[] {
  if (cached) return cached;
  const main: GameNode = {
    id: MAIN_NODE,
    url: process.env.AGENT_URL ?? "",
    token: process.env.AGENT_TOKEN ?? "",
    host: process.env.GAME_HOST ?? "localhost",
    memoryLimitMb: Number(process.env.MEMORY_LIMIT_MB) || 0,
    arch: process.env.GAME_ARCH ?? "",
  };
  const extra: GameNode[] = [];
  if (process.env.NODES?.trim()) {
    try {
      for (const n of JSON.parse(process.env.NODES) as Partial<GameNode>[]) {
        if (!n.id || n.id === MAIN_NODE || !n.url || !n.token || !n.host) throw new Error(`incomplete node ${JSON.stringify(n.id)}`);
        extra.push({
          id: n.id,
          url: n.url,
          token: n.token,
          host: n.host,
          memoryLimitMb: Number(n.memoryLimitMb) || 0,
          arch: n.arch ?? "",
          ...(Number(n.overbook) >= 1 && { overbook: Number(n.overbook) }),
        });
      }
    } catch (err) {
      // A typo in .env shouldn't take the site down; the main machine still works.
      console.error("NODES is not valid, using only the main machine:", (err as Error).message);
      extra.length = 0;
    }
  }
  cached = [main, ...extra];
  return cached;
}

/** The machine with this id; servers on a machine since removed from NODES fall back to the main one. */
export function nodeById(id: string | null | undefined): GameNode {
  const all = nodes();
  return all.find((n) => n.id === id) ?? all[0];
}

/** Where the machine's router takes Java players: its agent's address, on the Java port. */
export function routerAddress(node: GameNode) {
  return `${new URL(node.url).hostname}:25565`;
}
