scoreboard players add #tr_t mg 1
scoreboard players add #tr_c mg 1
execute if score #tr_c mg matches -60 as @a[tag=mg_tr] at @s run function mg:count/three
execute if score #tr_c mg matches -40 as @a[tag=mg_tr] at @s run function mg:count/two
execute if score #tr_c mg matches -20 as @a[tag=mg_tr] at @s run function mg:count/one
execute if score #tr_c mg matches 0 as @a[tag=mg_tr] at @s run function mg:count/go
execute if score #tr_t mg matches 0.. as @a[tag=mg_tr] at @s run function mg:tntrun/step
execute if score #tr_t mg matches 5.. run function mg:tntrun/decay
execute as @a[tag=mg_tr,y=-200,dy=287] run function mg:tntrun/out
execute store result score #tr_alive mg if entity @a[tag=mg_tr]
execute if score #tr mg matches 1 if score #tr_n mg matches 2.. if score #tr_alive mg matches ..1 run function mg:tntrun/end
execute if score #tr mg matches 1 if score #tr_alive mg matches 0 run function mg:tntrun/end
