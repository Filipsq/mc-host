// Who runs MCHosting: shown in the terms, the privacy policy and on the
// contact page. Anything left empty shows up there as a highlighted blank,
// so fill these in before the site takes real payments.
export const company = {
  name: "Filip Czarnecki", // full name, or the company's name
  address: "ul. Adama Próchnika 3/5 m. 31, 97-300 Piotrków Trybunalski", // street, postcode and city
  nip: "7712937445", // tax number, if the business has one
  email: "filipczarnecki.k@gmail.com", // where customers write: questions, complaints, withdrawals
  termsDate: "13.10.2026", // the day these terms take effect, e.g. "1.11.2026" (the English pages show it too)
};

/** The site's address as people see it, e.g. mchosting.pl. */
export function siteHost() {
  return new URL(process.env.APP_URL ?? "http://localhost:3000").host;
}
