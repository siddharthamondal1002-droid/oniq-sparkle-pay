// Text direction — resolved ONCE from the home country's CountryConfig.dir
// (AE => rtl) and applied to:
//   1. <html dir> for the document flow, and
//   2. every portal root (dialog, sheet, popover, dropdown, select, tooltip,
//      toast…) which mounts OUTSIDE the React tree and therefore does NOT
//      inherit the attribute. That omission is the classic RTL bug.
//
// Layout itself uses Tailwind v4 logical properties (ms-/me-/ps-/pe-,
// text-start/end, border-s/e, start-/end-). The `rtl:` variant is reserved
// for what logical properties cannot express — icon/chevron mirroring and
// transforms (rtl:-scale-x-100).
import { useEffect } from "react";
import { getCountryConfig, type Country } from "@/data/countryRegistry";
import { useCountry } from "@/lib/country";

export type Dir = "ltr" | "rtl";

export function dirForCountry(home: Country | null | undefined): Dir {
  return getCountryConfig(home ?? "IN").dir;
}

/** Direction for the active home country. Use on every portal content root. */
export function useDir(): Dir {
  const [home] = useCountry();
  return dirForCountry(home as Country | null);
}

/** Mount once inside the app shell: keeps <html dir> in sync. */
export function useDocumentDirection(): Dir {
  const dir = useDir();
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dir = dir;
    document.documentElement.classList.toggle("rtl", dir === "rtl");
  }, [dir]);
  return dir;
}
