scoreboard players add #sw_t mg 1
execute if score #sw_t mg matches -60 as @a[tag=mg_sw] at @s run function mg:count/three
execute if score #sw_t mg matches -40 as @a[tag=mg_sw] at @s run function mg:count/two
execute if score #sw_t mg matches -20 as @a[tag=mg_sw] at @s run function mg:count/one
execute if score #sw_t mg matches 0 run function mg:skywars/go
execute as @a[tag=mg_sw,scores={mg_die=1..}] run function mg:skywars/out
execute as @a[tag=mg_sw,y=-200,dy=293] run function mg:skywars/out
execute store result score #sw_alive mg if entity @a[tag=mg_sw]
# Over when one is left (with company) or nobody (alone), or after 10 minutes.
execute if score #sw mg matches 1 if score #sw_n mg matches 2.. if score #sw_alive mg matches ..1 run function mg:skywars/end
execute if score #sw mg matches 1 if score #sw_alive mg matches 0 run function mg:skywars/end
execute if score #sw mg matches 1 if score #sw_t mg matches 12000.. run function mg:skywars/end
