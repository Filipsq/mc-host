# Hit by a seeker (advancement mg:hide_hit): found, and seeks from now on.
advancement revoke @s only mg:hide_hit
execute if score #hs mg matches 1 if score #hs_t mg matches 600.. if entity @s[tag=mg_hs,tag=!mg_seek] run function mg:hide/caught
