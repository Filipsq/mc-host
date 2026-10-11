export const locales = ["pl", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "pl";

export const localeNames: Record<Locale, string> = {
  pl: "Polski",
  en: "English",
};

export const currencies = ["PLN", "EUR", "USD", "GBP"] as const;
export type Currency = (typeof currencies)[number];
export const defaultCurrency: Currency = "PLN";

export const currencySymbols: Record<Currency, string> = {
  PLN: "zł",
  EUR: "€",
  USD: "$",
  GBP: "£",
};

export const LOCALE_COOKIE = "locale";
export const CURRENCY_COOKIE = "currency";

export const isLocale = (v: unknown): v is Locale => locales.includes(v as Locale);
export const isCurrency = (v: unknown): v is Currency => currencies.includes(v as Currency);
