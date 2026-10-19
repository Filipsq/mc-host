import Link from "next/link";
import Blank from "@/components/legal/Blank";
import { company } from "@/lib/company";
import { BRAND_NAME } from "@/lib/brand";

export default function PrivacyEn({ site }: { site: string }) {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="muted">
        In effect from <Blank value={company.termsDate} label="date" />. This is a translation; the{" "}
        <strong>Polish version</strong> is binding.
      </p>

      <h2>1. Who processes your data</h2>
      <p>
        The controller of personal data in {BRAND_NAME} ({site}) is{" "}
        <Blank value={company.name} label="full name or company name" />,{" "}
        <Blank value={company.address} label="address" />
        {company.nip && `, tax number (NIP) ${company.nip}`}. For anything about your data, write to{" "}
        <Blank value={company.email} label="email address" />.
      </p>

      <h2>2. What data and why</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Purpose</th>
              <th>Legal basis (GDPR)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Email address, password (stored as a hash, never in plain text), chosen language, date you accepted the Terms</td>
              <td>Creating and running your Account, including sending password reset links and emails about payments and the end of a paid Period</td>
              <td>art. 6(1)(b): performing the contract</td>
            </tr>
            <tr>
              <td>Your device’s notification address (only if you turn on notifications in the panel)</td>
              <td>Notifications on your phone or computer about payments, the end of a Period and chat replies</td>
              <td>art. 6(1)(b): performing the contract</td>
            </tr>
            <tr>
              <td>Servers: name, address, edition, Plan, world, backups, console logs</td>
              <td>Providing server hosting</td>
              <td>art. 6(1)(b): performing the contract</td>
            </tr>
            <tr>
              <td>The email address of a person a Server’s owner let into its panel, and what they may do there</td>
              <td>Letting that person into the Server’s panel and sending them an invitation</td>
              <td>art. 6(1)(f): legitimate interest (sharing the Server at its owner’s request)</td>
            </tr>
            <tr>
              <td>The server description typed into the AI creator</td>
              <td>Picking server settings at the User’s request</td>
              <td>art. 6(1)(b): performing the contract</td>
            </tr>
            <tr>
              <td>Payments: Plan, amount, currency, status, Stripe payment ID</td>
              <td>Settling payments and tax obligations</td>
              <td>art. 6(1)(b) and (c): contract and legal obligation</td>
            </tr>
            <tr>
              <td>IP addresses in technical logs</td>
              <td>Security, detecting abuse and failures</td>
              <td>art. 6(1)(f): legitimate interest</td>
            </tr>
            <tr>
              <td>Contents of emails, chat messages in the panel (pictures included), complaints and withdrawals</td>
              <td>Replying, handling complaints and withdrawals</td>
              <td>art. 6(1)(b), (c) and (f)</td>
            </tr>
            <tr>
              <td>Data needed in a dispute</td>
              <td>Establishing, pursuing or defending claims</td>
              <td>art. 6(1)(f): legitimate interest</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        We never see your card details: you enter them on Stripe’s payment page. We do not profile you or make
        automated decisions about you.
      </p>

      <h2>3. Do you have to give us data</h2>
      <p>
        Giving your email and password is voluntary, but you can’t create an Account without them. You can’t buy a
        paid Plan without payment data.
      </p>

      <h2>4. Who we share data with</h2>
      <ul>
        <li>
          <strong>Hetzner Online GmbH</strong> (Germany): the provider of the servers the Service and game Servers
          run on; data is stored in Germany.
        </li>
        <li>
          <strong>Stripe Payments Europe, Ltd.</strong> (Ireland): payment processing. Stripe may transfer data to
          Stripe, Inc. in the USA under the European Commission’s EU-US Data Privacy Framework decision or standard
          contractual clauses.
        </li>
        <li>
          <strong>Brevo</strong> (France): sending the Service’s emails, such as password reset links and reminders before a Period ends; data is
          stored in the European Union.
        </li>
        <li>
          <strong>Anthropic</strong> (USA): the Claude AI model that picks server settings in the AI creator. It only
          receives the description typed into the creator, not the email address or other Account data. Data is
          transferred to the USA under standard contractual clauses.
        </li>
        <li>
          Your browser’s or phone’s notification service (such as Google for Chrome and Android, Apple for iPhone,
          Mozilla for Firefox), only if you turn on notifications in the panel. It delivers them to your device; the
          notification’s content is encrypted and the service can’t read it.
        </li>
        <li>The email provider we use to answer messages.</li>
        <li>Public authorities, when the law requires it.</li>
      </ul>

      <h2>5. How long we keep data</h2>
      <ul>
        <li>Account data: until the Account is deleted, then until any claims would be time-barred.</li>
        <li>
          Servers, worlds and backups: until the Server is deleted. A suspended Server’s data is kept for at least
          14 days after its paid Period ends and may be deleted after that.
        </li>
        <li>Payment data: 5 years from the end of the year of payment (tax law).</li>
        <li>Technical logs: continuously replaced by newer entries, and deleted at the latest with the Server.</li>
        <li>Correspondence: while the matter is handled, then until any claims would be time-barred.</li>
        <li>Chat messages in the panel, with the pictures sent: until the Account is deleted or an administrator deletes the message.</li>
        <li>A device’s notification address: until you turn notifications off, log out on that device or delete the Account.</li>
        <li>A friend’s access to a Server: until the owner removes it, the friend leaves the Server, or the Server is deleted.</li>
      </ul>

      <h2>6. Your rights</h2>
      <p>
        You have the right to access, correct, delete, restrict and port your data, and to object when we process it
        on the basis of legitimate interest. To use these rights, write to the address in section 1. You can also
        complain to the Polish data protection authority, Prezes Urzędu Ochrony Danych Osobowych (ul. Stawki 2,
        00-193 Warszawa,{" "}
        <a href="https://uodo.gov.pl" target="_blank" rel="noreferrer">uodo.gov.pl</a>), or the authority where you
        live.
      </p>

      <h2>7. Cookies</h2>
      <p>We only use cookies the Service needs to work:</p>
      <ul>
        <li><code>authjs.session-token</code>: keeps you logged in (up to 30 days);</li>
        <li><code>authjs.csrf-token</code>, <code>authjs.callback-url</code>: protect logging in;</li>
        <li><code>locale</code>, <code>currency</code>: remember your language and currency (1 year);</li>
        <li><code>push</code>: once you turn on notifications, tells which device stops getting them when you log out (1 year).</li>
      </ul>
      <p>
        We use no analytics or advertising cookies. Stripe’s payment page sets its own cookies, described in Stripe’s
        privacy policy.
      </p>

      <h2>8. Players on servers</h2>
      <p>
        Minecraft servers log players’ nicknames and IP addresses. The owner of each Server decides about its
        players’ data and is its controller; we process it on their behalf (see §11 of the{" "}
        <Link href="/regulamin">Terms</Link>). For questions about that data, contact the Server’s owner. Our system
        that routes players to Java servers may record a player’s IP address in technical logs (for example when
        waking a server) for security and troubleshooting.
      </p>

      <h2>9. Changes</h2>
      <p>We announce changes to this Privacy Policy in the Service, and important ones by email too.</p>
    </>
  );
}
