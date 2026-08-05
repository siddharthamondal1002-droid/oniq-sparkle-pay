// English-proficiency tests — study notes and practice prompts under Campus.
//
// ============================================================================
// THE LEGAL POSITION, BECAUSE IT DECIDES WHAT THIS FILE MAY CONTAIN
// ============================================================================
//
// The question asked was "add TOEFL, IELTS etc. as study notes, and practice
// tests if legally feasible". It is feasible, but only in one specific shape,
// and the boundary is sharp enough to be worth writing down.
//
// WHAT IS SAFE
//
//   1. FORMAT AND STRUCTURE ARE FACTS. That IELTS Listening has 40 questions,
//      or that TOEFL iBT scores 0–120 across four sections of 0–30, is a fact
//      about the world. Facts are not copyrightable (Feist v. Rural). ONIQ may
//      state them, in ONIQ's own words.
//
//   2. NAMING A TEST IS NOMINATIVE FAIR USE. You cannot write a note about
//      IELTS without saying "IELTS". That is permitted where the thing is not
//      identifiable otherwise, no more of the mark is used than necessary, and
//      nothing suggests sponsorship. Hence: text names only, no logos, no
//      colours or lettering imitating a mark, and a standing disclaimer.
//
//   3. ONIQ'S OWN PRACTICE PROMPTS. Writing a new essay prompt in the same
//      FORM as a test task is not copying: form is not protected, particular
//      expression is. Every prompt below was written for ONIQ.
//
// WHAT IS NOT SAFE, AND IS THEREFORE ABSENT
//
//   1. REAL TEST ITEMS. Live and retired questions are copyrighted and, for
//      several of these tests, also protected as trade secrets. Not one
//      appears here. This is the bright line.
//
//   2. OFFICIAL BAND DESCRIPTORS AND SCORING RUBRICS. These are published, but
//      publication is not a licence — the wording is the owners' expression.
//      Where scoring is described below it is described in ONIQ's own words,
//      at the level of "what the examiner is looking for", never reproduced.
//
//   3. SAMPLE ANSWERS, READING PASSAGES OR AUDIO from any official material.
//
//   4. ANY CLAIM OF OFFICIALNESS OR OUTCOME. No "official practice test", no
//      predicted band, no score guarantee, no "ETS-approved". ONIQ does not
//      score anything here and says so.
//
// Trademarks: TOEFL is a registered trademark of Educational Testing Service.
// IELTS is jointly owned by the British Council, IDP: IELTS Australia and
// Cambridge University Press & Assessment. PTE Academic is Pearson's. The
// Duolingo English Test is Duolingo's. ONIQ is not affiliated with, endorsed
// by or approved by any of them. See TEST_DISCLAIMER.
//
// ============================================================================
// ACCURACY
// ============================================================================
//
// Test formats change, and they change without much warning — TOEFL iBT was
// cut to under two hours in 2023, and the independent essay was replaced. So
// every entry carries `verifiedOn` and links to the owner's own page, and the
// UI must show both. A stale format note is worse than no format note, because
// someone will plan a revision timetable around it.

export type TestSection = {
  name: string;
  /** ONIQ's own one-line description of what the section asks of you. */
  what: string;
  /** Timing as published by the test owner. Omitted where it is adaptive. */
  minutes?: number;
  questions?: string;
};

export type PracticePrompt = {
  id: string;
  /** Which section of the test this rehearses. */
  section: string;
  /** ONIQ's own prompt. Never a real or retired item. */
  prompt: string;
  /** What a strong response does — ONIQ's words, not a published rubric. */
  lookFor: string;
  /** Suggested time, mirroring the real task's timing. */
  minutes: number;
};

export type EnglishTest = {
  id: string;
  /** The mark, used nominatively. Text only — never rendered as a logo. */
  name: string;
  owner: string;
  /** Who typically asks for it. Factual, and the reason to care. */
  acceptedFor: string;
  scoring: string;
  totalMinutes: string;
  sections: TestSection[];
  /** ONIQ's own preparation notes. Not sourced from any prep publisher. */
  notes: string[];
  practice: PracticePrompt[];
  /** The owner's own page. Registration and the authoritative format live there. */
  officialUrl: string;
  /** ISO date the structural facts above were last checked. */
  verifiedOn: string;
};

export const TEST_DISCLAIMER =
  "ONIQ is not affiliated with, endorsed by or approved by any test owner. Test names are used only to say which test a note is about. Every practice prompt here is written by ONIQ — none is a real, retired or leaked exam question, and nothing here is scored or predicts a result. Formats change: check the official site before you rely on any timing below.";

export const PRACTICE_DISCLAIMER =
  "ONIQ wrote these prompts. They copy the shape of the real task — the topic type, the timing, what you have to produce — but not any actual question. Use them to rehearse, then get real feedback from a teacher or a marked course.";

export const ENGLISH_TESTS: EnglishTest[] = [
  {
    id: "ielts-academic",
    name: "IELTS Academic",
    owner: "British Council, IDP: IELTS Australia and Cambridge University Press & Assessment",
    acceptedFor:
      "Undergraduate and postgraduate admission in the UK, Australia, Canada and Singapore, and for several UK and Australian visa routes.",
    scoring:
      "Band 0–9, in half bands, for each section and overall. Most universities ask for 6.0–7.5 overall with a minimum in each section.",
    totalMinutes: "About 2 hours 45 minutes, with Speaking sometimes on a different day.",
    sections: [
      {
        name: "Listening",
        what: "Four recordings, getting harder — two everyday, two academic. You hear each once.",
        minutes: 30,
        questions: "40 questions",
      },
      {
        name: "Reading",
        what: "Three long academic passages with a wide range of question types.",
        minutes: 60,
        questions: "40 questions",
      },
      {
        name: "Writing",
        what: "Task 1 describes a chart, table, diagram or process. Task 2 is an argument essay and carries more weight.",
        minutes: 60,
        questions: "2 tasks",
      },
      {
        name: "Speaking",
        what: "A face-to-face interview in three parts: familiar topics, a long turn from a card, then a discussion.",
        minutes: 14,
        questions: "3 parts",
      },
    ],
    notes: [
      "Task 2 is worth twice Task 1. If you are short of time, protect Task 2 — finishing it badly costs less than not finishing it.",
      "In Task 1 you describe what the data shows. You do not explain why, and you do not give an opinion. Marks are lost for inventing causes.",
      "Listening plays once only. Read the questions during the pauses so you know what you are listening for before it starts.",
      "In Speaking Part 2 you get one minute to prepare and should talk for two. Silence is what costs marks — an imperfect answer that keeps going scores better than a perfect sentence and a pause.",
      "There are two versions: Academic and General Training. Universities want Academic. Check which one your visa route needs before you book — they are not interchangeable.",
    ],
    practice: [
      {
        id: "ielts-w2-a",
        section: "Writing Task 2",
        prompt:
          "Some cities are removing cars from their centres entirely. Others argue this simply moves congestion elsewhere and harms small businesses. Discuss both views and give your own opinion.",
        lookFor:
          "A clear position held consistently from the introduction to the conclusion, both views given real weight rather than one being a strawman, and each paragraph built around a single idea with a concrete example.",
        minutes: 40,
      },
      {
        id: "ielts-w2-b",
        section: "Writing Task 2",
        prompt:
          "In many countries, people are working later in life than their parents did. Is this a positive or a negative development?",
        lookFor:
          "A direct answer to the question asked — positive or negative, not 'both have merits'. Address the strongest objection to your view rather than the easiest one.",
        minutes: 40,
      },
      {
        id: "ielts-w1-a",
        section: "Writing Task 1",
        prompt:
          "Describe the stages of a process you know well — how a parcel gets from a warehouse to a doorstep, or how rainwater is collected and treated. Write it as a process description with an overview and two body paragraphs.",
        lookFor:
          "An overview sentence that states the whole shape before any detail, correct sequencing language, and passive forms where the actor does not matter.",
        minutes: 20,
      },
      {
        id: "ielts-s2-a",
        section: "Speaking Part 2",
        prompt:
          "Describe a decision you made that other people disagreed with. Say what the decision was, who disagreed and why, and whether you would make it again.",
        lookFor:
          "Two full minutes without stopping, past tense held consistently, and the last part of the card actually answered — candidates routinely run out of time before reaching it.",
        minutes: 2,
      },
    ],
    officialUrl: "https://ielts.org",
    verifiedOn: "2026-08-05",
  },
  {
    id: "toefl-ibt",
    name: "TOEFL iBT",
    owner: "Educational Testing Service (ETS)",
    acceptedFor:
      "Undergraduate and graduate admission in the United States and Canada, and widely accepted elsewhere.",
    scoring:
      "0–30 per section, 0–120 total. US universities commonly ask for 79–100; competitive programmes ask for more.",
    totalMinutes: "Under 2 hours since the 2023 shortening.",
    sections: [
      {
        name: "Reading",
        what: "Academic passages with multiple-choice questions.",
        minutes: 35,
        questions: "2 passages",
      },
      {
        name: "Listening",
        what: "Lectures and campus conversations. You may take notes throughout.",
        minutes: 36,
      },
      {
        name: "Speaking",
        what: "Four recorded tasks: one on a familiar topic, three that combine reading, listening and speaking.",
        minutes: 16,
        questions: "4 tasks",
      },
      {
        name: "Writing",
        what: "One integrated task from a passage and a lecture, plus a written contribution to an academic discussion.",
        minutes: 29,
        questions: "2 tasks",
      },
    ],
    notes: [
      "The independent essay is gone. The second writing task is now a contribution to an online academic discussion — you read a professor's question and two student replies, then add your own view in about ten minutes.",
      "Speaking is recorded, not a conversation. There is no examiner reacting to you, so pace yourself against the timer rather than against a listener.",
      "The integrated tasks reward accurate reporting of what the lecture said, especially where it contradicts the reading. Your own opinion is not being asked for.",
      "Note-taking is allowed in every section and matters most in Listening, where nothing is repeated.",
      "Because the test is under two hours, there is no long break to reset in. Plan your stamina for one continuous sitting.",
    ],
    practice: [
      {
        id: "toefl-w2-a",
        section: "Writing — academic discussion",
        prompt:
          "A lecturer asks: 'Should universities require every student, regardless of subject, to take a course in statistics?' One student says yes, because data literacy is now basic civic competence. Another says no, because it displaces depth in the student's own field. Write your contribution.",
        lookFor:
          "Direct engagement with at least one of the two students by name or position, a reason that neither has already given, and roughly 100–150 words of dense, specific prose.",
        minutes: 10,
      },
      {
        id: "toefl-s1-a",
        section: "Speaking — independent task",
        prompt:
          "Some people prefer to learn a new skill from a teacher; others prefer to teach themselves. Which do you prefer, and why? Speak for 45 seconds after 15 seconds of preparation.",
        lookFor:
          "A stated preference in the first sentence, then two reasons with one concrete personal example. Finishing the thought before the timer matters more than sounding polished.",
        minutes: 1,
      },
      {
        id: "toefl-r1-a",
        section: "Reading",
        prompt:
          "Take any 700-word article from a university's public research news page. Give yourself 18 minutes to read it and write, from memory, the main claim, the evidence offered, and one thing the article does not establish.",
        lookFor:
          "Separating what was argued from what was proved. TOEFL reading questions turn on exactly that distinction.",
        minutes: 18,
      },
    ],
    officialUrl: "https://www.ets.org/toefl",
    verifiedOn: "2026-08-05",
  },
  {
    id: "pte-academic",
    name: "PTE Academic",
    owner: "Pearson",
    acceptedFor:
      "University admission and visa applications in Australia, New Zealand and the UK, and accepted by many institutions elsewhere.",
    scoring:
      "10–90 on the Global Scale of English. Scored by computer, usually returned within days.",
    totalMinutes: "About 2 hours, in one sitting.",
    sections: [
      {
        name: "Speaking & Writing",
        what: "Spoken responses and written tasks in one timed part.",
        minutes: 54,
      },
      {
        name: "Reading",
        what: "Multiple-choice, reordering and fill-in-the-blank tasks.",
        minutes: 30,
      },
      {
        name: "Listening",
        what: "Audio and video clips with summary, multiple-choice and dictation tasks.",
        minutes: 30,
      },
    ],
    notes: [
      "Marking is automated. Clear, evenly-paced speech scores better than expressive speech with pauses — the scorer is measuring fluency and pronunciation mechanically, not charm.",
      "Many tasks are scored on more than one trait at once, so a single answer can gain marks in both reading and writing. Do not skip a task because you are weak at one half of it.",
      "Because it is computer-marked, results usually arrive far faster than the interview-based tests. That matters if you are close to an application deadline.",
    ],
    practice: [
      {
        id: "pte-sw-a",
        section: "Speaking — retell lecture",
        prompt:
          "Play any 90-second segment of a public university lecture. Listen once, take notes, then retell it in 40 seconds.",
        lookFor:
          "The main claim first, then supporting points in the order given. Fluency without long pauses is worth more here than complete coverage.",
        minutes: 3,
      },
      {
        id: "pte-w-a",
        section: "Writing — summarise written text",
        prompt:
          "Take a 300-word news analysis piece and compress it into ONE sentence of no more than 75 words that keeps the main claim and its principal support.",
        lookFor:
          "A single grammatical sentence. This task fails automatically if you write two, however good they are.",
        minutes: 10,
      },
    ],
    officialUrl: "https://www.pearsonpte.com",
    verifiedOn: "2026-08-05",
  },
  {
    id: "duolingo-english-test",
    name: "Duolingo English Test",
    owner: "Duolingo",
    acceptedFor:
      "Accepted by a growing number of universities, particularly in the US and Canada. Acceptance is far from universal — confirm with each institution before booking.",
    scoring: "10–160, with subscores. Results usually within two days.",
    totalMinutes: "About 1 hour, taken online at home.",
    sections: [
      {
        name: "Adaptive section",
        what: "Question difficulty adjusts to your answers, mixing reading, writing, listening and speaking tasks.",
      },
      {
        name: "Writing and speaking sample",
        what: "Longer responses, sent unscored to the institutions you nominate.",
      },
    ],
    notes: [
      "Sat at home under remote proctoring, so the practical requirements — a quiet room, a working camera, ID — are part of passing it.",
      "Adaptive means early questions steer the rest. Rushing the opening items can cap the difficulty band you are offered, and with it your score.",
      "The cheapest and fastest of these tests, but the least universally accepted. Check your specific universities accept it before choosing it over IELTS or TOEFL.",
    ],
    practice: [
      {
        id: "det-w-a",
        section: "Writing",
        prompt:
          "Write for five minutes without stopping about a place that changed how you think about something. Do not plan first.",
        lookFor:
          "Volume of coherent, varied language under time pressure. This test rewards sustained production more than careful editing.",
        minutes: 5,
      },
      {
        id: "det-s-a",
        section: "Speaking",
        prompt:
          "Look at any photograph and describe it aloud for 90 seconds without pausing — what is in it, what happened just before, what happens next.",
        lookFor: "Continuous speech. Filling the full time coherently is the skill being measured.",
        minutes: 2,
      },
    ],
    officialUrl: "https://englishtest.duolingo.com",
    verifiedOn: "2026-08-05",
  },
];

export function testById(id: string): EnglishTest | null {
  return ENGLISH_TESTS.find((t) => t.id === id) ?? null;
}

/**
 * Which tests are worth showing first for a destination country. Relevance
 * only — every test is still listed, because acceptance varies by institution
 * and a filtered-out option a user actually needs is worse than a long list.
 */
export function testsForDestination(country: string): EnglishTest[] {
  const preferred: Record<string, string[]> = {
    US: ["toefl-ibt", "duolingo-english-test", "ielts-academic", "pte-academic"],
    CA: ["ielts-academic", "toefl-ibt", "duolingo-english-test", "pte-academic"],
    GB: ["ielts-academic", "pte-academic", "toefl-ibt", "duolingo-english-test"],
    AU: ["ielts-academic", "pte-academic", "toefl-ibt", "duolingo-english-test"],
    SG: ["ielts-academic", "toefl-ibt", "pte-academic", "duolingo-english-test"],
    AE: ["ielts-academic", "toefl-ibt", "pte-academic", "duolingo-english-test"],
    IN: ["ielts-academic", "toefl-ibt", "pte-academic", "duolingo-english-test"],
  };
  const order = preferred[country] ?? ENGLISH_TESTS.map((t) => t.id);
  return [...ENGLISH_TESTS].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
