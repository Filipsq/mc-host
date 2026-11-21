/** Which pay button sent a checkout form: "card" (Visa/Mastercard through Stripe) or "cashbill" (BLIK and transfers). */
export function payMethod(form: FormData): "card" | "cashbill" {
  return form.get("method") === "card" ? "card" : "cashbill";
}
