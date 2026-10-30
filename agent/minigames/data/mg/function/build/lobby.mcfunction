# Lobby at the world spawn: a floor in the void, a glass rail and a back wall
# with a button for each game.
fill -10 99 -10 10 99 10 minecraft:smooth_quartz
fill -9 99 -9 9 99 9 minecraft:light_gray_concrete
fill -1 99 -1 1 99 1 minecraft:sea_lantern
setblock -8 99 -8 minecraft:sea_lantern
setblock 8 99 -8 minecraft:sea_lantern
setblock -8 99 8 minecraft:sea_lantern
setblock 8 99 8 minecraft:sea_lantern
fill -10 100 10 10 101 10 minecraft:glass
fill -10 100 -9 -10 101 9 minecraft:glass
fill 10 100 -9 10 101 9 minecraft:glass
fill -10 100 -10 10 104 -10 minecraft:quartz_bricks
setblock -6 101 -10 minecraft:light_blue_concrete
setblock -3 101 -10 minecraft:red_concrete
setblock 0 101 -10 minecraft:yellow_concrete
setblock 3 101 -10 minecraft:lime_concrete
setblock 6 101 -10 minecraft:purple_concrete
setblock -6 99 -8 minecraft:light_blue_concrete
setblock -3 99 -8 minecraft:red_concrete
setblock 0 99 -8 minecraft:yellow_concrete
setblock 3 99 -8 minecraft:lime_concrete
setblock 6 99 -8 minecraft:purple_concrete
setblock -6 101 -9 minecraft:stone_button[face=wall,facing=south]
setblock -3 101 -9 minecraft:stone_button[face=wall,facing=south]
setblock 0 101 -9 minecraft:stone_button[face=wall,facing=south]
setblock 3 101 -9 minecraft:stone_button[face=wall,facing=south]
setblock 6 101 -9 minecraft:stone_button[face=wall,facing=south]
summon minecraft:text_display 0.5 105.6 -9.4 {Tags:["mg_label"],billboard:"center",text:{text:"MINIGRY",color:"gold",bold:true},transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[3f,3f,3f]}}
summon minecraft:text_display 0.5 104.9 -9.4 {Tags:["mg_label"],billboard:"center",text:{text:"Wciśnij przycisk: gra zaczyna się dla wszystkich w lobby",color:"white"}}
summon minecraft:text_display -5.5 102.4 -8.9 {Tags:["mg_label"],billboard:"center",text:{text:"Spleef",color:"aqua",bold:true}}
summon minecraft:text_display -2.5 102.4 -8.9 {Tags:["mg_label"],billboard:"center",text:{text:"TNT Run",color:"red",bold:true}}
summon minecraft:text_display 0.5 102.4 -8.9 {Tags:["mg_label"],billboard:"center",text:{text:"SkyWars",color:"yellow",bold:true}}
summon minecraft:text_display 3.5 102.4 -8.9 {Tags:["mg_label"],billboard:"center",text:{text:"Chowany",color:"green",bold:true}}
summon minecraft:text_display 6.5 102.4 -8.9 {Tags:["mg_label"],billboard:"center",text:{text:"Parkour",color:"light_purple",bold:true}}
summon minecraft:text_display 0.5 101.2 8.4 {Tags:["mg_label"],billboard:"center",text:{text:"/trigger lobby: powrót do lobby",color:"gray"}}
setworldspawn 0 100 0
