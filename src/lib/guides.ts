import { planById } from "@/lib/plans";

// Polish guide pages at /poradniki, written for people searching Google for
// "hosting Minecraft", "jak założyć serwer Minecraft" and similar. Plan sizes
// come from plans.ts, so the text stays right when a plan changes.
// Inline links use [text](/path); a line starting with "- " is a list item.

export type GuideSection = { heading: string; body: string[] };
// A short vertical video from our TikTok/YouTube, served from public/poradniki.
export type GuideVideo = { src: string; poster: string; name: string; seconds: number; uploaded: string };
export type Guide = {
  slug: string;
  title: string; // <title> and the card on /poradniki
  h1: string;
  description: string; // meta description, ~150 characters
  updated: string; // YYYY-MM-DD
  intro: string;
  video?: GuideVideo;
  sections: GuideSection[];
  faq: { q: string; a: string }[];
};

export function guides(): Guide[] {
  const free = planById("FREE");
  const starter = planById("STARTER");
  const standard = planById("STANDARD");
  const pro = planById("PRO");
  const max = planById("MAX");
  return [
    {
      slug: "jak-zalozyc-serwer-minecraft",
      title: "Jak założyć serwer Minecraft za darmo (krok po kroku)",
      h1: "Jak założyć serwer Minecraft za darmo",
      description:
        "Załóż darmowy serwer Minecraft na Javę lub Bedrock w kilka minut: konto, wybór wersji, adres serwera i dołączanie znajomych. Poradnik krok po kroku.",
      updated: "2026-11-24",
      intro:
        "Własny serwer Minecraft to najprostszy sposób, żeby grać ze znajomymi na jednym świecie, nawet gdy Ciebie nie ma w grze. Nie musisz mieć mocnego komputera ani zostawiać go włączonego całą noc: serwer może działać na hostingu Minecraft. Poniżej pokazujemy, jak założyć go za darmo w kilka minut.",
      video: { src: "/poradniki/jak-zalozyc-serwer.mp4", poster: "/poradniki/jak-zalozyc-serwer.jpg", name: "Jak założyć serwer Minecraft w minutę", seconds: 29, uploaded: "2026-11-24" },
      sections: [
        {
          heading: "Serwer w domu czy hosting Minecraft?",
          body: [
            "Serwer możesz postawić na własnym komputerze, ale wtedy komputer musi być cały czas włączony, a Ty musisz ustawić przekierowanie portów na routerze. Część dostawców internetu w ogóle na to nie pozwala, a znajomi łączą się wtedy przez Twój domowy internet, co często daje lagi.",
            "Hosting Minecraft załatwia to za Ciebie: serwer stoi w centrum danych z szybkim łączem, ma stały adres i ochronę przed atakami DDoS, a Ty zarządzasz nim z przeglądarki albo telefonu.",
          ],
        },
        {
          heading: "Krok 1: załóż konto",
          body: [
            "Wejdź na stronę [rejestracji](/signup) i załóż konto przez e-mail albo jednym kliknięciem przez Google. Do darmowego planu nie podajesz karty.",
          ],
        },
        {
          heading: "Krok 2: wybierz grę, wersję i rodzaj serwera",
          body: [
            "Kliknij Nowy serwer i wybierz:",
            "- Java, jeśli grasz na komputerze. Serwer na Javę bez modów ma crossplay, więc dołączą też gracze z telefonów i konsol.",
            "- Bedrock, jeśli wszyscy gracie na telefonach, konsolach albo Minecraft na Windows.",
            "- Rodzaj serwera: zwykły survival, Skyblock, OneBlock, minigry albo mody.",
            "Wersję gry wybierz taką samą, na jakiej gracie. Jeśli nie wiesz, zostaw najnowszą.",
          ],
        },
        {
          heading: "Krok 3: wybierz plan",
          body: [
            `Na start wystarczy darmowy plan: ${free.ramGb} GB RAM, ${free.diskGb} GB miejsca i do ${free.maxPlayers} graczy, bez limitu czasu. Darmowy serwer usypia, gdy nikt nie gra, i sam się budzi, gdy ktoś wchodzi.`,
            `Jeśli chcecie grać w większej ekipie, na modach albo potrzebujecie serwera włączonego całą dobę, wybierz plan płatny, np. Starter (${starter.ramGb} GB RAM). Ile pamięci potrzebujesz, sprawdzisz w poradniku [ile RAM na serwer Minecraft](/poradniki/ile-ram-na-serwer-minecraft).`,
          ],
        },
        {
          heading: "Krok 4: uruchom serwer i skopiuj adres",
          body: [
            "Po utworzeniu serwer włącza się sam. Na stronie serwera w panelu znajdziesz jego adres, np. ekipa.mchosting.pl. To ten adres wysyłasz znajomym.",
          ],
        },
        {
          heading: "Krok 5: dołącz do serwera",
          body: [
            "- Java: Tryb wieloosobowy → Dodaj serwer → wpisz adres serwera.",
            "- Bedrock: Graj → Serwery → Dodaj serwer → wpisz adres i port, które pokazuje panel.",
            "- Konsole (Xbox, PlayStation, Switch): w panelu znajdziesz instrukcję dołączania z konsoli.",
          ],
        },
        {
          heading: "Co dalej: pluginy, mody i kopie zapasowe",
          body: [
            "W panelu dodasz pluginy jednym kliknięciem (np. EssentialsX, LuckPerms), wgrasz swój świat z gry jednoosobowej i wpiszesz komendy w konsoli. Chcesz grać na modach? Zobacz poradnik [jak zrobić serwer Minecraft z modami](/poradniki/serwer-minecraft-z-modami).",
          ],
        },
      ],
      faq: [
        {
          q: "Czy da się założyć serwer Minecraft za darmo?",
          a: `Tak. Darmowy plan ma ${free.ramGb} GB RAM i miejsce dla ${free.maxPlayers} graczy, nie wymaga karty i nie wygasa po kilku dniach. Serwer usypia, gdy nikt nie gra.`,
        },
        {
          q: "Czy na serwer Java wejdą gracze z telefonu?",
          a: "Tak, serwer na Javę bez modów ma crossplay, więc gracze z Bedrocka (telefony, konsole, Windows) dołączą razem z graczami z komputerów.",
        },
        {
          q: "Jak długo trwa założenie serwera?",
          a: "Zwykle kilka minut: tyle, ile zajmuje założenie konta i pierwsze uruchomienie serwera.",
        },
      ],
    },
    {
      slug: "ile-ram-na-serwer-minecraft",
      title: "Ile RAM na serwer Minecraft? Vanilla, pluginy i mody",
      h1: "Ile RAM potrzebuje serwer Minecraft?",
      description:
        "Ile pamięci RAM potrzebuje serwer Minecraft: bez modów, z pluginami i z paczkami modów. Prosta ściąga według liczby graczy i rodzaju serwera.",
      updated: "2026-11-24",
      intro:
        "RAM to pamięć, w której serwer trzyma świat, graczy i mody. Za mało RAM-u oznacza lagi i wyłączanie się serwera, a za dużo to przepłacanie. Ile go naprawdę potrzebujesz, zależy głównie od dwóch rzeczy: czy masz mody i ilu graczy gra naraz.",
      video: { src: "/poradniki/ile-ram.mp4", poster: "/poradniki/ile-ram.jpg", name: "Ile RAM-u potrzebuje serwer Minecraft? Wytłumaczone na karczmie", seconds: 50, uploaded: "2026-11-24" },
      sections: [
        {
          heading: "Szybka odpowiedź",
          body: [
            `- Zwykły serwer bez modów, do ${free.maxPlayers} graczy: ${free.ramGb} GB (wystarczy darmowy plan).`,
            `- Serwer z kilkoma pluginami, do ${starter.maxPlayers} graczy: ${starter.ramGb} GB (Starter).`,
            `- Lekkie mody (do ok. 50 modów) albo większa ekipa: ${standard.ramGb} GB (Standard).`,
            `- Duże paczki modów, np. z Modrinth lub CurseForge: ${pro.ramGb} GB (Pro).`,
            `- Bardzo duże paczki (np. All the Mods) i dużo graczy naraz: ${max.ramGb} GB (Max).`,
          ],
        },
        {
          heading: "Serwer bez modów (vanilla, Paper)",
          body: [
            `Zwykły Minecraft na silniku Paper jest bardzo oszczędny. Na ${free.ramGb} GB spokojnie zagra kilka do kilkunastu osób. Więcej pamięci przydaje się dopiero wtedy, gdy gracze rozchodzą się daleko od siebie i serwer musi trzymać w pamięci wiele kawałków świata naraz.`,
          ],
        },
        {
          heading: "Serwer z pluginami",
          body: [
            "Pojedyncze pluginy, takie jak EssentialsX, LuckPerms czy WorldEdit, zużywają mało pamięci. Dopiero większe pluginy (mapy na żywo, minigry, ekonomia z bazą danych) potrafią dodać po kilkaset MB. Przy kilkunastu pluginach i 10 do 20 graczach celuj w 3 do 4 GB.",
          ],
        },
        {
          heading: "Serwer z modami",
          body: [
            "Mody zużywają najwięcej, bo dodają nowe bloki, moby i całe wymiary. Najprościej spojrzeć na zalecenia twórców paczki: na stronie paczki na Modrinth lub CurseForge zwykle jest podane, ile RAM-u potrzebuje serwer.",
            "- Kilka do kilkudziesięciu modów na Fabricu: 4 do 6 GB.",
            "- Średnie paczki (50 do 150 modów): 6 do 10 GB.",
            "- Duże paczki (200 i więcej modów): 10 do 16 GB.",
            "Nie wiesz, ile wybrać? Na [stronie głównej](/#cennik) jest kalkulator RAM-u, który podpowie plan.",
          ],
        },
        {
          heading: "Po czym poznać, że RAM-u jest za mało?",
          body: [
            "- Serwer sam się restartuje albo wyłącza z błędem OutOfMemoryError w konsoli.",
            "- Lagi pojawiają się wtedy, gdy dużo graczy jest w różnych miejscach świata.",
            "- Ładowanie nowych terenów trwa coraz dłużej.",
            "Wtedy wystarczy podnieść plan w panelu (Ulepsz): płacisz tylko różnicę za pozostałe dni.",
          ],
        },
        {
          heading: "Czy więcej RAM-u zawsze pomaga?",
          body: [
            "Nie. Jeśli serwer ma już tyle pamięci, ile potrzebuje, dokładanie kolejnych GB niczego nie przyspieszy. Lagi przy zapasie pamięci zwykle wynikają z czegoś innego: zbyt dużej odległości widzenia, farm z tysiącami mobów albo ciężkiego moda.",
          ],
        },
      ],
      faq: [
        {
          q: "Ile RAM na serwer Minecraft dla 10 osób?",
          a: `Bez modów wystarczy ${free.ramGb} GB. Z pluginami celuj w ${starter.ramGb} do 4 GB, a z modami w 6 GB lub więcej.`,
        },
        {
          q: "Ile RAM na serwer z modami?",
          a: "Zależy od paczki: lekkie mody 4 do 6 GB, średnie paczki 6 do 10 GB, duże paczki 10 do 16 GB.",
        },
        {
          q: "Czy mogę zmienić ilość RAM później?",
          a: "Tak, plan zmienisz w każdej chwili w panelu serwera, a świat zostaje bez zmian.",
        },
      ],
    },
    {
      slug: "serwer-minecraft-z-modami",
      title: "Jak zrobić serwer Minecraft z modami (Fabric, Forge, paczki)",
      h1: "Jak zrobić serwer Minecraft z modami",
      description:
        "Serwer Minecraft z modami krok po kroku: gotowa paczka z Modrinth lub CurseForge albo własne mody na Fabricu, Forge i NeoForge. Jak dołączyć i ile RAM wybrać.",
      updated: "2026-11-24",
      intro:
        "Serwer z modami daje dużo więcej niż zwykły Minecraft: nowe wymiary, maszyny, magię i bossów. Najważniejsze jest to, żeby serwer i gracze mieli te same mody w tych samych wersjach. Pokażemy, jak to zrobić bez ręcznego wgrywania plików.",
      video: { src: "/poradniki/serwer-z-modami.mp4", poster: "/poradniki/serwer-z-modami.jpg", name: "Serwer Minecraft z modami bez crashy", seconds: 46, uploaded: "2026-11-24" },
      sections: [
        {
          heading: "Gotowa paczka czy własne mody?",
          body: [
            "- Gotowa paczka modów (np. z Modrinth albo CurseForge) to zestaw modów dobranych przez twórców, które na pewno działają razem. To najprostsza droga.",
            "- Własne mody to serwer na Fabricu, Forge lub NeoForge, do którego dodajesz pojedyncze mody, które lubisz.",
          ],
        },
        {
          heading: "Krok 1: utwórz serwer na Javę",
          body: [
            "Mody działają tylko na Javie. Po [założeniu konta](/signup) kliknij Nowy serwer, wybierz Javę i jako rodzaj serwera wskaż paczkę modów albo Własne mody.",
          ],
        },
        {
          heading: "Krok 2: wybierz paczkę albo silnik modów",
          body: [
            "Paczkę wyszukasz po nazwie, a serwer sam pobierze wszystkie mody i ustawi odpowiednią wersję gry. Przy własnych modach wybierz silnik (Fabric, Forge albo NeoForge) i wersję gry, a potem dodawaj mody w zakładce Mody: wyszukiwarka pokaże, które pasują do Twojej wersji.",
            `Własne mody działają też na darmowym planie, a paczki modów potrzebują planu płatnego, bo zwykle zajmują więcej pamięci. Ile RAM-u wybrać, sprawdzisz w poradniku [ile RAM na serwer Minecraft](/poradniki/ile-ram-na-serwer-minecraft).`,
          ],
        },
        {
          heading: "Krok 3: zainstaluj te same mody u siebie",
          body: [
            "Każdy gracz musi mieć u siebie tę samą paczkę w tej samej wersji co serwer. Najprościej zainstalować ją w launcherze, który obsługuje paczki, np. Modrinth App, Prism Launcher albo CurseForge. Przy własnych modach panel pozwala pobrać paczkę modów serwera i udostępnić graczom link, żeby każdy miał dokładnie to samo.",
          ],
        },
        {
          heading: "Krok 4: dołącz do serwera",
          body: [
            "Uruchom grę z zainstalowaną paczką, wejdź w Tryb wieloosobowy → Dodaj serwer i wpisz adres serwera z panelu. Pierwsze uruchomienie serwera z dużą paczką może potrwać kilka minut.",
          ],
        },
        {
          heading: "Najczęstsze problemy",
          body: [
            "- Gra mówi o brakujących albo niezgodnych modach: wersja paczki u gracza różni się od tej na serwerze. Zainstaluj dokładnie tę samą wersję.",
            "- Serwer się wyłącza zaraz po starcie: zwykle za mało RAM-u albo mod, który działa tylko po stronie gracza (np. minimapa, shadery). Takie mody usuń z serwera.",
            "- Gracze z telefonów nie mogą wejść: na serwer z modami wchodzą tylko gracze z Javy.",
          ],
        },
      ],
      faq: [
        {
          q: "Czy na serwer z modami wejdę z telefonu?",
          a: "Nie. Mody działają tylko na Javie, więc na serwer z modami wchodzą gracze z komputerów.",
        },
        {
          q: "Czy mogę mieć mody na darmowym serwerze?",
          a: `Tak, własne mody na Fabricu, Forge i NeoForge działają na darmowym planie (${free.ramGb} GB RAM). Duże paczki modów potrzebują planu płatnego.`,
        },
        {
          q: "Fabric czy Forge?",
          a: "Wybierz ten silnik, na którym jest mod albo paczka, w którą chcesz grać. Fabric jest lżejszy i szybciej dostaje nowe wersje gry, a na Forge i NeoForge jest wiele dużych, starszych modów.",
        },
      ],
    },
  ];
}

export const guideBySlug = (slug: string) => guides().find((g) => g.slug === slug);
