import Link from "next/link";
import Blank from "@/components/legal/Blank";
import { company } from "@/lib/company";
import { BRAND_NAME } from "@/lib/brand";

export default function PrivacyPl({ site }: { site: string }) {
  return (
    <>
      <h1>Polityka prywatności</h1>
      <p className="muted">
        Obowiązuje od <Blank value={company.termsDate} label="data" />
      </p>

      <h2>1. Kto przetwarza Twoje dane</h2>
      <p>
        Administratorem danych osobowych w serwisie {BRAND_NAME} ({site}) jest{" "}
        <Blank value={company.name} label="imię i nazwisko lub nazwa firmy" />,{" "}
        <Blank value={company.address} label="adres" />
        {company.nip && `, NIP ${company.nip}`}. W sprawach danych osobowych pisz na adres{" "}
        <Blank value={company.email} label="adres e-mail" />.
      </p>

      <h2>2. Jakie dane i po co</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Dane</th>
              <th>Cel</th>
              <th>Podstawa prawna (RODO)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Adres e-mail, hasło (zapisane jako skrót, nie jawnym tekstem), wybrany język, data akceptacji Regulaminu</td>
              <td>Założenie i prowadzenie Konta, w tym wysyłka linku do zmiany hasła oraz wiadomości o płatnościach i końcu opłaconego Okresu</td>
              <td>art. 6 ust. 1 lit. b – wykonanie umowy</td>
            </tr>
            <tr>
              <td>Serwery: nazwa, adres, edycja, Plan, świat, kopie zapasowe, logi konsoli</td>
              <td>Świadczenie usługi hostingu serwerów</td>
              <td>art. 6 ust. 1 lit. b – wykonanie umowy</td>
            </tr>
            <tr>
              <td>Płatności: Plan, kwota, waluta, status, identyfikator płatności Stripe</td>
              <td>Rozliczenie płatności i obowiązki podatkowe</td>
              <td>art. 6 ust. 1 lit. b i c – umowa i obowiązek prawny</td>
            </tr>
            <tr>
              <td>Adresy IP w logach technicznych</td>
              <td>Bezpieczeństwo, wykrywanie nadużyć i awarii</td>
              <td>art. 6 ust. 1 lit. f – prawnie uzasadniony interes</td>
            </tr>
            <tr>
              <td>Treść wiadomości e-mail, reklamacji i odstąpień</td>
              <td>Odpowiedź na wiadomość, obsługa reklamacji i odstąpień</td>
              <td>art. 6 ust. 1 lit. b, c i f</td>
            </tr>
            <tr>
              <td>Dane potrzebne w sporze</td>
              <td>Ustalenie, dochodzenie lub obrona roszczeń</td>
              <td>art. 6 ust. 1 lit. f – prawnie uzasadniony interes</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Danych karty płatniczej nie widzimy: wpisujesz je na stronie płatności Stripe. Nie profilujemy Cię i nie
        podejmujemy wobec Ciebie zautomatyzowanych decyzji.
      </p>

      <h2>3. Czy musisz podać dane</h2>
      <p>
        Podanie adresu e-mail i hasła jest dobrowolne, ale bez nich nie założysz Konta. Bez danych płatności nie
        kupisz płatnego Planu.
      </p>

      <h2>4. Komu przekazujemy dane</h2>
      <ul>
        <li>
          <strong>Hetzner Online GmbH</strong> (Niemcy) – dostawca serwerów, na których działają Serwis i Serwery
          gry; dane są przechowywane w Niemczech.
        </li>
        <li>
          <strong>Stripe Payments Europe, Ltd.</strong> (Irlandia) – obsługa płatności. Stripe może przekazywać dane
          do Stripe, Inc. w USA na podstawie decyzji Komisji Europejskiej w sprawie EU-US Data Privacy Framework lub
          standardowych klauzul umownych.
        </li>
        <li>
          <strong>Brevo</strong> (Francja) – wysyłka wiadomości e-mail z Serwisu, np. linku do zmiany hasła i przypomnienia o końcu Okresu; dane
          są przechowywane w Unii Europejskiej.
        </li>
        <li>Dostawca poczty e-mail, przez którą odpowiadamy na wiadomości.</li>
        <li>Organy publiczne, gdy wymaga tego prawo.</li>
      </ul>

      <h2>5. Jak długo przechowujemy dane</h2>
      <ul>
        <li>Dane Konta – do usunięcia Konta, a potem do upływu terminu przedawnienia ewentualnych roszczeń.</li>
        <li>
          Serwery, światy i kopie zapasowe – do usunięcia Serwera. Dane zawieszonego Serwera przechowujemy co
          najmniej 14 dni po końcu opłaconego Okresu, a potem możemy je usunąć.
        </li>
        <li>Dane płatności – 5 lat od końca roku, w którym nastąpiła płatność (przepisy podatkowe).</li>
        <li>Logi techniczne – na bieżąco zastępowane nowszymi wpisami; usuwamy je najpóźniej z usunięciem Serwera.</li>
        <li>Korespondencja – przez czas obsługi sprawy, a potem do upływu terminu przedawnienia roszczeń.</li>
      </ul>

      <h2>6. Twoje prawa</h2>
      <p>
        Masz prawo dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania i
        przeniesienia, a gdy przetwarzamy je na podstawie prawnie uzasadnionego interesu – także prawo sprzeciwu.
        Aby z nich skorzystać, napisz na adres podany w punkcie 1. Masz też prawo wnieść skargę do Prezesa Urzędu
        Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa,{" "}
        <a href="https://uodo.gov.pl" target="_blank" rel="noreferrer">uodo.gov.pl</a>).
      </p>

      <h2>7. Pliki cookies</h2>
      <p>Używamy wyłącznie plików cookies niezbędnych do działania Serwisu:</p>
      <ul>
        <li><code>authjs.session-token</code> – utrzymuje zalogowanie (do 30 dni);</li>
        <li><code>authjs.csrf-token</code>, <code>authjs.callback-url</code> – zabezpieczają logowanie;</li>
        <li><code>locale</code>, <code>currency</code> – zapamiętują wybrany język i walutę (1 rok).</li>
      </ul>
      <p>
        Nie używamy cookies analitycznych ani reklamowych. Strona płatności Stripe ustawia własne cookies, opisane w
        polityce prywatności Stripe.
      </p>

      <h2>8. Gracze na serwerach</h2>
      <p>
        Serwery Minecraft zapisują w logach nicki i adresy IP graczy. O danych graczy na danym Serwerze decyduje
        jego właściciel – to on jest ich administratorem, a my przetwarzamy je w jego imieniu (zob. §11{" "}
        <Link href="/regulamin">Regulaminu</Link>). W sprawie tych danych skontaktuj się z właścicielem Serwera.
        Nasz system przekierowujący graczy na serwery Java może zapisać adres IP gracza w logach technicznych (np.
        przy budzeniu serwera) na potrzeby bezpieczeństwa i usuwania awarii.
      </p>

      <h2>9. Zmiany</h2>
      <p>O zmianach Polityki prywatności poinformujemy w Serwisie, a o istotnych także e-mailem.</p>
    </>
  );
}
