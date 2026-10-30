scoreboard players set #btn mg 25
tag @a[x=-11,y=95,z=-11,dx=22,dy=15,dz=22,tag=!mg_game] add mg_hs
execute store result score #hs_n mg if entity @a[tag=mg_hs]
execute if score #hs_n mg matches ..1 run tellraw @a[tag=mg_hs] {"text":"Chowany potrzebuje co najmniej 2 graczy w lobby.","color":"red"}
execute if score #hs_n mg matches ..1 run return run tag @a remove mg_hs
tag @a[tag=mg_hs] add mg_game
scoreboard players set #hs mg 1
scoreboard players set #hs_t mg 0
tag @r[tag=mg_hs] add mg_seek
team join mg_seek @a[tag=mg_seek]
team join mg_hide @a[tag=mg_hs,tag=!mg_seek]
clear @a[tag=mg_hs]
effect clear @a[tag=mg_hs]
gamemode adventure @a[tag=mg_hs]
effect give @a[tag=mg_hs] minecraft:saturation infinite 0 true
effect give @a[tag=mg_hs] minecraft:regeneration infinite 1 true
advancement revoke @a[tag=mg_hs] only mg:hide_hit
tp @a[tag=mg_hs,tag=!mg_seek] 0 100 145
tp @a[tag=mg_seek] 0 100 172
effect give @a[tag=mg_seek] minecraft:blindness 30 0 true
execute as @a[tag=mg_seek] run function mg:hide/helmet
title @a[tag=mg_hs,tag=!mg_seek] subtitle {"text":"Szukający wychodzi za 30 sekund","color":"white"}
title @a[tag=mg_hs,tag=!mg_seek] title {"text":"Chowaj się!","color":"green"}
title @a[tag=mg_seek] subtitle {"text":"Wychodzisz za 30 sekund. Uderz, kogo znajdziesz","color":"white"}
title @a[tag=mg_seek] title {"text":"Szukasz!","color":"red"}
tellraw @a [{"text":"[Minigry] ","color":"gold"},{"text":"Zaczyna się Chowany! Szuka: ","color":"green"},{"selector":"@a[tag=mg_seek]","color":"red"}]
