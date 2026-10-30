# The islands come back from their copy at z -350 (both are kept loaded), and
# whatever players built above or below them goes.
fill -27 105 -177 27 109 -123 minecraft:air
fill -27 110 -177 27 114 -123 minecraft:air
fill -27 85 -177 27 89 -123 minecraft:air
fill -27 90 -177 27 94 -123 minecraft:air
clone -27 95 -377 27 104 -323 -27 95 -177
kill @e[type=!minecraft:player,type=!minecraft:text_display,x=-30,y=60,z=-180,dx=60,dy=70,dz=60]
