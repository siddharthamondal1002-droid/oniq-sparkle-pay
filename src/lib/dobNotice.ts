/**
 * Why we ask for a date of birth — the plain-language purpose notice required
 * by the DPDP Act, in English and Hindi. One source of truth, rendered by both
 * the signup form and the existing-account prompt.
 *
 * The wording names the actual purpose (age-restricted features + parental
 * consent under 18). It must never be softened into "to personalise your
 * experience" or "to serve you better".
 */
export const DOB_REASON = {
  en: "We need your date of birth to confirm you're old enough for age-restricted features like Jobs, and because Indian law requires a parent's consent for anyone under 18.",
  hi: "हमें आपकी जन्म तिथि इसलिए चाहिए ताकि यह पक्का हो सके कि आप Jobs जैसी आयु-प्रतिबंधित सुविधाओं के लिए पर्याप्त बड़े हैं, और इसलिए भी कि भारतीय कानून के अनुसार 18 वर्ष से कम आयु वालों के लिए माता-पिता की सहमति ज़रूरी है।",
} as const;

export const DOB_PROMPT_TITLE = {
  en: "Add your date of birth",
  hi: "अपनी जन्म तिथि जोड़ें",
} as const;
