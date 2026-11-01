# The End was off for a while: portals it emptied near players get lit again.
execute in minecraft:overworld as @a[distance=0..] at @s run fill ~-8 ~-5 ~-8 ~8 ~5 ~8 minecraft:end_portal replace minecraft:structure_void
schedule function mchost_end_on:check 20t
