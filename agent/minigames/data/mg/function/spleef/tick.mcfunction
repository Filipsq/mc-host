scoreboard players add #sp_t mg 1
execute if score #sp_t mg matches -60 as @a[tag=mg_sp] at @s run function mg:count/three
execute if score #sp_t mg matches -40 as @a[tag=mg_sp] at @s run function mg:count/two
execute if score #sp_t mg matches -20 as @a[tag=mg_sp] at @s run function mg:count/one
execute if score #sp_t mg matches 0 run function mg:spleef/go
execute as @a[tag=mg_sp,y=-200,dy=298] run function mg:spleef/out
execute store result score #sp_alive mg if entity @a[tag=mg_sp]
# Over when one is left (with company) or nobody (alone), or after 5 minutes.
execute if score #sp mg matches 1 if score #sp_n mg matches 2.. if score #sp_alive mg matches ..1 run function mg:spleef/end
execute if score #sp mg matches 1 if score #sp_alive mg matches 0 run function mg:spleef/end
execute if score #sp mg matches 1 if score #sp_t mg matches 6000.. run function mg:spleef/end
