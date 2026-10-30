scoreboard players set #btn mg 25
tag @a[x=-11,y=95,z=-11,dx=22,dy=15,dz=22,tag=!mg_game] add mg_tr
execute store result score #tr_n mg if entity @a[tag=mg_tr]
execute if score #tr_n mg matches 0 run return 0
tag @a[tag=mg_tr] add mg_game
scoreboard players set #tr mg 1
# Three seconds before the floor starts going.
scoreboard players set #tr_t mg -60
function mg:tntrun/reset
clear @a[tag=mg_tr]
effect clear @a[tag=mg_tr]
gamemode adventure @a[tag=mg_tr]
tp @a[tag=mg_tr] -100 101 0
spreadplayers -100 0 2 8 under 102 false @a[tag=mg_tr]
effect give @a[tag=mg_tr] minecraft:saturation infinite 0 true
title @a[tag=mg_tr] subtitle {"text":"Podłoga znika pod nogami: biegaj!","color":"white"}
title @a[tag=mg_tr] title {"text":"TNT Run!","color":"red"}
tellraw @a [{"text":"[Minigry] ","color":"gold"},{"text":"Zaczyna się TNT Run!","color":"red"}]
