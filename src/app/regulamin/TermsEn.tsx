import Link from "next/link";
import Blank from "@/components/legal/Blank";
import { company } from "@/lib/company";
import { BRAND_NAME } from "@/lib/brand";

export default function TermsEn({ site }: { site: string }) {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="muted">
        In effect from <Blank value={company.termsDate} label="date" />. This is a translation; the{" "}
        <strong>Polish version</strong> is binding.
      </p>

      <h2>§1. General</h2>
      <ol>
        <li>
          These Terms set out how to use {BRAND_NAME} at {site} (the “Service”) and are the terms required by
          art. 8 of the Polish Act on Providing Services by Electronic Means.
        </li>
        <li>
          The Service is run by <Blank value={company.name} label="full name or company name" />,{" "}
          <Blank value={company.address} label="address" />
          {company.nip && `, tax number (NIP) ${company.nip}`} (the “Provider”). Contact:{" "}
          <Blank value={company.email} label="email address" />.
        </li>
        <li>Terms used here:
          <ul>
            <li><strong>User</strong>: a person who has created an Account;</li>
            <li>
              <strong>Consumer</strong>: a User who is a consumer under art. 22¹ of the Polish Civil Code. The rules
              for Consumers also apply to a sole trader whose contract is directly connected with their business
              but is not of a professional nature for them (art. 38a of the Consumer Rights Act);
            </li>
            <li><strong>Account</strong>: a User’s account in the Service, protected by an email address and password;</li>
            <li><strong>Server</strong>: a Minecraft game server (Java or Bedrock) a User runs in the Service;</li>
            <li>
              <strong>Plan</strong>: the Server’s resources (memory, CPU, player slots, backups) described in the{" "}
              <Link href="/#cennik">Pricing</Link>, either free or paid;
            </li>
            <li><strong>Period</strong>: prepaid time on a paid Plan: 30 days (1 month) or 90 days (3 months).</li>
          </ul>
        </li>
        <li>
          {BRAND_NAME} is not an official Minecraft product. It is not approved by or associated with Mojang
          Studios or Microsoft.
        </li>
      </ol>

      <h2>§2. Technical requirements</h2>
      <ol>
        <li>
          You need a device with internet access, an up-to-date browser with JavaScript and cookies enabled, and an
          email address. To play on a Server you need a legal copy of Minecraft in the Server’s edition.
        </li>
        <li>Users must not provide unlawful content.</li>
      </ol>

      <h2>§3. Account</h2>
      <ol>
        <li>Creating an Account is free. The Account contract starts when you sign up and runs indefinitely.</li>
        <li>
          You must be at least 13 to create an Account. A minor may buy a paid Plan only with a parent’s or legal
          guardian’s consent.
        </li>
        <li>
          You can end the Account contract at any time by emailing the Provider. Deleting an Account deletes all
          its Servers along with their worlds and backups.
        </li>
        <li>You are responsible for keeping your password secret.</li>
      </ol>

      <h2>§4. Free Plan</h2>
      <ol>
        <li>Each User can have one Server on the free Plan. The free Plan costs nothing and does not expire.</li>
        <li>
          A free Server goes to sleep when nobody has played on it for a few minutes. A Java Server wakes up when a
          player tries to join; a Bedrock Server is started with the button in the panel.
        </li>
        <li>
          The number of free Servers running at once is limited. When all slots are taken, a free Server starts
          once a slot frees up. The free Plan has no backups.
        </li>
      </ol>

      <h2>§5. Paid Plans and payments</h2>
      <ol>
        <li>
          Plan prices are listed in the <Link href="/#cennik">Pricing</Link> and are final prices. You pay in the
          currency you choose: PLN, EUR, USD or GBP.
        </li>
        <li>
          A paid Plan is paid in advance for a Period of 30 or 90 days, by card, BLIK or Przelewy24 (BLIK and
          Przelewy24 for payments in PLN). Payments are handled by Stripe Payments Europe, Ltd.
        </li>
        <li>
          The contract for a paid Plan is made when the payment provider confirms the payment. The Server starts
          automatically once the payment is confirmed.
        </li>
        <li>Plans do not renew automatically. Paying for another Period before the current one ends extends it.</li>
        <li>
          When you change Plans, the unused days of your current Plan are converted into days of the new Plan by
          the ratio of their prices and added to the paid Period.
        </li>
        <li>
          When a Period ends, the Server is suspended: it stops, but its world and backups are kept. The Provider
          keeps a suspended Server’s data for at least 14 days after the Period ends and may delete it after that.
          Paying for a new Period restores the Server.
        </li>
        <li>
          When resources run short, a Plan may be temporarily unavailable to buy. This does not apply to extending a
          Plan you already have.
        </li>
      </ol>

      <h2>§6. Servers and backups</h2>
      <ol>
        <li>
          The Provider gives you a Server with your Plan’s resources, an address to connect to, a panel to start
          and stop it, and a console.
        </li>
        <li>
          On paid Plans the Provider backs up the world once a day and keeps the number of most recent backups
          listed in the Plan. You can download a backup, restore it, or make one on demand in the Server’s panel.
          Restoring a backup replaces the current world.
        </li>
        <li>
          Backups are stored on the same machine as the Server. We recommend downloading copies of important worlds
          regularly.
        </li>
        <li>Deleting a Server permanently deletes its world and backups.</li>
        <li>
          The Provider works to keep Servers running without interruption but does not guarantee constant
          availability. Interruptions may come from maintenance, failures or third parties (e.g. DDoS attacks).
        </li>
      </ol>

      <h2>§7. Acceptable use</h2>
      <ol>
        <li>
          You must use your Server lawfully and in line with these Terms and the Minecraft EULA and Usage
          Guidelines, and you are responsible for the content and files on it.
        </li>
        <li>In particular, you must not:
          <ul>
            <li>share unlawful content on or through the Server;</li>
            <li>use the Server to attack other systems or send spam or malware;</li>
            <li>mine cryptocurrency, run proxy or VPN servers, or otherwise use it for anything other than the game;</li>
            <li>get around the Service’s resource limits or security;</li>
            <li>resell the Service without the Provider’s consent.</li>
          </ul>
        </li>
        <li>
          If you break paragraph 2, the Provider may ask you to stop and, when the breach threatens the security of
          the Service or other Users, stop the Server immediately. For a serious or repeated breach the Provider may
          end the contract with immediate effect, giving the reason by email. The fee for the unused part of the
          Period is then refunded.
        </li>
      </ol>

      <h2>§8. Right of withdrawal</h2>
      <ol>
        <li>
          A Consumer may withdraw from a paid Plan contract without giving a reason within 14 days of making it, by
          sending a statement to the Provider’s email address before that time runs out, for example using the
          template below.
        </li>
        <li>
          A paid Server starts right after payment. Before paying, the Consumer expressly asks for the service to
          start before the withdrawal period ends. If they then withdraw, they pay for the service provided up to
          the withdrawal, in proportion to the price paid (art. 35 of the Consumer Rights Act).
        </li>
        <li>
          The Provider refunds the amount due within 14 days of receiving the statement, using the same payment
          method the Consumer used, unless the Consumer agrees to another method at no cost to them.
        </li>
        <li>
          Template: “To: <Blank value={company.name} label="full name or company name" />,{" "}
          <Blank value={company.address} label="address" />, <Blank value={company.email} label="email address" />. I
          hereby give notice that I withdraw from the contract for the following service: [Plan name] Plan for the
          Server [Server name]. Contract made on: [date]. Name and Account email: [details]. Date: [date].”
        </li>
      </ol>

      <h2>§9. Complaints</h2>
      <ol>
        <li>
          The Provider is liable to Consumers for the service conforming to the contract under chapter 5b of the
          Polish Consumer Rights Act.
        </li>
        <li>
          You can file a complaint by email to the Provider. Please include your Account email, the Server’s name
          and a description of the problem.
        </li>
        <li>The Provider answers complaints within 14 days of receiving them.</li>
        <li>
          Consumers may use out-of-court ways of handling complaints and claims, for example by asking a municipal
          or district consumer ombudsman or a regional Trade Inspection office for help. More at{" "}
          <a href="https://uokik.gov.pl" target="_blank" rel="noreferrer">uokik.gov.pl</a>.
        </li>
      </ol>

      <h2>§10. Liability</h2>
      <ol>
        <li>
          Towards Users who are not Consumers, the Provider’s liability is limited to the amount paid for the
          Server’s Plan in the last 3 months and does not cover lost profits.
        </li>
        <li>The limits in paragraph 1 do not apply to damage caused intentionally.</li>
        <li>Liability towards Consumers is governed by law.</li>
      </ol>

      <h2>§11. Personal data</h2>
      <ol>
        <li>
          How Users’ personal data is processed is described in the{" "}
          <Link href="/polityka-prywatnosci">Privacy Policy</Link>.
        </li>
        <li>
          A Server may process players’ data, such as nicknames and IP addresses in server logs. Their controller
          is the User who runs the Server. To that extent the User entrusts the Provider with processing that data
          (art. 28 GDPR) for the purpose and to the extent needed to provide the service, and the Provider:
          <ul>
            <li>processes it only to provide the service, on the User’s instruction given by using the Service;</li>
            <li>keeps it confidential and applies appropriate security measures;</li>
            <li>
              uses one sub-processor, Hetzner Online GmbH (Germany), the server provider, and will tell the User in
              advance before changing it;
            </li>
            <li>helps the User respond to data subjects’ requests and meet the obligations in art. 32–36 GDPR;</li>
            <li>deletes the data when the Server is deleted;</li>
            <li>makes available the information needed to show these obligations are met.</li>
          </ul>
        </li>
      </ol>

      <h2>§12. Changes and final provisions</h2>
      <ol>
        <li>
          The Provider may change these Terms for good reasons: changes in law, in the scope or way the services
          are provided, or in prices. Users are told by email or in the Service at least 14 days before a change
          takes effect. Paid Periods continue on the previous terms. A User who does not accept the changes may end
          the Account contract.
        </li>
        <li>
          The Provider may stop providing the services by telling Users at least 30 days in advance, and then
          refunds the fees for unused Periods.
        </li>
        <li>
          These Terms are governed by Polish law. For Consumers this does not remove the protection given by the
          mandatory laws of the country where they normally live.
        </li>
        <li>
          The Polish version of these Terms is binding. The Terms are available free of charge at{" "}
          <Link href="/regulamin">{site}/regulamin</Link> and can be saved or printed.
        </li>
      </ol>
    </>
  );
}
