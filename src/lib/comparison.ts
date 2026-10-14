// The free plans on the comparison page (/porownanie). The cells themselves are in the
// messages (compare.rows), one per provider in this order, so they can be translated.
// Every cell about another host must come from that host's own pages listed in SOURCES;
// when they change their offer, update the cell, the sources and compare.asOf together.

export const PROVIDERS = ["MCHosting", "Aternos", "FalixNodes", "Cloudly"] as const;

export type Mark = "yes" | "no" | "some" | "info";

export const SOURCES: { provider: (typeof PROVIDERS)[number]; label: string; url: string }[] = [
  { provider: "Aternos", label: "Queue", url: "https://support.aternos.org/hc/en-us/articles/360026950812-Queue" },
  {
    provider: "Aternos",
    label: "Autostart Aternos servers using the Dawn launcher",
    url: "https://support.aternos.org/hc/en-us/articles/38958320292637-Autostart-Aternos-servers-using-the-Dawn-launcher",
  },
  { provider: "Aternos", label: "Server RAM", url: "https://support.aternos.org/hc/en-us/articles/12046003680157-Server-RAM" },
  { provider: "Aternos", label: "Lags", url: "https://support.aternos.org/hc/en-us/articles/12562176027549-Lags" },
  { provider: "Aternos", label: "You are using an adblocker", url: "https://support.aternos.org/hc/en-us/articles/360034748092-You-are-using-an-adblocker" },
  { provider: "Aternos", label: "Geyser", url: "https://support.aternos.org/hc/en-us/articles/360051047631-Geyser" },
  { provider: "Aternos", label: "Share access", url: "https://support.aternos.org/hc/en-us/articles/360026950952-Share-access" },
  {
    provider: "Aternos",
    label: "Creating and restoring backups",
    url: "https://support.aternos.org/hc/en-us/articles/360044837012-Creating-and-restoring-backups",
  },
  {
    provider: "Aternos",
    label: "Install modpacks (Minecraft: Java Edition)",
    url: "https://support.aternos.org/hc/en-us/articles/4409967265425-Install-modpacks-Minecraft-Java-Edition",
  },
  { provider: "Aternos", label: "Connect to your server", url: "https://support.aternos.org/hc/en-us/articles/360026805072-Connect-to-your-server" },
  { provider: "Aternos", label: "Contact support", url: "https://support.aternos.org/hc/en-us/articles/360027235811-Contact-support" },
  {
    provider: "Aternos",
    label: "How to write a support request",
    url: "https://support.aternos.org/hc/en-us/articles/360018083278-How-to-write-a-support-request",
  },
  { provider: "FalixNodes", label: "Free Minecraft server hosting", url: "https://falixnodes.net/free-minecraft-server-hosting" },
  { provider: "FalixNodes", label: "Queue", url: "https://kb.falixnodes.net/falix/dashboard/server/queue" },
  { provider: "FalixNodes", label: "Free plan gaming", url: "https://client.falixnodes.net/guides/game-servers/free-plan-gaming" },
  { provider: "FalixNodes", label: "Ad blocker", url: "https://kb.falixnodes.net/falix/dashboard/setup/ad-blocker" },
  {
    provider: "FalixNodes",
    label: "Minecraft Bedrock and crossplay",
    url: "https://client.falixnodes.net/guides/game-servers/minecraft-bedrock-and-crossplay",
  },
  { provider: "FalixNodes", label: "Server console", url: "https://kb.falixnodes.net/falix/dashboard/monitoring/server-console" },
  { provider: "FalixNodes", label: "Minecraft performance", url: "https://client.falixnodes.net/guides/game-servers/minecraft-performance" },
  { provider: "FalixNodes", label: "Sub-users", url: "https://kb.falixnodes.net/falix/dashboard/automation/sub-users" },
  { provider: "FalixNodes", label: "Free vs premium", url: "https://client.falixnodes.net/guides/start/free-vs-premium" },
  {
    provider: "FalixNodes",
    label: "Minecraft mods and modpacks",
    url: "https://client.falixnodes.net/guides/game-servers/minecraft-mods-and-modpacks",
  },
  { provider: "Cloudly", label: "Darmowe serwery", url: "https://cloudly.pl/darmowe-serwery/" },
  { provider: "Cloudly", label: "Hosting Minecraft", url: "https://cloudly.pl/hosting-minecraft/" },
];
