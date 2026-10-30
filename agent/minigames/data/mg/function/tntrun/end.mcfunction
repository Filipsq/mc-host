scoreboard players set #win mg 0
execute if score #tr_n mg matches 2.. if score #tr_alive mg matches 1 run scoreboard players set #win mg 1
execute if score #win mg matches 1 run tellraw @a [{"text":"[Minigry] ","color":"gold"},{"selector":"@a[tag=mg_tr]","color":"yellow"},{"text":" wygrywa TNT Run!","color":"green"}]
execute if score #win mg matches 1 run title @a[tag=mg_tr] title {"text":"Wygrana!","color":"gold"}
execute if score #win mg matches 0 run tellraw @a [{"text":"[Minigry] ","color":"gold"},{"text":"TNT Run: koniec rundy.","color":"gray"}]
execute as @a[tag=mg_tr] run function mg:to_lobby
function mg:tntrun/reset
scoreboard players set #tr mg 0
