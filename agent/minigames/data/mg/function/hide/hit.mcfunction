# Hurt (advancement mg:hide_hit) with a seeker next to them: found, and seeks
# from now on. The advancement has no conditions, as their format differs
# between versions; hiders can't hurt each other (friendlyFire) and there's no
# fall damage (the agent's rules), so a seeker within reach is who hit.
advancement revoke @s only mg:hide_hit
execute if score #hs mg matches 1 if score #hs_t mg matches 600.. if entity @s[tag=mg_hs,tag=!mg_seek] at @s if entity @a[tag=mg_seek,distance=..6] run function mg:hide/caught
