scoreboard players set #hs_s mg 4200
scoreboard players operation #hs_s mg -= #hs_t mg
scoreboard players operation #hs_s mg /= #20 mg
execute store result score #hs_left mg if entity @a[tag=mg_hs,tag=!mg_seek]
title @a[tag=mg_hs] actionbar [{"text":"Ukrytych: ","color":"green"},{"score":{"name":"#hs_left","objective":"mg"},"color":"green"},{"text":"   Zostało: ","color":"yellow"},{"score":{"name":"#hs_s","objective":"mg"},"color":"yellow"},{"text":" s","color":"yellow"}]
