# 30 seconds to hide, then 3 minutes of seeking.
scoreboard players add #hs_t mg 1
execute if score #hs_t mg matches 600 run function mg:hide/release
execute if score #hs_t mg matches ..599 run function mg:hide/bar_wait
execute if score #hs_t mg matches 600.. run function mg:hide/bar_seek
execute as @a[tag=mg_hs,y=-200,dy=279] run tp @s 0 100 145
execute if score #hs mg matches 1 unless entity @a[tag=mg_hs,tag=!mg_seek] run function mg:hide/seekers_win
execute if score #hs mg matches 1 unless entity @a[tag=mg_seek] run function mg:hide/hiders_win
execute if score #hs mg matches 1 if score #hs_t mg matches 4200.. run function mg:hide/hiders_win
