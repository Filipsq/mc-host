scoreboard players set #hs_s mg 600
scoreboard players operation #hs_s mg -= #hs_t mg
scoreboard players operation #hs_s mg /= #20 mg
title @a[tag=mg_hs] actionbar [{"text":"Szukający wychodzi za ","color":"yellow"},{"score":{"name":"#hs_s","objective":"mg"},"color":"yellow"},{"text":" s","color":"yellow"}]
