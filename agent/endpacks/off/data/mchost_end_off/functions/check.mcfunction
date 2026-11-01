# Every 2 ticks: an End portal lit near a player in the Overworld becomes structure void (no portal, nothing to see), so nobody gets in.
execute in minecraft:overworld as @a[distance=0..] at @s run fill ~-8 ~-5 ~-8 ~8 ~5 ~8 minecraft:structure_void replace minecraft:end_portal
# Players in the End (from before, or brought there by a mod) go back to the Overworld, near 0 0, on the ground.
execute in minecraft:the_end as @a[distance=0..] run tag @s add mchost_end_back
effect give @a[tag=mchost_end_back] minecraft:slow_falling 20
execute as @a[tag=mchost_end_back] in minecraft:overworld run tp @s 0 200 0
execute in minecraft:overworld run spreadplayers 0 0 0 16 false @a[tag=mchost_end_back]
tag @a remove mchost_end_back
schedule function mchost_end_off:check 2t
