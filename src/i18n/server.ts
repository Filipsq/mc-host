import "server-only";
import { cookies } from "next/headers";
import {
  CURRENCY_COOKIE,
  LOCALE_COOKIE,
  defaultCurrency,
  defaultLocale,
  isCurrency,
  isLocale,
} from "./config";
import { messages } from "./messages";

export async function getPreferences() {
  const jar = await cookies();
  const locale = jar.get(LOCALE_COOKIE)?.value;
  const currency = jar.get(CURRENCY_COOKIE)?.value;
  return {
    locale: isLocale(locale) ? locale : defaultLocale,
    currency: isCurrency(currency) ? currency : defaultCurrency,
  };
}

export async function getMessages() {
  const { locale } = await getPreferences();
  return messages[locale];
}
