execute as @a[tag=!mg_known] run function mg:welcome
scoreboard players enable @a lobby
execute as @a[scores={lobby=1..}] run function mg:leave

# Players left over from a round that's over (they were away, or the server restarted).
execute as @a[tag=mg_sp] if score #sp mg matches 0 run function mg:to_lobby
execute as @a[tag=mg_tr] if score #tr mg matches 0 run function mg:to_lobby
execute as @a[tag=mg_sw] if score #sw mg matches 0 run function mg:to_lobby
execute as @a[tag=mg_hs] if score #hs mg matches 0 run function mg:to_lobby
# Fell off the lobby.
execute as @a[tag=!mg_game,y=-200,dy=279] run function mg:to_lobby

# Buttons. A button stays pressed for a second, so one press is one start.
execute if score #btn mg matches 1.. run scoreboard players remove #btn mg 1
execute if score #btn mg matches 0 if score #sp mg matches 0 if block -6 101 -9 minecraft:stone_button[powered=true] run function mg:spleef/start
execute if score #btn mg matches 0 if score #tr mg matches 0 if block -3 101 -9 minecraft:stone_button[powered=true] run function mg:tntrun/start
execute if score #btn mg matches 0 if score #sw mg matches 0 if block 0 101 -9 minecraft:stone_button[powered=true] run function mg:skywars/start
execute if score #btn mg matches 0 if score #hs mg matches 0 if block 3 101 -9 minecraft:stone_button[powered=true] run function mg:hide/start
execute if score #btn mg matches 0 if block 6 101 -9 minecraft:stone_button[powered=true] run function mg:parkour/press

execute if score #sp mg matches 1 run function mg:spleef/tick
execute if score #tr mg matches 1 run function mg:tntrun/tick
execute if score #sw mg matches 1 run function mg:skywars/tick
execute if score #hs mg matches 1 run function mg:hide/tick
execute if entity @a[tag=mg_pk] run function mg:parkour/tick

scoreboard players add #sec mg 1
execute if score #sec mg matches 20.. run function mg:second
