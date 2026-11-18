import { plans } from "./plans";

// What the support bot (src/lib/supportBot.ts) knows about the platform, sent with
// every question so OpenBot answers from facts, not guesses (Fiq asked 2026-11-18).
// Keep it short and true: update it when a panel page or a rule changes.

const planLines = plans
  .map(
    (p) =>
      `- ${p.id === "FREE" ? "Darmowy" : p.id[0] + p.id.slice(1).toLowerCase()}: ${p.price.PLN} zł / 30 dni, ${p.ramGb} GB RAM, ${p.diskGb} GB dysku, ${p.maxPlayers ? `do ${p.maxPlayers} graczy` : "bez limitu graczy"}, ${p.alwaysOn ? "działa 24/7" : "usypia, gdy nikt nie gra"}, kopie zapasowe: ${p.backupsKept || "brak"}`,
  )
  .join("\n");

export const SUPPORT_KNOWLEDGE = `MCHosting (mchosting.pl): polski hosting serwerów Minecraft (Java i Bedrock) oraz Terraria. Panel klienta: mchosting.pl/dashboard.

PLANY (płatność z góry za 7, 30, 60 lub 90 dni; 60 dni -5%, 90 dni -10%; BLIK, Przelewy24, karta):
${planLines}
- Jeden darmowy serwer na konto. Darmowy serwer usypia po kilku minutach bez graczy i budzi się sam, gdy ktoś dołącza (Java). Na Bedrocku pierwsza próba pokaże błąd, po około minucie można wejść.
- Darmowy serwer, na którym nikt nie grał 30 dni, jest usuwany (wcześniej mail z ostrzeżeniem).
- Dodatki po 5 zł / 30 dni: większy dysk, więcej kopii zapasowych, własna domena, wejście z konsol Xbox.
- Plan nie odnawia się sam, chyba że przy płatności kartą klient włączy automatyczne odnawianie. Po końcu okresu serwer jest zawieszony, świat zostaje; po 14 dniach zawieszenia płatny serwer jest usuwany.
- "Ulepsz plan" w panelu: płaci się tylko różnicę za pozostałe dni.

JAK DOŁĄCZYĆ: Java: Tryb wieloosobowy > Dodaj serwer > adres np. nazwa.mchosting.pl. Bedrock: Serwery > Dodaj serwer, adres i port osobno (są na stronie serwera w panelu, karta "Jak dołączyć"). Java bez modów ma crossplay: gracze z telefonu/konsoli wchodzą na ten sam adres i port Bedrock pokazany w panelu.

MENU SERWERA W PANELU (po lewej, na telefonie na dole "Więcej"; Ctrl+K = wyszukiwarka):
- Przegląd: stan, Uruchom / Zatrzymaj / Restart, adres, gracze online, RAM i CPU.
- Konsola: logi i komendy (bez "/"), np. op Nick, gamemode creative Nick. Przycisk "Skopiuj i wyślij do admina".
- Pliki: przeglądanie, wgrywanie, edycja plików. Własny plik .jar (płatny plugin, mod spoza Modrinth/CurseForge): Pliki > wejdź do folderu > Wgraj pliki, potem Restart. Na Paper (zwykły serwer) pluginy idą do folderu plugins; na Fabric/Forge/NeoForge mody do folderu mods. Na gotowej paczce modów własny mod dodaje się tak samo do mods (strona Mody, ramka "Własny mod do paczki"). Mod/plugin musi pasować do silnika i wersji Minecrafta serwera, a mody, które nie są tylko na serwer, gracze też muszą mieć u siebie.
- Ustawienia: nazwa, adres, wersja Minecrafta ("Najnowsza" albo konkretna), typ serwera, tryb gry, trudność, PvP, sloty, MOTD, whitelist, non-premium, crossplay, latanie, Nether, potwory, zasięg widzenia. Zmiana typu/wersji: przez 7 dni można cofnąć ("Cofnij zmianę").
- Światy: wgranie ZIP-a ze światem (Bedrock: .mcworld), nowy świat z ziarnem i wersją, pobranie świata.
- Kopie zapasowe: tworzenie i przywracanie (płatne plany).
- Pluginy (Java bez modów; zwykły serwer to już Paper, więc pluginy działają od razu, nie trzeba zmieniać typu): wyszukiwarka Modrinth, instalacja jednym kliknięciem, pluginy dopasowują się do wersji serwera.
- Mody (Fabric/Forge/NeoForge i paczki modów): dodawanie modów z Modrinth i CurseForge. Na serwerze z modami nie ma pluginów.
- Addony (Bedrock): wgrywanie .mcaddon / .mcpack.
- Paczka tekstur (Java): link do resource packa.
- Czat głosowy: Simple Voice Chat, port pokazany na karcie. Mapa: BlueMap.
- Połączone serwery: przejście między dwoma serwerami klienta komendą /rg.
- Dostęp znajomych: zaproszenie po e-mailu, wybór uprawnień.
- Płatności / Ulepsz plan / Dodatki.
- Usunięcie serwera: Ustawienia > na dole "Usuń serwer". Nie da się tego cofnąć: znika świat razem z kopiami zapasowymi, więc kto chce go zachować, niech najpierw pobierze świat (Światy).

KTÓRE ZAKŁADKI MA JAKI TYP (Java): zwykły serwer (Paper): Pluginy i Mody (w Mody wybiera się mody, a panel na końcu przestawia serwer na Fabric; pluginy wtedy przestają działać). Fabric/Forge/NeoForge i paczki modów: tylko Mody, bez Pluginów. Minigry, Skyblock, OneBlock, Halloween, klasyczna mapa Skyblock: tylko Pluginy, zakładki Mody nie ma. Kto na takim serwerze chce mody: Ustawienia > Typ serwera > Zmień typ na Własne mody (Fabric/Forge/NeoForge) albo paczkę; serwer zaczyna nowy świat, stary zostaje w Światach. Bedrock: zamiast tego Addony.

JAK DODAĆ MODY/PLUGINY (Fiq chce, żeby bot pokazywał folder): opisz krótko obie drogi (wyszukiwarka w zakładce Pluginy/Mody albo własny .jar w Plikach) i dołącz zrzut folderu według typu serwera klienta z data.context: "folder-plugins" dla zwykłego serwera (Paper), Minigier, Skyblocka, OneBlocka; "folder-mods" dla Fabric/Forge/NeoForge i paczek modów. Nie znasz typu: zapytaj albo pokaż folder-plugins dla pluginów i folder-mods dla modów.

TYPY SERWERA: Vanilla/Paper, Skyblock, OneBlock, Minigry, paczki modów (Modrinth, CurseForge; w płatnych planach), własne mody na Fabric/Forge/NeoForge. Mody i Skyblock działają też w darmowym planie.

NON-PREMIUM: włącza się w Ustawieniach (Java bez modów; z modami Fabric 1.19.4-1.21.11 oraz Forge/NeoForge 1.21.1). Polecamy dodać w Pluginach AuthMe (gracze /register i /login), bo inaczej każdy może wejść pod cudzym nickiem.

CZĘSTE PROBLEMY:
- Serwer długo się uruchamia: pierwsze uruchomienie z wieloma pluginami/modami trwa kilka minut. Nie klikać Uruchom drugi raz (zaczyna od nowa).
- "Awaria": zwykle plugin/mod nie pasuje do wersji albo brakuje mu zależności. Konsola pokazuje błąd i podpowiedź w ramce "Co się dzieje z serwerem". Usuń ostatnio dodany plugin/mod i Uruchom.
- "Outdated server/client": wersja gry gracza różni się od wersji serwera; zmień wersję w Ustawieniach albo w grze.
- Darmowe miejsca zajęte: spróbuj za kilka minut.
- Brak miejsca na dysku: usuń stare pliki/światy albo dokup dysk / ulepsz plan.
- Ochrona DDoS jest w każdym planie.

KONTO: reset hasła na stronie logowania ("Nie pamiętasz hasła?"), logowanie przez Google, usunięcie konta: mchosting.pl/dashboard/usun-konto. Polecaj znajomych: link w zakładce Polecaj (dni gratis dla obu).

ZAWSZE PRZEKAZUJ ADMINOWI: zwroty, reklamacje, problemy z płatnością, faktury, usunięcie danych, podejrzenie błędu platformy, wszystko czego tu nie ma.`;
