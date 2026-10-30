function mg:to_lobby
tellraw @s {"text":"Witaj na serwerze z minigrami!","color":"gold","bold":true}
tellraw @s {"text":"Stańcie razem w lobby i wciśnijcie przycisk pod grą. Runda zaczyna się dla wszystkich w lobby.","color":"white"}
tellraw @s [{"text":"Spleef","color":"aqua"},{"text":": kop śnieg pod innymi. Kto spadnie, odpada.","color":"gray"}]
tellraw @s [{"text":"TNT Run","color":"red"},{"text":": podłoga znika pod nogami. Biegaj, nie stój!","color":"gray"}]
tellraw @s [{"text":"SkyWars","color":"yellow"},{"text":": każdy na swojej wyspie. Skrzynie, mosty, walka do ostatniego.","color":"gray"}]
tellraw @s [{"text":"Chowany","color":"green"},{"text":": jeden szuka, reszta się chowa w miasteczku. Złapany zaczyna szukać.","color":"gray"}]
tellraw @s [{"text":"Parkour","color":"light_purple"},{"text":": skacz do mety, z punktami kontrolnymi.","color":"gray"}]
tellraw @s [{"text":"Wpisz ","color":"gray"},{"text":"/trigger lobby","color":"yellow"},{"text":", żeby wrócić do lobby.","color":"gray"}]
