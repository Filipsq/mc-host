# Parkour: a course of jumps south of the lobby (z 250 to 349), with three checkpoints
# (emerald, diamond, lapis) and a gold finish.
fill -1 99 250 1 99 252 minecraft:quartz_block
setblock 0 99 255 minecraft:light_blue_concrete
setblock 1 99 258 minecraft:light_blue_concrete
setblock 1 100 260 minecraft:light_blue_concrete
setblock 0 100 263 minecraft:light_blue_concrete
setblock -1 100 266 minecraft:light_blue_concrete
setblock -1 101 268 minecraft:light_blue_concrete
setblock 0 101 271 minecraft:light_blue_concrete
setblock 1 102 273 minecraft:light_blue_concrete
setblock 1 102 276 minecraft:emerald_block
setblock 0 102 279 minecraft:lime_concrete
setblock 0 102 283 minecraft:lime_concrete
setblock -1 103 285 minecraft:lime_concrete
setblock -1 103 288 minecraft:lime_concrete
setblock 1 103 290 minecraft:lime_concrete
setblock 1 104 292 minecraft:lime_concrete
setblock 1 103 295 minecraft:lime_concrete
setblock 0 104 297 minecraft:lime_concrete
setblock 0 104 300 minecraft:diamond_block
setblock 1 104 303 minecraft:yellow_concrete
setblock 1 105 305 minecraft:yellow_concrete
setblock 2 105 308 minecraft:yellow_concrete
setblock 2 105 312 minecraft:yellow_concrete
setblock 1 106 314 minecraft:yellow_concrete
setblock 0 106 317 minecraft:yellow_concrete
setblock 0 107 319 minecraft:yellow_concrete
setblock 0 107 322 minecraft:yellow_concrete
setblock 1 107 325 minecraft:lapis_block
setblock 1 108 327 minecraft:orange_concrete
setblock 0 108 330 minecraft:orange_concrete
setblock 0 108 334 minecraft:orange_concrete
setblock 1 109 336 minecraft:orange_concrete
setblock 1 109 339 minecraft:orange_concrete
setblock 0 109 342 minecraft:orange_concrete
setblock 0 110 344 minecraft:orange_concrete
fill -1 110 347 1 110 349 minecraft:gold_block
summon minecraft:text_display 0.5 102 250.5 {Tags:["mg_label"],billboard:"center",text:{text:"Parkour: skacz do złotej mety",color:"light_purple",bold:true}}
