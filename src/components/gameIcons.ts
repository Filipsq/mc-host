import { Box, Cloud, Heart, Pickaxe, Puzzle, Shield } from "lucide-react";
import type { GameId } from "@/lib/games";

/** The icon shown with each ready game. */
export const GAME_ICONS = {
  survival: Pickaxe,
  "survival-plus": Shield,
  lifesteal: Heart,
  skyblock: Cloud,
  oneblock: Box,
  modpack: Puzzle,
} as const satisfies Record<GameId, unknown>;
