scoreboard players add @a[tag=mg_pk] mg_pkt 1
execute as @a[tag=mg_pk,scores={mg_cp=..0}] at @s if block ~ ~-1 ~ minecraft:emerald_block run function mg:parkour/cp1
execute as @a[tag=mg_pk,scores={mg_cp=..1}] at @s if block ~ ~-1 ~ minecraft:diamond_block run function mg:parkour/cp2
execute as @a[tag=mg_pk,scores={mg_cp=..2}] at @s if block ~ ~-1 ~ minecraft:lapis_block run function mg:parkour/cp3
execute as @a[tag=mg_pk] at @s if block ~ ~-1 ~ minecraft:gold_block run function mg:parkour/finish
execute as @a[tag=mg_pk,y=-200,dy=293] run function mg:parkour/fall
