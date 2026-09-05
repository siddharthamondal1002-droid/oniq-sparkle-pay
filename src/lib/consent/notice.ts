// STANDALONE DPDP consent notice — content only, no React, no side effects.
//
// This notice is deliberately NOT part of the terms of use or the privacy
// policy. Accepting terms is a separate action and is never bundled with
// consent. No purpose is pre-ticked; every purpose carries its own notice.
//
// Versioning: bump NOTICE_VERSION whenever any wording below changes. The
// version and the locale actually shown are written into every ledger row.

import type { LegalRegime } from "@/data/countryRegistry";

export const NOTICE_VERSION = "2026-09-05.1";

/** The purpose id chat translation writes to the ledger. One name, one place. */
export const TRANSLATION_PURPOSE_ID = "translation";

/** Locales the notice exists in. English and Hindi at minimum. */
export const NOTICE_LOCALES = ["en", "hi"] as const;
export type NoticeLocale = (typeof NOTICE_LOCALES)[number];

export function resolveNoticeLocale(lang: string | undefined): NoticeLocale {
  return lang === "hi" ? "hi" : "en";
}

type L = Record<NoticeLocale, string>;

export type DataCategory = { id: string; label: L };

export type ConsentPurpose = {
  id: string;
  title: L;
  /** The specified purpose of this processing activity. */
  purpose: L;
  /** Itemised — each category named, never a vague summary. */
  categories: DataCategory[];
  /** True where the app cannot function at all without it. */
  essential?: boolean;
};

export const CONSENT_PURPOSES: ConsentPurpose[] = [
  {
    id: "account",
    essential: true,
    title: { en: "Running your account", hi: "आपका खाता चलाना" },
    purpose: {
      en: "To create and secure your ONIQ account, sign you in, and let other people find you by your username.",
      hi: "आपका ONIQ खाता बनाने और सुरक्षित रखने, आपको साइन इन कराने, और दूसरों को आपके यूज़रनेम से आपको खोजने देने के लिए।",
    },
    categories: [
      { id: "email", label: { en: "Email address", hi: "ईमेल पता" } },
      {
        id: "phone",
        label: {
          en: "Phone number (if you sign in with one)",
          hi: "फ़ोन नंबर (यदि आप उससे साइन इन करते हैं)",
        },
      },
      {
        id: "username",
        label: { en: "Username and display name", hi: "यूज़रनेम और प्रदर्शित नाम" },
      },
      {
        id: "avatar",
        label: { en: "Profile photo, if you upload one", hi: "प्रोफ़ाइल फ़ोटो, यदि आप अपलोड करें" },
      },
      {
        id: "dob",
        label: { en: "Date of birth (age check only)", hi: "जन्म तिथि (केवल आयु जाँच के लिए)" },
      },
      { id: "country", label: { en: "Home country you select", hi: "आपका चुना हुआ गृह देश" } },
    ],
  },
  {
    id: "communication",
    title: { en: "Messages and calls", hi: "संदेश और कॉल" },
    purpose: {
      en: "To deliver your chats, media and calls to the people you send them to, and to ring your device for incoming calls.",
      hi: "आपके चैट, मीडिया और कॉल उन लोगों तक पहुँचाने के लिए जिन्हें आप भेजते हैं, और आने वाली कॉल पर आपके डिवाइस को बजाने के लिए।",
    },
    categories: [
      {
        id: "messages",
        label: { en: "Message text and attachments you send", hi: "आपके भेजे संदेश और अटैचमेंट" },
      },
      {
        id: "call_meta",
        label: {
          en: "Call time, duration and participants (not call audio or video)",
          hi: "कॉल का समय, अवधि और प्रतिभागी (कॉल का ऑडियो/वीडियो नहीं)",
        },
      },
      {
        id: "device_token",
        label: {
          en: "Push notification token for your device",
          hi: "आपके डिवाइस का पुश नोटिफ़िकेशन टोकन",
        },
      },
    ],
  },
  {
    // Message content leaving the device to a third-party model provider is
    // its own processing purpose, and it is not covered by "Messages and
    // calls": delivering a message to the person you sent it to is a
    // different activity from sending someone else's words to a translator.
    // Nothing is translated until this is granted.
    id: "translation",
    title: { en: "Translating chat messages", hi: "चैट संदेशों का अनुवाद" },
    purpose: {
      en: "To translate a chat message into your language when you ask for it. The message text is sent to our AI provider (Anthropic, or Google as a fallback) to be translated, and the translation is stored so the same message does not have to be sent again. Machine translation can be wrong, so the original message is always kept and always shown to you. Nothing is translated automatically.",
      hi: "जब आप कहें तब किसी चैट संदेश का आपकी भाषा में अनुवाद करने के लिए। संदेश का टेक्स्ट अनुवाद हेतु हमारे AI प्रदाता (Anthropic, या विकल्प रूप में Google) को भेजा जाता है, और अनुवाद संग्रहित होता है ताकि वही संदेश दोबारा न भेजना पड़े। मशीन अनुवाद ग़लत हो सकता है, इसलिए मूल संदेश हमेशा रखा और दिखाया जाता है। कुछ भी स्वतः अनुवादित नहीं होता।",
    },
    categories: [
      {
        id: "message_text",
        label: {
          en: "The text of the message you ask to translate",
          hi: "उस संदेश का टेक्स्ट जिसका अनुवाद आप माँगते हैं",
        },
      },
      {
        id: "target_lang",
        label: { en: "The language you want it in", hi: "वह भाषा जिसमें आप उसे चाहते हैं" },
      },
      {
        id: "stored_translation",
        label: {
          en: "The stored translation, alongside the original message (the original is never replaced)",
          hi: "संग्रहित अनुवाद, मूल संदेश के साथ (मूल कभी नहीं बदला जाता)",
        },
      },
    ],
  },

  {
    id: "personalisation",
    title: { en: "Behavioural personalisation", hi: "व्यवहार आधारित निजीकरण" },
    purpose: {
      en: "To learn which parts of ONIQ you use and roughly when, so the right shortcut appears on your home screen. This is its own, separate purpose — it is never required to use ONIQ, and turning it off erases everything already collected.",
      hi: "यह जानने के लिए कि आप ONIQ के कौन से हिस्से और लगभग कब इस्तेमाल करते हैं, ताकि सही शॉर्टकट आपकी होम स्क्रीन पर दिखे। यह अपने आप में एक अलग उद्देश्य है — ONIQ चलाने के लिए यह कभी ज़रूरी नहीं, और इसे बंद करने पर अब तक जमा सब कुछ मिट जाता है।",
    },
    categories: [
      { id: "hub", label: { en: "Which hub you opened", hi: "आपने कौन सा हब खोला" } },
      {
        id: "time",
        label: { en: "Time of day and day of week", hi: "दिन का समय और सप्ताह का दिन" },
      },
      {
        id: "city",
        label: { en: "Coarse city (never precise location)", hi: "मोटा शहर (कभी सटीक स्थान नहीं)" },
      },
      {
        id: "card",
        label: {
          en: "Whether you tapped or dismissed a suggestion",
          hi: "आपने सुझाव पर टैप किया या हटाया",
        },
      },
    ],
  },
  {
    id: "study",
    title: { en: "Study Buddy tutoring", hi: "स्टडी बडी ट्यूशन" },
    purpose: {
      en: "To answer your questions against your board and syllabus, generate practice papers, keep your progress, and save the worksheets and photos you attach so you can use them again.",
      hi: "आपके बोर्ड और पाठ्यक्रम के अनुसार आपके प्रश्नों के उत्तर देने, अभ्यास प्रश्नपत्र बनाने, आपकी प्रगति रखने, और आपके द्वारा संलग्न वर्कशीट व फ़ोटो सहेजने के लिए ताकि आप उन्हें दोबारा उपयोग कर सकें।",
    },
    categories: [
      {
        id: "learner",
        label: {
          en: "Board, class, subjects and exam goal",
          hi: "बोर्ड, कक्षा, विषय और परीक्षा लक्ष्य",
        },
      },
      {
        id: "study_chat",
        label: { en: "Your tutor questions and answers", hi: "आपके ट्यूटर प्रश्न और उत्तर" },
      },
      { id: "scores", label: { en: "Quiz and paper scores", hi: "क्विज़ और प्रश्नपत्र अंक" } },
      {
        id: "study_docs",
        label: {
          en: "Worksheets, textbook photos and answer sheets you attach, which are kept so you can reuse them",
          hi: "आपके द्वारा संलग्न वर्कशीट, पाठ्यपुस्तक की फ़ोटो और उत्तर पुस्तिकाएँ, जिन्हें सहेजा जाता है ताकि आप उन्हें दोबारा उपयोग कर सकें",
        },
      },
    ],
  },
  {
    id: "health",
    title: { en: "Vitals health hub", hi: "वाइटल्स हेल्थ हब" },
    purpose: {
      en: "To store only the health entries you type yourself, so you can see them again. Nothing here is shared, sold or used to personalise anything.",
      hi: "केवल वे स्वास्थ्य प्रविष्टियाँ रखने के लिए जो आप स्वयं लिखते हैं, ताकि आप उन्हें फिर देख सकें। यह कहीं साझा, बेचा या निजीकरण में उपयोग नहीं होता।",
    },
    categories: [
      {
        id: "checkins",
        label: { en: "Daily check-ins you enter", hi: "आपकी दैनिक जाँच प्रविष्टियाँ" },
      },
      {
        id: "cycle",
        label: { en: "Cycle log dates you enter", hi: "आपके दर्ज चक्र लॉग की तिथियाँ" },
      },
    ],
  },
  {
    id: "career",
    title: { en: "CV builder and career data", hi: "सीवी बिल्डर और करियर डेटा" },
    purpose: {
      en: "To generate only the CVs you ask for, from the career facts you type yourself. This data is used for nothing else: it never personalises your home screen, never trains suggestions, and is never shared or sold. A CV can reveal a lot about you by inference, so it is kept apart from every other part of ONIQ, and it is available only to accounts aged 18 or over.",
      hi: "केवल वही सीवी बनाने के लिए जो आप माँगते हैं, उन्हीं करियर तथ्यों से जो आप स्वयं लिखते हैं। इस डेटा का और कोई उपयोग नहीं होता: यह न आपकी होम स्क्रीन को निजी बनाता है, न सुझावों को सिखाता है, और न कभी साझा या बेचा जाता है। सीवी से बहुत कुछ अनुमान लगाया जा सकता है, इसलिए इसे ONIQ के हर दूसरे हिस्से से अलग रखा जाता है, और यह केवल 18 वर्ष या उससे अधिक आयु के खातों के लिए उपलब्ध है।",
    },
    categories: [
      {
        id: "employment",
        label: {
          en: "Employment history you enter (employers, job titles, dates, what you did)",
          hi: "आपके दर्ज रोज़गार विवरण (नियोक्ता, पद, तिथियाँ, आपने क्या किया)",
        },
      },
      {
        id: "education",
        label: {
          en: "Education history you enter (institutions, qualifications, dates)",
          hi: "आपका दर्ज शिक्षा विवरण (संस्थान, योग्यताएँ, तिथियाँ)",
        },
      },
      {
        id: "skills",
        label: { en: "Skills and languages you list", hi: "आपके बताए कौशल और भाषाएँ" },
      },
      {
        id: "cv_documents",
        label: {
          en: "The CV documents generated for you, and the country each was written for",
          hi: "आपके लिए बने सीवी दस्तावेज़, और हर एक किस देश के लिए लिखा गया",
        },
      },
      {
        id: "attestations",
        label: {
          en: "Your accuracy attestation — that you confirmed each CV is true — with its timestamp",
          hi: "आपका सटीकता प्रमाणन — कि आपने हर सीवी को सही माना — उसके समय के साथ",
        },
      },
    ],
  },
];

/** Notice shown above the itemised list — plain language, standalone. */
export const NOTICE_INTRO: L = {
  en:
    "This is ONIQ's consent notice. It stands on its own: it is not the terms of use and not the privacy policy. " +
    "Below is every category of personal data ONIQ collects and exactly what each one is used for. " +
    "You choose each purpose separately. Nothing is ticked for you. You can withdraw any consent later in one tap, " +
    "as easily as you gave it, and withdrawal stops that processing.",
  hi:
    "यह ONIQ की सहमति सूचना है। यह अपने आप में पूर्ण है: यह न तो उपयोग की शर्तें हैं और न ही गोपनीयता नीति। " +
    "नीचे व्यक्तिगत डेटा की हर श्रेणी और उसका सटीक उपयोग दिया गया है। " +
    "आप हर उद्देश्य अलग-अलग चुनते हैं। कुछ भी पहले से चुना हुआ नहीं है। आप किसी भी सहमति को बाद में एक टैप में, " +
    "उतनी ही आसानी से वापस ले सकते हैं जितनी आसानी से दी थी, और वापस लेते ही वह प्रोसेसिंग रुक जाती है।",
};

export const NOTICE_STRINGS = {
  title: { en: "Consent notice", hi: "सहमति सूचना" },
  dataCollected: { en: "Data collected", hi: "एकत्र किया गया डेटा" },
  purposeLabel: { en: "Why", hi: "क्यों" },
  granted: { en: "Consent given", hi: "सहमति दी गई" },
  withdrawn: { en: "Not given", hi: "नहीं दी गई" },
  withdraw: { en: "Withdraw consent", hi: "सहमति वापस लें" },
  give: { en: "Give consent", hi: "सहमति दें" },
  essential: { en: "Required to run your account", hi: "खाता चलाने के लिए आवश्यक" },
  rights: { en: "Exercise your rights", hi: "अपने अधिकारों का उपयोग करें" },
  complain: {
    en: "Complain to the Data Protection Board",
    hi: "डेटा संरक्षण बोर्ड से शिकायत करें",
  },
  grievance: { en: "Grievance Officer", hi: "शिकायत अधिकारी" },
  terms: {
    en: "Accepting the terms of use is a separate action.",
    hi: "उपयोग की शर्तें स्वीकार करना एक अलग कार्य है।",
  },
  history: { en: "Your consent history", hi: "आपकी सहमति का इतिहास" },
  chainOk: { en: "Record chain verified — untampered", hi: "रिकॉर्ड शृंखला सत्यापित — अपरिवर्तित" },
  chainBad: { en: "Record chain verification FAILED", hi: "रिकॉर्ड शृंखला सत्यापन विफल" },
} satisfies Record<string, L>;

export function tr(v: L, locale: NoticeLocale): string {
  return v[locale] ?? v.en;
}

/* ------------------------------------------------------------------ */
/* Jurisdiction behaviour — one module, seven behaviours.              */
/* Driven solely by CountryConfig.legalRegime. No per-country branches. */
/* ------------------------------------------------------------------ */

export type ConsentModel = "explicit_opt_in" | "opt_in" | "opt_out" | "consent_local_norm";

export const REGIME_BEHAVIOUR: Record<LegalRegime, { model: ConsentModel; notice: L }> = {
  DPDP: {
    model: "explicit_opt_in",
    notice: {
      en: "Under India's DPDP Act, 2023 we must give you this notice and take your explicit consent before each purpose.",
      hi: "भारत के DPDP अधिनियम, 2023 के अंतर्गत हमें यह सूचना देनी होगी और हर उद्देश्य के लिए आपकी स्पष्ट सहमति लेनी होगी।",
    },
  },
  UKGDPR: {
    model: "opt_in",
    notice: {
      en: "Under the UK GDPR, each non-essential purpose is opt-in and you may withdraw at any time.",
      hi: "UK GDPR के अंतर्गत, हर ग़ैर-आवश्यक उद्देश्य के लिए सहमति देनी होती है और आप कभी भी वापस ले सकते हैं।",
    },
  },
  PIPEDA: {
    model: "consent_local_norm",
    notice: {
      en: "Under PIPEDA, consent is taken for each purpose in a form appropriate to its sensitivity.",
      hi: "PIPEDA के अंतर्गत, हर उद्देश्य के लिए उसकी संवेदनशीलता के अनुरूप सहमति ली जाती है।",
    },
  },
  APA: {
    model: "consent_local_norm",
    notice: {
      en: "Under the Australian Privacy Act, consent is taken for each purpose in a form appropriate to its sensitivity.",
      hi: "ऑस्ट्रेलियन प्राइवेसी एक्ट के अंतर्गत, हर उद्देश्य के लिए उपयुक्त रूप में सहमति ली जाती है।",
    },
  },
  PDPA: {
    model: "consent_local_norm",
    notice: {
      en: "Under the PDPA, consent is taken for each purpose in a form appropriate to its sensitivity.",
      hi: "PDPA के अंतर्गत, हर उद्देश्य के लिए उपयुक्त रूप में सहमति ली जाती है।",
    },
  },
  PDPL: {
    model: "explicit_opt_in",
    notice: {
      en: "Under the UAE PDPL, explicit opt-in consent is required for each purpose.",
      hi: "UAE PDPL के अंतर्गत, हर उद्देश्य के लिए स्पष्ट सहमति आवश्यक है।",
    },
  },
  US_STATE: {
    model: "opt_out",
    notice: {
      en: "Under US state privacy laws these purposes run unless you opt out — turn any of them off here at any time.",
      hi: "अमेरिकी राज्य कानूनों के अंतर्गत ये उद्देश्य तब तक चलते हैं जब तक आप बाहर न निकलें — इन्हें कभी भी बंद करें।",
    },
  },
};

/**
 * Default state of a NON-ESSENTIAL purpose before the user has ever acted.
 * Opt-out regimes start on; every consent regime starts off. Essential
 * purposes are never toggles, so they are not covered here.
 *
 * This is NOT a pre-ticked box: in opt-out regimes the law is that processing
 * is lawful until refused, and the switch shown reflects reality rather than
 * asking for a consent that was never given.
 */
export function defaultPurposeState(regime: LegalRegime): boolean {
  return REGIME_BEHAVIOUR[regime].model === "opt_out";
}
