# Minigames by MCHosting: a lobby with a button under each game. A round
# starts for everyone standing in the lobby. The agent builds the map once
# (function mg:build) and sets the game rules over RCON.
scoreboard objectives add mg dummy
scoreboard objectives add lobby trigger
scoreboard objectives add mg_die deathCount
scoreboard objectives add mg_cp dummy
scoreboard objectives add mg_pkt dummy
team add mg_seek
team add mg_hide
scoreboard players set #20 mg 20
# A round cut short by a restart is over: its players go back to the lobby (tick).
scoreboard players set #sp mg 0
scoreboard players set #tr mg 0
scoreboard players set #sw mg 0
scoreboard players set #hs mg 0
scoreboard players set #btn mg 0
scoreboard players set #sec mg 0
