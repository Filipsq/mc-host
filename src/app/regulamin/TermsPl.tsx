import Link from "next/link";
import Blank from "@/components/legal/Blank";
import { company } from "@/lib/company";
import { BRAND_NAME } from "@/lib/brand";

export default function TermsPl({ site }: { site: string }) {
  return (
    <>
      <h1>Regulamin</h1>
      <p className="muted">
        Obowiązuje od <Blank value={company.termsDate} label="data" />
      </p>

      <h2>§1. Postanowienia ogólne</h2>
      <ol>
        <li>
          Regulamin określa zasady korzystania z serwisu {BRAND_NAME} dostępnego pod adresem {site} (dalej:
          „Serwis”) i jest regulaminem, o którym mowa w art. 8 ustawy o świadczeniu usług drogą elektroniczną.
        </li>
        <li>
          Serwis prowadzi <Blank value={company.name} label="imię i nazwisko lub nazwa firmy" />,{" "}
          <Blank value={company.address} label="adres" />
          {company.nip && `, NIP ${company.nip}`} (dalej: „Usługodawca”). Kontakt:{" "}
          <Blank value={company.email} label="adres e-mail" />.
        </li>
        <li>Pojęcia użyte w Regulaminie:
          <ul>
            <li><strong>Użytkownik</strong> – osoba, która założyła Konto;</li>
            <li>
              <strong>Konsument</strong> – Użytkownik będący konsumentem w rozumieniu art. 22¹ Kodeksu cywilnego.
              Postanowienia dotyczące Konsumentów stosuje się także do osoby fizycznej zawierającej umowę
              bezpośrednio związaną z jej działalnością gospodarczą, gdy umowa ta nie ma dla niej charakteru
              zawodowego (art. 38a ustawy o prawach konsumenta);
            </li>
            <li><strong>Konto</strong> – konto Użytkownika w Serwisie, chronione adresem e-mail i hasłem;</li>
            <li><strong>Serwer</strong> – serwer gry Minecraft (Java lub Bedrock) uruchomiony przez Użytkownika w Serwisie;</li>
            <li>
              <strong>Plan</strong> – pakiet zasobów Serwera (pamięć, procesor, miejsce na dysku, liczba graczy, kopie zapasowe)
              opisany w <Link href="/#cennik">Cenniku</Link>: darmowy albo płatny;
            </li>
            <li><strong>Okres</strong> – opłacony z góry czas korzystania z płatnego Planu: 7, 30, 60 lub 90 dni.</li>
          </ul>
        </li>
        <li>
          {BRAND_NAME} nie jest oficjalnym produktem Minecraft. Serwis nie jest zatwierdzony przez Mojang Studios
          ani Microsoft ani z nimi powiązany.
        </li>
      </ol>

      <h2>§2. Wymagania techniczne</h2>
      <ol>
        <li>
          Do korzystania z Serwisu potrzebne są: urządzenie z dostępem do internetu, aktualna przeglądarka z
          włączoną obsługą JavaScript i plików cookies oraz adres e-mail. Do gry na Serwerze potrzebna jest
          legalna kopia gry Minecraft w edycji zgodnej z Serwerem.
        </li>
        <li>
          Zabronione jest dostarczanie przez Użytkownika treści o charakterze bezprawnym (art. 8 ust. 3 pkt 3
          ustawy o świadczeniu usług drogą elektroniczną).
        </li>
      </ol>

      <h2>§3. Konto</h2>
      <ol>
        <li>
          Założenie Konta jest bezpłatne. Umowa o prowadzenie Konta zostaje zawarta z chwilą rejestracji, na czas
          nieokreślony.
        </li>
        <li>
          Konto może założyć osoba, która ukończyła 13 lat. Osoba niepełnoletnia może kupić płatny Plan wyłącznie
          za zgodą rodzica lub opiekuna prawnego.
        </li>
        <li>
          Użytkownik może w każdej chwili rozwiązać umowę o prowadzenie Konta, pisząc na adres e-mail Usługodawcy.
          Usunięcie Konta oznacza usunięcie wszystkich Serwerów Użytkownika wraz ze światami i kopiami zapasowymi.
        </li>
        <li>Użytkownik odpowiada za zachowanie hasła w tajemnicy.</li>
      </ol>

      <h2>§4. Plan darmowy</h2>
      <ol>
        <li>Każdy Użytkownik może mieć jeden Serwer w Planie darmowym. Plan darmowy jest bezpłatny.</li>
        <li>
          Darmowy Serwer, na którym przez 30 dni nikt nie grał, jest usuwany razem ze światem. Co najmniej 3 dni
          wcześniej Usługodawca informuje o tym Użytkownika e-mailem; wystarczy, że ktoś zagra na Serwerze przed tą
          datą, by go zachować.
        </li>
        <li>
          Darmowy Serwer usypia, gdy przez kilka minut nikt na nim nie gra. Serwer na Javę i Serwer Bedrock budzą się, gdy
          gracz spróbuje dołączyć; Serwer Terrarii uruchamia się przyciskiem w panelu.
        </li>
        <li>
          Liczba jednocześnie działających darmowych Serwerów jest ograniczona. Gdy wszystkie miejsca są zajęte,
          darmowy Serwer uruchomi się dopiero po zwolnieniu miejsca. Plan darmowy nie obejmuje kopii zapasowych.
        </li>
      </ol>

      <h2>§5. Plany płatne i płatności</h2>
      <ol>
        <li>
          Ceny Planów podane są w <Link href="/#cennik">Cenniku</Link> i są cenami końcowymi. Użytkownik płaci w
          wybranej walucie: PLN, EUR, USD lub GBP.
        </li>
        <li>
          Płatny Plan opłaca się z góry za Okres 7, 30, 60 lub 90 dni, kartą płatniczą, BLIK-iem lub przez Przelewy24 (BLIK
          i Przelewy24 przy płatności w PLN). Płatności obsługuje Stripe Payments Europe, Ltd.
        </li>
        <li>
          Umowa o świadczenie usługi w płatnym Planie zostaje zawarta z chwilą potwierdzenia płatności przez
          operatora płatności. Serwer jest uruchamiany automatycznie po potwierdzeniu płatności.
        </li>
        <li>
          Plan nie odnawia się automatycznie, chyba że Użytkownik włączy automatyczne odnawianie. Opłacenie kolejnego
          Okresu przed końcem obecnego wydłuża go o nowy Okres.
        </li>
        <li>
          Automatyczne odnawianie Użytkownik może włączyć przy płatności kartą płatniczą. Kartę przechowuje operator
          płatności. Na dobę przed końcem Okresu Usługodawca obciąża kartę ceną kolejnego Okresu tej samej długości w
          obecnym Planie, według Cennika z tego dnia, i wydłuża Okres. Użytkownik może wyłączyć automatyczne
          odnawianie w każdej chwili w panelu; nie wpływa to na Okres już opłacony. Gdy obciążenie się nie uda,
          automatyczne odnawianie zostaje wyłączone, a Użytkownik dostaje o tym e-mail.
        </li>
        <li>
          Przy zmianie Planu niewykorzystane dni obecnego Planu są przeliczane na dni nowego Planu w proporcji cen
          obu Planów i doliczane do opłaconego Okresu.
        </li>
        <li>
          W trakcie opłaconego Okresu Użytkownik może też ulepszyć Plan do wyższego bez zmiany daty końca Okresu,
          płacąc różnicę cen obu Planów za czas pozostały do końca Okresu (nie mniej niż najniższa kwota przyjmowana
          przez operatora płatności). Kolejne Okresy kosztują według ceny nowego Planu.
        </li>
        <li>
          Do płatnego Planu Użytkownik może dokupić dodatki (np. dodatkowe miejsce na dysku, więcej kopii
          zapasowych, własną domenę). Cena dodatku jest podana za 30 dni i jest doliczana do ceny Planu za każdy
          opłacany Okres. Dodatek dokupiony w trakcie Okresu kosztuje część tej ceny za czas pozostały do końca
          Okresu (nie mniej niż najniższa kwota przyjmowana przez operatora płatności). Użytkownik może wyłączyć
          dodatek w każdej chwili; opłata za czas już opłacony nie jest zwracana. Przy własnej domenie Użytkownik
          odpowiada za to, że ma prawo jej używać, i sam ustawia jej rekordy DNS.
        </li>
        <li>
          Po upływie Okresu Serwer zostaje zawieszony: przestaje działać, ale jego świat i kopie zapasowe są
          zachowane. Usługodawca przechowuje dane zawieszonego Serwera przez co najmniej 14 dni od końca Okresu, a
          po tym czasie może je usunąć, uprzedzając o tym Użytkownika e-mailem co najmniej 3 dni wcześniej.
          Opłacenie kolejnego Okresu przed usunięciem przywraca Serwer.
        </li>
        <li>
          Gdy w danej chwili brakuje zasobów, wybrany Plan może być chwilowo niedostępny do zakupu. Nie dotyczy to
          przedłużenia Planu, który Użytkownik już ma.
        </li>
        <li>
          Płatny Plan można też kupić jako kod prezentowy na stronie <Link href="/prezent">Prezent</Link>. Kod daje
          wybrany Plan na wybrany Okres, działa przez 365 dni od zapłaty i można go użyć raz: przy zakładaniu nowego
          Serwera albo dla Serwera, który Użytkownik już ma (darmowy Serwer przechodzi wtedy na ten Plan, a przy
          płatnym Serwerze dni przelicza się jak przy zmianie Planu). Kodu nie można wymienić na pieniądze. Prawo
          odstąpienia od umowy (§8) ma kupujący; gdy kod został już wykorzystany, stosuje się §8 ust. 2.
        </li>
      </ol>

      <h2>§6. Serwery i kopie zapasowe</h2>
      <ol>
        <li>
          Usługodawca udostępnia Serwer z zasobami wybranego Planu, adres do połączenia, panel do uruchamiania i
          zatrzymywania Serwera oraz konsolę.
        </li>
        <li>
          Pliki Serwera mogą zajmować tyle miejsca na dysku, ile podaje opis Planu (kopie zapasowe się nie
          wliczają). Pliku, który przekroczyłby ten limit, nie da się wgrać. Gdy pliki Serwera przekroczą limit o
          więcej niż 10%, Serwer zostaje zatrzymany i można go uruchomić ponownie po usunięciu zbędnych plików albo
          po przejściu na większy Plan.
        </li>
        <li>
          W płatnych Planach Usługodawca raz dziennie wykonuje kopię zapasową świata i przechowuje liczbę
          najnowszych kopii podaną w opisie Planu. Użytkownik może pobrać kopię, przywrócić ją lub wykonać kopię na
          żądanie w panelu Serwera. Przywrócenie kopii zastępuje obecny świat.
        </li>
        <li>
          Kopie zapasowe są przechowywane na tej samej maszynie co Serwer. Zalecamy, by Użytkownik regularnie
          pobierał kopie ważnych światów.
        </li>
        <li>Usunięcie Serwera przez Użytkownika trwale usuwa jego świat i kopie zapasowe.</li>
        <li>
          Usługodawca dokłada starań, by Serwery działały bez przerw, ale nie gwarantuje ciągłej dostępności.
          Przerwy mogą wynikać z prac technicznych, awarii lub działań osób trzecich (np. ataków DDoS).
        </li>
      </ol>

      <h2>§7. Zasady korzystania</h2>
      <ol>
        <li>
          Użytkownik korzysta z Serwera zgodnie z prawem, Regulaminem oraz umową licencyjną i zasadami korzystania
          z gry Minecraft (Minecraft EULA i Usage Guidelines) i odpowiada za treści oraz pliki na swoim Serwerze.
        </li>
        <li>Zabronione jest w szczególności:
          <ul>
            <li>udostępnianie na Serwerze lub za jego pomocą treści bezprawnych;</li>
            <li>używanie Serwera do ataków na inne systemy, rozsyłania spamu lub złośliwego oprogramowania;</li>
            <li>kopanie kryptowalut, uruchamianie serwerów proxy lub VPN i inne użycie niezwiązane z grą;</li>
            <li>obchodzenie limitów zasobów lub zabezpieczeń Serwisu;</li>
            <li>odsprzedawanie usług Serwisu bez zgody Usługodawcy.</li>
          </ul>
        </li>
        <li>
          Jeśli Użytkownik narusza ust. 2, Usługodawca może wezwać go do zaprzestania naruszeń, a gdy naruszenie
          zagraża bezpieczeństwu Serwisu lub innych Użytkowników, zatrzymać Serwer od razu. W razie rażącego lub
          uporczywego naruszenia Usługodawca może rozwiązać umowę ze skutkiem natychmiastowym, podając przyczynę
          w wiadomości e-mail. Opłata za niewykorzystaną część Okresu zostanie wtedy zwrócona.
        </li>
      </ol>

      <h2>§8. Prawo odstąpienia od umowy</h2>
      <ol>
        <li>
          Konsument może odstąpić od umowy o płatny Plan bez podania przyczyny w terminie 14 dni od jej zawarcia.
          Wystarczy wysłać oświadczenie na adres e-mail Usługodawcy przed upływem tego terminu, na przykład według
          wzoru poniżej.
        </li>
        <li>
          Serwer w płatnym Planie jest uruchamiany od razu po płatności. Przed zapłatą Konsument wyraźnie żąda
          rozpoczęcia usługi przed upływem terminu do odstąpienia. Jeśli potem odstąpi od umowy, zapłaci za usługę
          świadczoną do chwili odstąpienia, proporcjonalnie do zapłaconej ceny (art. 35 ustawy o prawach
          konsumenta).
        </li>
        <li>
          Usługodawca zwraca należną kwotę w ciągu 14 dni od otrzymania oświadczenia, tą samą metodą płatności,
          której użył Konsument, chyba że Konsument zgodzi się na inną, niewiążącą się z kosztami dla niego.
        </li>
        <li>
          Wzór oświadczenia: „Adresat: <Blank value={company.name} label="imię i nazwisko lub nazwa firmy" />,{" "}
          <Blank value={company.address} label="adres" />, <Blank value={company.email} label="adres e-mail" />. Ja
          niniejszym informuję o moim odstąpieniu od umowy o świadczenie usługi: Plan [nazwa Planu] dla Serwera
          [nazwa Serwera]. Data zawarcia umowy: [data]. Imię i nazwisko oraz adres e-mail Konta: [dane]. Data:
          [data].”
        </li>
      </ol>

      <h2>§9. Reklamacje</h2>
      <ol>
        <li>
          Usługodawca odpowiada wobec Konsumenta za zgodność usługi z umową na zasadach rozdziału 5b ustawy o
          prawach konsumenta.
        </li>
        <li>
          Reklamację można złożyć na adres e-mail Usługodawcy. Warto podać adres e-mail Konta, nazwę Serwera i
          opis problemu.
        </li>
        <li>Usługodawca odpowiada na reklamację w ciągu 14 dni od jej otrzymania.</li>
        <li>
          Konsument może skorzystać z pozasądowych sposobów rozpatrywania reklamacji i dochodzenia roszczeń, np.
          zwrócić się o pomoc do miejskiego lub powiatowego rzecznika konsumentów albo do wojewódzkiego
          inspektoratu Inspekcji Handlowej. Informacje są dostępne na stronie{" "}
          <a href="https://uokik.gov.pl" target="_blank" rel="noreferrer">uokik.gov.pl</a>.
        </li>
      </ol>

      <h2>§10. Odpowiedzialność</h2>
      <ol>
        <li>
          Wobec Użytkowników niebędących Konsumentami odpowiedzialność Usługodawcy jest ograniczona do kwoty
          zapłaconej za Plan danego Serwera w ostatnich 3 miesiącach i nie obejmuje utraconych korzyści.
        </li>
        <li>Ograniczenia z ust. 1 nie dotyczą szkód wyrządzonych umyślnie.</li>
        <li>Odpowiedzialność wobec Konsumentów określają przepisy prawa.</li>
      </ol>

      <h2>§11. Dane osobowe</h2>
      <ol>
        <li>
          Zasady przetwarzania danych osobowych Użytkowników opisuje{" "}
          <Link href="/polityka-prywatnosci">Polityka prywatności</Link>.
        </li>
        <li>
          Na Serwerze mogą być przetwarzane dane graczy, np. nicki i adresy IP w logach serwera. Ich
          administratorem jest Użytkownik, który decyduje o Serwerze. W tym zakresie Użytkownik powierza
          Usługodawcy przetwarzanie tych danych (art. 28 RODO) w celu i zakresie niezbędnym do świadczenia usługi, a
          Usługodawca:
          <ul>
            <li>przetwarza je wyłącznie w celu świadczenia usługi, zgodnie z poleceniem Użytkownika wyrażonym przez korzystanie z Serwisu;</li>
            <li>zapewnia poufność i stosuje odpowiednie środki bezpieczeństwa;</li>
            <li>
              korzysta z dalszego podmiotu przetwarzającego: Hetzner Online GmbH (Niemcy), dostawcy serwerów, o
              zmianie którego poinformuje Użytkownika z wyprzedzeniem;
            </li>
            <li>pomaga Użytkownikowi w realizacji praw osób, których dane dotyczą, i w obowiązkach z art. 32–36 RODO;</li>
            <li>usuwa dane wraz z usunięciem Serwera;</li>
            <li>udostępnia informacje potrzebne do wykazania spełnienia tych obowiązków.</li>
          </ul>
        </li>
      </ol>

      <h2>§12. Zmiany Regulaminu i postanowienia końcowe</h2>
      <ol>
        <li>
          Usługodawca może zmienić Regulamin z ważnych przyczyn: zmiany przepisów, zmiany zakresu lub sposobu
          świadczenia usług albo zmiany cen. O zmianie informuje e-mailem lub w Serwisie co najmniej 14 dni przed
          jej wejściem w życie. Opłacone Okresy trwają na dotychczasowych warunkach. Użytkownik, który nie akceptuje
          zmian, może rozwiązać umowę o prowadzenie Konta.
        </li>
        <li>
          Usługodawca może zakończyć świadczenie usług, informując Użytkowników co najmniej 30 dni wcześniej, i
          zwraca wtedy opłaty za niewykorzystane Okresy.
        </li>
        <li>
          Regulamin podlega prawu polskiemu. Wobec Konsumentów nie wyłącza to ochrony, jaką dają im
          bezwzględnie obowiązujące przepisy państwa ich zwykłego pobytu.
        </li>
        <li>
          Wersja polska Regulaminu jest wiążąca. Regulamin jest dostępny bezpłatnie pod adresem{" "}
          <Link href="/regulamin">{site}/regulamin</Link> i można go zapisać lub wydrukować.
        </li>
      </ol>
    </>
  );
}
