tellraw @a [{"text":"[Minigry] ","color":"gold"},{"text":"Chowany: wygrywają ukryci: ","color":"green"},{"selector":"@a[tag=mg_hs,tag=!mg_seek]","color":"yellow"}]
title @a[tag=mg_hs,tag=!mg_seek] title {"text":"Wygrana!","color":"gold"}
scoreboard players add @a[tag=mg_hs,tag=!mg_seek] mg_wins 1
execute as @a[tag=mg_hs,tag=!mg_seek] at @s run function mg:won
function mg:hide/end
