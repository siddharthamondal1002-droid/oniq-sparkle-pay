import { COUNTRY_REGISTRY } from "@/data/countryRegistry";
import { ALL_LANGUAGES } from "@/data/languages";
import { FEATURE_CARDS } from "@/data/marketingCopy";
console.log("countries", Object.keys(COUNTRY_REGISTRY).length, Object.keys(COUNTRY_REGISTRY).join(","));
console.log("languages", ALL_LANGUAGES.length);
console.log("worlds live", FEATURE_CARDS.filter(c=>c.status==="live").length);
