# Round lengths from the "czas" scores (minutes, 1-60; unset means the default).
execute unless score chowany czas matches 1.. run scoreboard players set chowany czas 3
execute unless score spleef czas matches 1.. run scoreboard players set spleef czas 5
execute unless score skywars czas matches 1.. run scoreboard players set skywars czas 10
execute if score chowany czas matches 61.. run scoreboard players set chowany czas 60
execute if score spleef czas matches 61.. run scoreboard players set spleef czas 60
execute if score skywars czas matches 61.. run scoreboard players set skywars czas 60
scoreboard players operation #hs_end mg = chowany czas
scoreboard players operation #hs_end mg *= #1200 mg
scoreboard players add #hs_end mg 600
scoreboard players operation #sp_end mg = spleef czas
scoreboard players operation #sp_end mg *= #1200 mg
scoreboard players operation #sw_end mg = skywars czas
scoreboard players operation #sw_end mg *= #1200 mg
