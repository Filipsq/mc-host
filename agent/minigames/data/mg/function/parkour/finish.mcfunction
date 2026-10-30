scoreboard players operation @s mg_pkt /= #20 mg
tellraw @a [{"text":"[Minigry] ","color":"gold"},{"text":"Parkour ukończony: ","color":"light_purple"},{"selector":"@s","color":"yellow"},{"text":" (","color":"gray"},{"score":{"name":"@s","objective":"mg_pkt"},"color":"gray"},{"text":" s)","color":"gray"}]
title @s title {"text":"Meta!","color":"gold"}
function mg:to_lobby
