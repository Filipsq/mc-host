# The block under each foot (and under the edges of the player) turns orange, then red, then goes.
execute positioned ~ ~-0.5 ~ if block ~ ~ ~ minecraft:white_concrete run setblock ~ ~ ~ minecraft:orange_concrete
execute positioned ~0.3 ~-0.5 ~0.3 if block ~ ~ ~ minecraft:white_concrete run setblock ~ ~ ~ minecraft:orange_concrete
execute positioned ~-0.3 ~-0.5 ~0.3 if block ~ ~ ~ minecraft:white_concrete run setblock ~ ~ ~ minecraft:orange_concrete
execute positioned ~0.3 ~-0.5 ~-0.3 if block ~ ~ ~ minecraft:white_concrete run setblock ~ ~ ~ minecraft:orange_concrete
execute positioned ~-0.3 ~-0.5 ~-0.3 if block ~ ~ ~ minecraft:white_concrete run setblock ~ ~ ~ minecraft:orange_concrete
