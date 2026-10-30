import { Box, Cloud, Gamepad2, Ghost, Heart, Pickaxe, Puzzle, Shield, TreePine, Wrench } from "lucide-react";
import type { GameId } from "@/lib/games";

/** The icon shown with each ready game. */
export const GAME_ICONS = {
  survival: Pickaxe,
  "survival-plus": Shield,
  lifesteal: Heart,
  skymap: TreePine,
  halloween: Ghost,
  minigames: Gamepad2,
  skyblock: Cloud,
  oneblock: Box,
  modpack: Puzzle,
  mods: Wrench,
} as const satisfies Record<GameId, unknown>;
