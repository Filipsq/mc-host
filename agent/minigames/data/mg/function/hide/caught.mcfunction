tag @s add mg_seek
team join mg_seek @s
function mg:hide/helmet
title @s subtitle {"text":"Teraz ty szukasz","color":"white"}
title @s title {"text":"Znaleziony!","color":"red"}
tellraw @a[tag=mg_hs] [{"text":"Znaleziono: ","color":"red"},{"selector":"@s","color":"yellow"}]
