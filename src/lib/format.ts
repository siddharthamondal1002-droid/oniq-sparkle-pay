// ONIQ formatting layer — every currency, number, date, time, relative-time,
// plural and list string in the app goes through here.
//
// Single source of truth: CountryConfig.numberLocale + .currency from
// src/data/countryRegistry.ts, driven by the user's HOME country (identity),
// never by currentRegion (location). A traveller in Dubai still sees their
// home currency and date order.
//
// Nothing here hand-rolls grouping: Intl already knows that en-IN groups as
// 12,34,567.89 and en-US as 1,234,567.89.
import { getCountryConfig, formatMoney, type Country } from "@/data/countryRegistry";
import { useCountry, getCountry } from "@/lib/country";

export type Formatters = {
  home: Country;
  locale: string;
  currency: string;
  /** ₹12,34,567.89 / $1,234,567.89 — always the home currency. */
  money: (amount: number, opts?: Intl.NumberFormatOptions) => string;
  /** Plain grouped number, no currency. */
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
  /** 0–1 → "12%". */
  percent: (fraction: number, opts?: Intl.NumberFormatOptions) => string;
  /** 1.2 MB / 3.4 GB, locale-grouped. */
  bytes: (n: number) => string;
  date: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  time: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  dateTime: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  /** "3 hours ago", "in 2 days" — auto-picks the unit. */
  relative: (d: Date | string | number, now?: Date) => string;
  /** "a, b and c" */
  list: (items: string[], type?: "conjunction" | "disjunction") => string;
  /** Intl.PluralRules category for `n` (use to pick a dictionary key). */
  plural: (n: number) => Intl.LDMLPluralRule;
};

const toDate = (d: Date | string | number): Date => (d instanceof Date ? d : new Date(d));

const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000000],
  ["month", 2592000000],
  ["week", 604800000],
  ["day", 86400000],
  ["hour", 3600000],
  ["minute", 60000],
  ["second", 1000],
];

/** Pure formatter factory — safe outside React (tests, server fns, utils). */
export function makeFormatters(home: Country): Formatters {
  const cfg = getCountryConfig(home);
  const locale = cfg.numberLocale;

  const nf = (opts?: Intl.NumberFormatOptions) => {
    try {
      return new Intl.NumberFormat(locale, opts);
    } catch {
      return new Intl.NumberFormat("en", opts);
    }
  };
  const dtf = (opts: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale, opts);
    } catch {
      return new Intl.DateTimeFormat("en", opts);
    }
  };

  return {
    home,
    locale,
    currency: cfg.currency,
    money: (amount, opts) =>
      opts
        ? nf({ style: "currency", currency: cfg.currency, ...opts }).format(amount)
        : formatMoney(amount, home),
    number: (n, opts) => nf(opts).format(n),
    percent: (fraction, opts) =>
      nf({ style: "percent", maximumFractionDigits: 0, ...opts }).format(fraction),
    bytes: (n) => {
      const units = ["B", "KB", "MB", "GB", "TB"];
      let v = n;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
      }
      return `${nf({ maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`;
    },
    date: (d, opts) => dtf(opts ?? { dateStyle: "medium" }).format(toDate(d)),
    time: (d, opts) => dtf(opts ?? { timeStyle: "short" }).format(toDate(d)),
    dateTime: (d, opts) =>
      dtf(opts ?? { dateStyle: "medium", timeStyle: "short" }).format(toDate(d)),
    relative: (d, now) => {
      const diff = toDate(d).getTime() - (now ?? new Date()).getTime();
      const abs = Math.abs(diff);
      const [unit, ms] = REL_UNITS.find(([, m]) => abs >= m) ?? REL_UNITS[REL_UNITS.length - 1];
      try {
        return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
          Math.round(diff / ms),
          unit,
        );
      } catch {
        return toDate(d).toISOString();
      }
    },
    list: (items, type = "conjunction") => {
      try {
        return new Intl.ListFormat(locale, { style: "long", type }).format(items);
      } catch {
        return items.join(", ");
      }
    },
    plural: (n) => {
      try {
        return new Intl.PluralRules(locale).select(n);
      } catch {
        return n === 1 ? "one" : "other";
      }
    },
  };
}

/** React entry point. Re-derives when the user changes their home country. */
export function useFormat(): Formatters {
  const [home] = useCountry();
  return makeFormatters((home ?? "IN") as Country);
}

/**
 * Non-React escape hatch for data that is denominated in a FIXED currency
 * (e.g. Indian partner quotes in INR, demo food prices in USD). Grouping and
 * digit shaping still follow the user's home locale — only the currency is
 * pinned to the data. Use `useFormat().money()` for user-facing home-currency
 * amounts.
 */
export function moneyIn(amount: number, currency: string, home?: Country): string {
  const resolved = home ?? ((typeof window === "undefined" ? "IN" : getCountry()) as Country);
  const locale = getCountryConfig(resolved).numberLocale;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** Formatters for the current home country, outside React. */
export function homeFormat(): Formatters {
  return makeFormatters((typeof window === "undefined" ? "IN" : getCountry()) as Country);
}
