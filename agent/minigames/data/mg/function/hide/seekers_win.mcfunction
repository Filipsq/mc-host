tellraw @a [{"text":"[Minigry] ","color":"gold"},{"text":"Chowany: wszyscy znalezieni, wygrywają szukający!","color":"red"}]
scoreboard players add @a[tag=mg_seek] mg_wins 1
execute as @a[tag=mg_seek] at @s run function mg:won
function mg:hide/end
