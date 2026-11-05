scoreboard players set #btn mg 25
tag @a[x=-11,y=95,z=-11,dx=22,dy=15,dz=22,tag=!mg_game] add mg_sp
execute store result score #sp_n mg if entity @a[tag=mg_sp]
execute if score #sp_n mg matches 0 run return 0
tag @a[tag=mg_sp] add mg_game
scoreboard players set #sp mg 1
# A countdown first (tick): 3, 2, 1, then the shovels.
scoreboard players set #sp_t mg -61
function mg:spleef/reset
clear @a[tag=mg_sp]
effect clear @a[tag=mg_sp]
gamemode adventure @a[tag=mg_sp]
tp @a[tag=mg_sp] 100 101 0
spreadplayers 100 0 2 8 under 102 false @a[tag=mg_sp]
effect give @a[tag=mg_sp] minecraft:slowness 3 255 true
effect give @a[tag=mg_sp] minecraft:saturation infinite 0 true
title @a[tag=mg_sp] subtitle {"text":"Kop śnieg pod innymi graczami","color":"white"}
title @a[tag=mg_sp] title {"text":"Spleef!","color":"aqua"}
tellraw @a [{"text":"[Minigry] ","color":"gold"},{"text":"Zaczyna się Spleef!","color":"aqua"}]
