scoreboard players set #win mg 0
execute if score #sp_n mg matches 2.. if score #sp_alive mg matches 1 run scoreboard players set #win mg 1
execute if score #win mg matches 1 run tellraw @a [{"text":"[Minigry] ","color":"gold"},{"selector":"@a[tag=mg_sp]","color":"yellow"},{"text":" wygrywa Spleefa!","color":"green"}]
execute if score #win mg matches 1 run title @a[tag=mg_sp] title {"text":"Wygrana!","color":"gold"}
execute if score #win mg matches 0 run tellraw @a [{"text":"[Minigry] ","color":"gold"},{"text":"Spleef: koniec rundy.","color":"gray"}]
execute as @a[tag=mg_sp] run function mg:to_lobby
function mg:spleef/reset
scoreboard players set #sp mg 0
