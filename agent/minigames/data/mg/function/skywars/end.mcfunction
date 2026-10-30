scoreboard players set #win mg 0
execute if score #sw_n mg matches 2.. if score #sw_alive mg matches 1 run scoreboard players set #win mg 1
execute if score #win mg matches 1 run tellraw @a [{"text":"[Minigry] ","color":"gold"},{"selector":"@a[tag=mg_sw]","color":"yellow"},{"text":" wygrywa SkyWars!","color":"green"}]
execute if score #win mg matches 1 run title @a[tag=mg_sw] title {"text":"Wygrana!","color":"gold"}
execute if score #win mg matches 0 run tellraw @a [{"text":"[Minigry] ","color":"gold"},{"text":"SkyWars: koniec rundy.","color":"gray"}]
execute as @a[tag=mg_sw] run function mg:to_lobby
function mg:skywars/reset
scoreboard players set #sw mg 0
