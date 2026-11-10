// Small marks of the ways to pay, shown on the pay buttons. Decorative: the
// button's own text says what it does.

const H = 20;

function Visa() {
  return (
    <svg width={38} height={H} viewBox="0 0 38 20" aria-hidden>
      <rect width="38" height="20" rx="3" fill="#fff" />
      <text x="19" y="14.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="900" fontStyle="italic" fontSize="11" fill="#1a1f71">
        VISA
      </text>
    </svg>
  );
}

function Mastercard() {
  return (
    <svg width={32} height={H} viewBox="0 0 32 20" aria-hidden>
      <rect width="32" height="20" rx="3" fill="#fff" />
      <circle cx="12.5" cy="10" r="6.5" fill="#eb001b" />
      <circle cx="19.5" cy="10" r="6.5" fill="#f79e1b" />
      <path d="M16 4.5a6.5 6.5 0 0 1 0 11 6.5 6.5 0 0 1 0-11z" fill="#ff5f00" />
    </svg>
  );
}

function Blik() {
  return (
    <svg width={34} height={H} viewBox="0 0 34 20" aria-hidden>
      <rect width="34" height="20" rx="3" fill="#000" />
      <text x="17" y="14.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="11.5" fill="#fff">
        blik
      </text>
    </svg>
  );
}

function Paysafecard() {
  return (
    <svg width={66} height={H} viewBox="0 0 66 20" aria-hidden>
      <rect width="66" height="20" rx="3" fill="#fff" />
      <text x="33" y="13.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="9.5" fill="#008ac9">
        paysafecard
      </text>
    </svg>
  );
}

/**
 * The marks for one pay button: Stripe's (cards, and BLIK unless CashBill is
 * offered beside it) or CashBill's (BLIK and paysafecard).
 */
export default function PayBadges({ method }: { method: "stripe" | "cards" | "cashbill" }) {
  return (
    <span className="pay-badges">
      {method === "cashbill" ? (
        <>
          <Blik />
          <Paysafecard />
        </>
      ) : (
        <>
          <Visa />
          <Mastercard />
          {method === "stripe" && <Blik />}
        </>
      )}
    </span>
  );
}
