# Chowany: a little walled town south of the lobby (z 134 to 166) with houses,
# a barn, trees, bushes and hay to hide in, and a glass box outside for the
# seeker to wait in.
fill -16 97 134 16 98 166 minecraft:dirt
fill -16 99 134 16 99 166 minecraft:grass_block
fill -16 100 134 16 103 134 minecraft:stone_bricks
fill -16 100 166 16 103 166 minecraft:stone_bricks
fill -16 100 135 -16 103 165 minecraft:stone_bricks
fill 16 100 135 16 103 165 minecraft:stone_bricks
fill -1 99 135 1 99 165 minecraft:dirt_path
fill -15 99 149 15 99 151 minecraft:dirt_path
fill -2 99 148 2 99 152 minecraft:stone_bricks
fill -1 99 149 1 99 151 minecraft:water
# House (north-west), door to the east.
fill -13 99 137 -6 104 144 minecraft:oak_planks hollow
fill -6 100 140 -6 101 140 minecraft:air
fill -13 102 139 -13 102 142 minecraft:glass
fill -11 102 137 -8 102 137 minecraft:glass
setblock -12 100 138 minecraft:barrel
setblock -12 100 143 minecraft:crafting_table
fill -8 100 143 -7 101 143 minecraft:bookshelf
fill -12 100 140 -12 100 141 minecraft:barrel
# House (north-east), door to the west.
fill 6 99 137 13 103 144 minecraft:spruce_planks hollow
fill 6 100 140 6 101 140 minecraft:air
fill 13 101 139 13 101 142 minecraft:glass
setblock 12 100 138 minecraft:barrel
setblock 12 100 143 minecraft:composter
setblock 8 100 138 minecraft:cauldron
fill 11 100 141 12 101 142 minecraft:hay_block
# Stone house (south-west), door to the east.
fill -13 99 156 -6 103 163 minecraft:cobblestone hollow
fill -6 100 159 -6 101 159 minecraft:air
fill -13 101 158 -13 101 161 minecraft:glass
fill -12 100 162 -11 101 162 minecraft:barrel
setblock -12 100 157 minecraft:furnace
setblock -8 100 162 minecraft:bookshelf
# Barn (south-east), wide door to the west, full of hay.
fill 5 99 155 13 105 163 minecraft:dark_oak_planks hollow
fill 5 100 158 5 102 160 minecraft:air
fill 9 100 160 12 101 162 minecraft:hay_block
fill 10 102 161 12 102 162 minecraft:hay_block
fill 6 100 156 7 100 157 minecraft:hay_block
setblock 12 100 156 minecraft:barrel
# Trees, bushes, hay and a market stall.
fill -3 100 138 -3 103 138 minecraft:oak_log
fill -5 103 136 -1 105 140 minecraft:oak_leaves[persistent=true] keep
fill 3 100 162 3 103 162 minecraft:birch_log
fill 1 103 160 5 105 164 minecraft:birch_leaves[persistent=true] keep
fill 14 100 147 14 103 147 minecraft:spruce_log
fill 13 103 146 15 105 148 minecraft:spruce_leaves[persistent=true] keep
fill -15 100 146 -13 101 148 minecraft:oak_leaves[persistent=true]
fill 3 100 136 4 100 137 minecraft:oak_leaves[persistent=true]
fill -15 100 152 -14 100 154 minecraft:azalea_leaves[persistent=true]
fill -4 100 154 -3 101 155 minecraft:hay_block
setblock 4 100 146 minecraft:hay_block
fill -5 100 159 -5 102 159 minecraft:oak_fence
fill -3 100 159 -3 102 159 minecraft:oak_fence
fill -5 100 161 -5 102 161 minecraft:oak_fence
fill -3 100 161 -3 102 161 minecraft:oak_fence
fill -5 103 159 -3 103 161 minecraft:red_wool
setblock -4 100 160 minecraft:barrel
# The seeker's glass box, outside the wall.
fill -2 99 170 2 103 174 minecraft:glass hollow
summon minecraft:text_display 0.5 105 134.5 {Tags:["mg_label"],billboard:"center",text:{text:"Chowany",color:"green",bold:true}}
