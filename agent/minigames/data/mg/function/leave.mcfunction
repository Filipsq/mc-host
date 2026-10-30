scoreboard players set @s lobby 0
execute if entity @s[tag=mg_game] run tellraw @a [{"text":"[Minigry] ","color":"gold"},{"selector":"@s","color":"yellow"},{"text":" wraca do lobby.","color":"gray"}]
function mg:to_lobby
