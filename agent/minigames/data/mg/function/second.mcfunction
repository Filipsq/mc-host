# Once a second: nobody gets hungry or hurt in the lobby or on the parkour.
scoreboard players set #sec mg 0
effect give @a[tag=!mg_game] minecraft:saturation 3 0 true
effect give @a[tag=!mg_game] minecraft:resistance 3 4 true
effect give @a[tag=mg_pk] minecraft:saturation 3 0 true
# Nobody breaks the lobby: survival there turns to adventure (creative, for the owner building, stays).
gamemode adventure @a[tag=!mg_game,gamemode=survival]
