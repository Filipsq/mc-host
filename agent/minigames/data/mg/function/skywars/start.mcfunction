scoreboard players set #btn mg 25
tag @a[x=-11,y=95,z=-11,dx=22,dy=15,dz=22,tag=!mg_game] add mg_sw
execute store result score #sw_n mg if entity @a[tag=mg_sw]
execute if score #sw_n mg matches 0 run return 0
tag @a[tag=mg_sw] add mg_game
scoreboard players set #sw mg 1
scoreboard players set #sw_t mg 0
function mg:skywars/reset
clear @a[tag=mg_sw]
effect clear @a[tag=mg_sw]
gamemode survival @a[tag=mg_sw]
scoreboard players set @a[tag=mg_sw] mg_die 0
effect give @a[tag=mg_sw] minecraft:saturation 10 0 true
# Each player on an island of their own (with more than 8, two share one).
scoreboard players set #sw_i mg 0
execute as @a[tag=mg_sw] run function mg:skywars/put
title @a[tag=mg_sw] subtitle {"text":"Otwórz skrzynię, zbuduj most, walcz","color":"white"}
title @a[tag=mg_sw] title {"text":"SkyWars!","color":"yellow"}
tellraw @a [{"text":"[Minigry] ","color":"gold"},{"text":"Zaczyna się SkyWars!","color":"yellow"}]
