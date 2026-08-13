// ONIQ ORIGINALS — season one narration.
//
// Data only. The words a narrator reads, keyed by the scene ids in
// originals.ts. Kept in a separate file for the same reason lores.ts is
// separate: originals.ts describes what the CAMERA does, this describes what
// the VOICE does, and the two are edited by different people at different
// times.
//
// They cannot drift. originalsScript.test.ts asserts that every scene in
// ORIGINALS has exactly one narration entry and that every entry matches a
// real scene — so adding a scene without a line, or leaving a line behind
// after deleting a scene, fails the build rather than surfacing as a silent
// gap in an episode.
//
// SOURCES. Original retellings. Public-domain texts (Burton 1885-88, Lane
// 1838-40, Galland 1704-17) were consulted for PLOT ONLY and then written from
// a blank page. No translation is reproduced. This matters: the tales are
// public domain, but individual translations are separate copyrighted works
// and modern ones (Haddawy, Lyons) are firmly in copyright.
//
// COMPLIANCE, carried from originals.ts and not to be quietly relaxed:
// no prophet, no divine figure, no scripture; the jar's seal is an unreadable
// mark rather than Solomon's; jinn are folkloric wonder-beings with no
// theological framing; violence is implied and never depicted.
//
// Deliberately removed from the source material: the seal of Solomon (ep1),
// the quartering of Kasim (ep2), the boiling oil (ep2 — implied only), and
// the magician's brother (ep3 — held for the season finale).

/**
 * Who speaks, and in which TTS voice.
 *
 * The narrator is `ash` in every episode and must stay that way — the art can
 * change between episodes, a new narrator reads as a different show.
 *
 * THE TWO JINN MUST BE TELLABLE APART. The production notes require it of the
 * designs; it applies at least as strongly to the voices, because a listener
 * has nothing else to go on. The ring jinni is smaller, sharper and made of
 * light; the lamp jinni is vast, slow, smoke and ember. They are cast at
 * opposite ends of the range on purpose, and they must never be swapped between
 * episodes once an audience has heard them.
 */
export const VOICES = {
  narrator: "ash",
  aladdin: "echo",
  magician: "ballad",
  ringJinni: "shimmer",
  lampJinni: "onyx",
} as const;

export type VoiceKey = keyof typeof VOICES;

/** One spoken run of text, in one voice. */
export type Segment = {
  voice: VoiceKey;
  text: string;
};

/** Narration for one scene. Runtime is derived from the audio, never guessed. */
export type ScriptLine = {
  /** Scene id in ORIGINALS. */
  sceneId: string;
  /**
   * The whole scene as prose. Remains the canonical text: every existing
   * compliance and length check reads this, and it is what a reader reviews.
   */
  narration: string;
  /**
   * The same words, divided by speaker, when a scene has dialogue in it.
   *
   * A DIVISION, NEVER A REWRITE. The segments must rejoin to `narration`
   * exactly, and a test enforces it — so the spoken episode can never quietly
   * drift from the script that was reviewed and signed off.
   *
   * Attributions stay with the narrator, which is why some segments are two
   * words: "“Below,”" is the magician, "said the man," is not. Splitting there
   * is what stops a character reading their own stage direction aloud.
   *
   * Absent means the whole scene is the narrator, which is most of them.
   */
  segments?: Segment[];
};

/** The scene's audio, as the list of clips to generate and concatenate. */
export function segmentsFor(line: ScriptLine): Segment[] {
  return line.segments ?? [{ voice: "narrator", text: line.narration }];
}

/**
 * Bengali transliterations, locked before recording.
 *
 * Fixed here rather than left to whoever books the session, because a name
 * pronounced two ways across three episodes is the kind of thing an audience
 * notices immediately and a production cannot fix without re-recording.
 */
export const BENGALI_NAMES = {
  aladdin: "আলাদিন",
  aliBaba: "আলি বাবা",
  morgiana: "মর্জিনা",
} as const;

export const SEASON_SCRIPT: ScriptLine[] = [
  // ---------------------------------------------------------------- ep 1 ---
  {
    sceneId: "ep1_s01",
    narration:
      "There was once a fisherman so poor that he owned nothing but a net, a knife, and a rule he had made for himself. Four casts a day. Never more. Whatever the sea gave him on those four casts, he would take, and he would be content. This is the story of the day the sea tested that rule.",
  },
  {
    sceneId: "ep1_s02",
    narration:
      "The first cast came back heavy. So heavy he had to brace his feet in the sand and haul with both hands, and his heart lifted, because heavy meant fish, and fish meant bread.",
  },
  {
    sceneId: "ep1_s03",
    narration:
      "It was a donkey. Drowned, and long drowned. He worked it free without complaining, because complaining had never once filled a stomach, and he washed his net, and he cast again.",
  },
  {
    sceneId: "ep1_s04",
    narration:
      "The second cast brought a jar full of mud. He tipped it out, washed his net, and cast a third time.",
  },
  {
    sceneId: "ep1_s05",
    narration:
      "The third brought broken pots, and old glass, and a single shoe. Three casts gone. One left. He stood a long moment with the wet rope in his hands and looked at the water, and the water told him nothing at all.",
  },
  {
    sceneId: "ep1_s06",
    narration:
      "The fourth cast brought up a jar of copper. It was old — older than the village, older than the language people spoke in it. The mouth was stopped with lead, and pressed into the lead was a mark that no one living could read. The fisherman turned it in his hands. It weighed nothing. Whatever was inside was not water and was not gold. He should have thrown it back. He knew that even as he took out his knife.",
  },
  {
    sceneId: "ep1_s07",
    narration:
      "The seal came away. Smoke came out of the jar. Not a wisp of it — a river, pouring upward, more smoke than the jar could hold, more smoke than seemed possible, until it stood over the beach like weather.",
  },
  {
    sceneId: "ep1_s08",
    narration:
      "And then it was not smoke. The jinni stood as tall as the cliff, and its eyes were the colour of a fire that has burned all night and is not finished yet. “Fisherman,” it said, and the sand jumped. “Choose how you would like to die.”",
  },
  {
    sceneId: "ep1_s09",
    narration:
      "The fisherman did not run. There was nowhere on that beach to run to. “I freed you,” he said. “Why would you kill me?” “Because I made a promise,” said the jinni. “For a hundred years in that jar I swore I would make whoever freed me rich beyond counting. No one came. For a hundred more I swore I would give them the treasures of the earth. No one came. For a hundred more, a kingdom. No one came.” The great head lowered. “And then I stopped promising gifts. And I swore instead that whoever opened this jar would die. And you,” it said, “are late.”",
  },
  {
    sceneId: "ep1_s10",
    narration:
      "The fisherman looked at the jinni. Then he looked at the jar, lying on its side in the sand, small enough to carry under one arm. “Then I will die,” he said. “But I will die calling you a liar.” The fire in the jinni’s eyes moved. “A liar.” “You are a mountain,” said the fisherman. “That jar would not hold my dinner. You were never inside it. You found it on the sand as I did, and you have built a story on it, and I would rather die honest than believe a thing that cannot be true.”",
  },
  {
    sceneId: "ep1_s11",
    narration:
      "There is a kind of pride that is stronger than hunger, and stronger than anger, and the jinni had it. “Watch,” it said. The smoke came down. It poured into the jar the way water pours into a cup, and the last of it went in with a sound like a held breath let go. The fisherman pressed the lead back into the mouth of the jar.",
  },
  {
    sceneId: "ep1_s12",
    narration:
      "From inside came a voice, very small now. It offered him gold. It offered him a kingdom. It offered him a hundred years of anything he cared to name. The fisherman sat down on the sand beside it and waited for his breath to come back. “You had three hundred years to be generous,” he said. “You will forgive me if I take a moment.” And the sun came up on a poor man who owned nothing but a net, a knife, a rule — and, that morning, the only thing that had ever mattered. He had been quicker than something a thousand times his size.",
  },

  // ---------------------------------------------------------------- ep 2 ---
  {
    sceneId: "ep2_s01",
    narration:
      "Ali Baba cut wood for a living, which is a way of saying he was poor and worked hard and expected nothing to change. He had a brother named Kasim who had married money and never let anyone forget it. And he had a household of one servant — a young woman called Morgiana, who was cleverer than every other person in this story put together. Remember her. This is not really Ali Baba’s story.",
  },
  {
    sceneId: "ep2_s02",
    narration: "One afternoon, high in the hills, Ali Baba saw dust on the road.",
  },
  {
    sceneId: "ep2_s03",
    narration:
      "Dust on that road meant riders, and riders that far from any town meant men who did not want to be seen. He put his donkey behind a rock and himself up a tree, and he made himself very small. They came past below him. He counted forty.",
  },
  {
    sceneId: "ep2_s04",
    narration:
      "Their captain dismounted before a wall of bare rock. He stood there a moment, and then he spoke, not loudly, the way a man speaks to a door he knows will open. “Open, Sesame.”",
  },
  {
    sceneId: "ep2_s05",
    narration:
      "The rock opened. The forty went in with their sacks, and after a while they came out with empty hands, and the captain said, “Close, Sesame,” and the hill was a hill again. Ali Baba stayed in that tree a long time after the dust had settled.",
  },
  {
    sceneId: "ep2_s06",
    narration:
      "Then he climbed down, and stood where the captain had stood, and felt extremely foolish, and said the words.",
  },
  {
    sceneId: "ep2_s07",
    narration:
      "The hill opened for him too. Inside was everything that had ever gone missing from every caravan on that road. Silk in bolts. Lamps. Coin in drifts, like sand. Ali Baba was a practical man. He did not take the silk, and he did not take the lamps, and he did not stand there dreaming. He filled two sacks with gold — as much as one donkey could carry without looking like it was carrying anything — and he went home.",
  },
  {
    sceneId: "ep2_s08",
    narration:
      "And here the trouble starts, and it starts the way trouble usually does — with somebody wanting to know exactly how much. His wife could not simply be rich. She wanted the gold measured. So she borrowed a scale from Kasim’s wife, who was curious enough to smear a little wax on the underside before she handed it over. When the scale came back, there was a gold coin stuck to the wax. Nobody weighs gold. You count gold. You only weigh it when there is too much to count.",
  },
  {
    sceneId: "ep2_s09",
    narration:
      "Kasim was at his brother’s door before the evening was out, and Ali Baba, who had never been able to lie to family, told him everything. Kasim left the next morning with ten mules.",
  },
  {
    sceneId: "ep2_s10",
    narration:
      "He said the words. The hill opened. He went in and stood among more wealth than he had ever imagined and began to fill sack after sack after sack. And when he turned at last to leave, with his arms full and his mind full of everything he would buy — he could not remember the word. He tried a dozen. Barley. Wheat. Corn. Every grain but the one.",
  },
  {
    sceneId: "ep2_s11",
    narration:
      "The thieves came back that afternoon. Kasim did not come home. Not that day, and not after.",
  },
  {
    sceneId: "ep2_s12",
    narration:
      "The thieves worked out whose brother he had been, and one evening a merchant came to Ali Baba’s door — a big man, courteous, with a caravan of oil jars and nowhere to stay the night. Ali Baba, who had been poor long enough to know what it costs to be turned away, gave him the courtyard. Morgiana went out to the jars for oil to fill the lamps. And from inside the first jar, a voice said quietly, “Is it time?”",
  },
  {
    sceneId: "ep2_s13",
    narration:
      "A lesser person would have screamed. A lesser person would have run inside and woken the house and given the game away in about four seconds. Morgiana said, “Not yet.” Then she went to every jar in that courtyard, one after another, and said the same two words in the same steady voice. Thirty-seven times. And then she dealt with them, quietly, in the dark, and not one of the thirty-seven ever troubled anyone again.",
  },
  // S14 was one 167-word block and measured 65.2 seconds — held on a single
  // still, which is a stall. Episode 1's longest hold is 45s and that was
  // already at the limit of what slow Ken Burns can carry.
  //
  // Split into the three beats the paragraph already contained: the dance and
  // the recognition, the aftermath, the coda. 66 / 73 / 28 words, which
  // reassembles to exactly the original 167 — not a rewrite, only a division.
  {
    sceneId: "ep2_s14",
    narration:
      "The merchant stayed for dinner. Ali Baba, who suspected nothing, asked Morgiana to dance for their guest, and she did — and as she turned she looked at the man’s hands, and his boots, and the way he sat facing the door. She had seen him give an order in a courtyard full of jars. The captain of the forty thieves did not leave that house.",
  },
  {
    sceneId: "ep2_s15",
    narration:
      "Afterwards, when it was explained to him, Ali Baba freed Morgiana and made her a daughter of his household, which was the least he could do and, to his credit, he did it immediately. He kept the cave’s secret for the rest of his life. He took from it only what he needed, and never in a hurry, and never more than a donkey could carry without looking like it was carrying anything.",
  },
  {
    sceneId: "ep2_s16",
    narration:
      "It is a strange thing about that story. Everyone remembers the words that opened the hill. Almost nobody remembers the woman who counted to thirty-eight in the dark.",
  },

  // ---------------------------------------------------------------- ep 3 ---
  {
    sceneId: "ep3_s01",
    narration:
      "Aladdin was not a bad boy. He was simply a boy who had never once in his life been asked to be anything in particular, and so he had settled comfortably into being nothing at all. His mother spun cotton. Aladdin sat on walls.",
  },
  {
    sceneId: "ep3_s02",
    narration:
      "Then a stranger came to the market and asked for him by name. He was well dressed and well spoken and he wept when he saw Aladdin, and he said he was his father’s brother, home at last after many years abroad. Aladdin’s father had never mentioned a brother. But the man gave his mother gold for the household, and gold is a very persuasive relative.",
  },
  {
    sceneId: "ep3_s03",
    narration:
      "Two days later the man took Aladdin walking, further than they had ever walked, out past the last houses and into the dry hills. There he built a small fire, and threw a powder into it, and the flame turned a colour that flames do not turn. The ground opened.",
  },
  {
    sceneId: "ep3_s04",
    narration:
      "“Below,” said the man, “there are steps. Then rooms. Then a garden. At the end of the garden, on a ledge, there is an old lamp. Bring it to me and touch nothing else, and everything I have is yours.” He took a ring from his own hand and pushed it onto Aladdin’s finger. “For protection,” he said. Aladdin, who had never been asked to do anything before, went down.",
    segments: [
      { voice: "magician", text: "“Below,”" },
      { voice: "narrator", text: "said the man," },
      { voice: "magician", text: "“there are steps. Then rooms. Then a garden. At the end of the garden, on a ledge, there is an old lamp. Bring it to me and touch nothing else, and everything I have is yours.”" },
      { voice: "narrator", text: "He took a ring from his own hand and pushed it onto Aladdin’s finger." },
      { voice: "magician", text: "“For protection,”" },
      { voice: "narrator", text: "he said. Aladdin, who had never been asked to do anything before, went down." },
    ],
  },
  {
    sceneId: "ep3_s05",
    narration:
      "The rooms were as the man had said. The garden was not. The trees in it bore fruit, and the fruit was stone — clear and green and red and blue, catching a light that came from nowhere he could find. Aladdin, who had spent his life owning nothing, filled every pocket and both sleeves and the front of his shirt. Then he took the lamp from its ledge. It was dented, and it was dull, and it was the least valuable thing in that entire cave.",
  },
  {
    sceneId: "ep3_s06",
    narration:
      "At the top of the steps the man was waiting with his hand out. “The lamp. Give me the lamp.” “Help me up first,” said Aladdin. “I’m carrying too much.” “The lamp first.” And Aladdin — sitting on those steps with his pockets full of jewelled fruit, looking up at a man who would not reach down — understood, all at once and rather late, exactly what kind of uncle he had. He said no. The stone came down.",
    segments: [
      { voice: "narrator", text: "At the top of the steps the man was waiting with his hand out." },
      { voice: "magician", text: "“The lamp. Give me the lamp.”" },
      { voice: "aladdin", text: "“Help me up first,”" },
      { voice: "narrator", text: "said Aladdin." },
      { voice: "aladdin", text: "“I’m carrying too much.”" },
      { voice: "magician", text: "“The lamp first.”" },
      { voice: "narrator", text: "And Aladdin — sitting on those steps with his pockets full of jewelled fruit, looking up at a man who would not reach down — understood, all at once and rather late, exactly what kind of uncle he had. He said no. The stone came down." },
    ],
  },
  {
    sceneId: "ep3_s07",
    narration:
      "He sat in the dark for two days. On the second day, cold and frightened and out of ideas, he wrung his hands the way people do — and rubbed the ring.",
  },
  {
    sceneId: "ep3_s08",
    narration:
      "Something rose out of it and filled the dark, and said: “I serve the ring, and the ring is on your hand. Speak.” Aladdin, whose ambitions had never in his life exceeded the immediate, said the only thing he could think of. “I’d like to go home.”",
    segments: [
      { voice: "narrator", text: "Something rose out of it and filled the dark, and said:" },
      { voice: "ringJinni", text: "“I serve the ring, and the ring is on your hand. Speak.”" },
      { voice: "narrator", text: "Aladdin, whose ambitions had never in his life exceeded the immediate, said the only thing he could think of." },
      { voice: "aladdin", text: "“I’d like to go home.”" },
    ],
  },
  {
    sceneId: "ep3_s09",
    narration:
      "He went home with his pockets full of glass — as he thought — and a battered lamp that wasn’t worth selling. His mother thought she might get a little more for it if it were clean. She sat down with a cloth, and rubbed.",
  },
  {
    sceneId: "ep3_s10",
    narration:
      "The house filled with smoke, and the smoke filled with a shape, and the shape had to stoop. “I serve the lamp,” it said, “and the lamp is in your hand. Speak.” Aladdin’s mother fainted, which was reasonable. Aladdin, who was fifteen and had eaten nothing since the previous morning, said: “Could we have dinner?”",
    segments: [
      { voice: "narrator", text: "The house filled with smoke, and the smoke filled with a shape, and the shape had to stoop." },
      { voice: "lampJinni", text: "“I serve the lamp,”" },
      { voice: "narrator", text: "it said," },
      { voice: "lampJinni", text: "“and the lamp is in your hand. Speak.”" },
      { voice: "narrator", text: "Aladdin’s mother fainted, which was reasonable. Aladdin, who was fifteen and had eaten nothing since the previous morning, said:" },
      { voice: "aladdin", text: "“Could we have dinner?”" },
    ],
  },
  {
    sceneId: "ep3_s11",
    narration:
      "They ate very well that night, off silver. And after that, slowly — because Aladdin turned out to have more sense than his early career on walls suggested — things changed. A house. Then a better house. Then a palace that took one night to build and made the whole city come out to look at it. He asked for the hand of the Sultan’s daughter, and got it, and to everyone’s surprise including his own he made her a good husband, and a good ruler beside her. He was careful. He was generous. He was, for several years, entirely happy. He also grew slightly careless about where he left an old, dented lamp.",
  },
  {
    sceneId: "ep3_s12",
    narration:
      "The magician had not stopped looking. He came back to the city dressed as a pedlar, with a basket of bright new lamps, calling out the silliest offer anyone in that market had ever heard. “New lamps for old! New for old!” Someone in that palace — meaning no harm at all, thinking only that it was a very good deal — traded him a dented one.",
    segments: [
      { voice: "narrator", text: "The magician had not stopped looking. He came back to the city dressed as a pedlar, with a basket of bright new lamps, calling out the silliest offer anyone in that market had ever heard." },
      { voice: "magician", text: "“New lamps for old! New for old!”" },
      { voice: "narrator", text: "Someone in that palace — meaning no harm at all, thinking only that it was a very good deal — traded him a dented one." },
    ],
  },
  {
    sceneId: "ep3_s13",
    narration:
      "Aladdin came home to a level place in the ground and a city with nothing to say. The palace was gone. His wife was gone. The magician had taken all of it across the world in a night, because that is what the lamp could do, and the lamp does not care who is holding it. And Aladdin stood in that empty square and remembered that he was still wearing a ring.",
  },
  // Same split as ep2's S14, and for the same reason: 158 words measured out
  // past a minute on one still. Caught by the hold ceiling before episode 3
  // was generated, so it cost nothing here. 80 / 23 / 55 words, reassembling
  // to exactly the original 158.
  {
    sceneId: "ep3_s14",
    narration:
      "The ring could not bring the palace back \u2014 a lamp outranks a ring, and everything in that world has an order to it. But it could carry a boy across the world in a night. He found his wife. And between them they did what neither could have done alone: she kept the magician talking, and Aladdin waited, and when at last the man\u2019s attention was somewhere else entirely, a dented old lamp changed hands for the final time.",
  },
  {
    sceneId: "ep3_s15",
    narration:
      "The palace came home before morning. The city woke to find the square full again and decided, on the whole, not to ask.",
  },
  {
    sceneId: "ep3_s16",
    narration:
      "Aladdin kept the lamp after that. But he used it less and less as the years went on, and he never again left it lying about. He had learned the thing the magician never did. It was never the lamp that mattered. It was being the sort of person who could be trusted with one.",
  },

  // ---------------------------------------------------------------- ep 4 ---
  // The owner's cut: the same tale told as a CONTEST — the magician against
  // two clever people — with the princess as co-lead. The thesis is stated in
  // the last scene and earned in every one before it: cleverness beats magic.
  {
    sceneId: "ep4_s01",
    narration:
      "In the city where this happened, everyone agreed that Aladdin would come to nothing, and Aladdin agreed with them cheerfully. He had no trade, no prospects, and no plans. What he had was quicker than all three. He had a way of seeing how things worked — locks, arguments, people — and the bazaar was his school.",
  },
  {
    sceneId: "ep4_s02",
    narration:
      "How he came to be in the cave is a story with a liar in it, and we will meet the liar soon enough. What matters is what he found there. A garden where the fruit was living stone, green and red and blue. And past all that treasure, alone on a ledge, one small dented lamp that any sensible thief would have left behind.",
  },
  {
    sceneId: "ep4_s03",
    narration:
      "He rubbed it to read the maker’s mark. What rose from the spout was smoke, and then embers, and then a king made of both, tall as the cave and burning quietly. “Name your wish,” said the Ember King. Aladdin, being Aladdin, asked a question instead. “What do wishes cost?” The jinni smiled for the first time in a thousand years.",
    segments: [
      { voice: "narrator", text: "He rubbed it to read the maker’s mark. What rose from the spout was smoke, and then embers, and then a king made of both, tall as the cave and burning quietly." },
      { voice: "lampJinni", text: "“Name your wish,”" },
      { voice: "narrator", text: "said the Ember King. Aladdin, being Aladdin, asked a question instead." },
      { voice: "aladdin", text: "“What do wishes cost?”" },
      { voice: "narrator", text: "The jinni smiled for the first time in a thousand years." },
    ],
  },
  {
    sceneId: "ep4_s04",
    narration:
      "He wished carefully, the way he did everything. Not for a mountain of gold, which gets a man robbed, but for splendour with a purpose: a palace above the city, raised in one night of falling embers, fine enough to open a certain gate. For Aladdin had seen the Sultan’s daughter at the market, arguing a jeweller down to half his price, and had been lost ever since.",
  },
  {
    sceneId: "ep4_s05",
    narration:
      "The princess received his gift of jewelled fruit the way she received everything: as evidence. She turned the stones in the light, weighed them, and then weighed him. A fraud, she decided, but not a fool — and unlike every suitor before him, he had brought her something interesting. She asked him where the stones were from. He told her the truth. That was the moment she chose him.",
  },
  {
    sceneId: "ep4_s06",
    narration:
      "They were happy, and happiness is careless. The lamp that had built the palace went up onto a high shelf, behind finer things, the way a ladder is put away once a man has climbed it. Aladdin knew better. He simply forgot that knowing better is not the same as doing better. The dust settled on the spout, one quiet day at a time.",
  },
  {
    sceneId: "ep4_s07",
    narration:
      "The liar from the cave had spent those years learning exactly one fact, and it had cost him dearly, so he meant to be repaid. He came up the palace street at dusk with a barrow of bright new lamps, crying a madman’s trade. “New lamps for old! New lamps for old!” A maid on the balcony laughed, and remembered the ugly old thing on the shelf, and thought to do her mistress a kindness.",
    segments: [
      { voice: "narrator", text: "The liar from the cave had spent those years learning exactly one fact, and it had cost him dearly, so he meant to be repaid. He came up the palace street at dusk with a barrow of bright new lamps, crying a madman’s trade." },
      { voice: "magician", text: "“New lamps for old! New lamps for old!”" },
      { voice: "narrator", text: "A maid on the balcony laughed, and remembered the ugly old thing on the shelf, and thought to do her mistress a kindness." },
    ],
  },
  {
    sceneId: "ep4_s08",
    narration:
      "The city woke to an absence. Where the palace had stood there was a hilltop of crushed grass, already springing back, and a silence with a shape in it. The Sultan raged. The court whispered. And Aladdin stood on the empty hill where his whole life had been, and did the thing he had always done best. He looked at how the trick worked.",
  },
  {
    sceneId: "ep4_s09",
    narration:
      "A palace does not vanish. A palace is moved, and moving it takes the lamp, and the lamp was in one man’s hand. So the question was not where the palace had gone. It was where that man would feel safe enough to gloat. Aladdin took the road west with nothing but the ring from the cave and his own two eyes, and he did not hurry, because he was thinking.",
  },
  {
    sceneId: "ep4_s10",
    narration:
      "He found it in a green valley a long way from anywhere, white and wrong against the hills. And in one high window, where anyone else would have hung jewels, someone had set a small lit oil lamp on the sill. To the magician it was a servant’s economy. To Aladdin it was a message in a language two people spoke. She knew the lamp mattered. She was telling him where it was.",
  },
  {
    sceneId: "ep4_s11",
    narration:
      "That night the princess gave the magician what he wanted most, which was her attention. She poured his wine and asked about his travels and laughed at the right moments, and the great sorcerer, who could move palaces, never once looked at the window behind him. Past that window, up the moonlit wall, her husband climbed hand over hand toward the highest roof.",
  },
  {
    sceneId: "ep4_s12",
    narration:
      "The rooftops were silver and the drop below was full of mist, and Aladdin crossed the high ridge of the world with his arms out, one sure step at a time. No wishes now. No jinni to catch him. Just a market boy’s balance and a thief’s quiet feet, and the moon lighting the way like an accomplice.",
  },
  {
    sceneId: "ep4_s13",
    narration:
      "The lamp stood in the treasure room on a velvet stand, honoured at last by the only man who had ever understood it. Aladdin lifted it, and the first smoke was already curling from the spout when the doorway filled with light and the magician’s long shadow. “Whose hand holds the lamp?” asked the Ember King. “Mine,” said Aladdin. And that was the whole of the battle.",
    segments: [
      { voice: "narrator", text: "The lamp stood in the treasure room on a velvet stand, honoured at last by the only man who had ever understood it. Aladdin lifted it, and the first smoke was already curling from the spout when the doorway filled with light and the magician’s long shadow." },
      { voice: "lampJinni", text: "“Whose hand holds the lamp?”" },
      { voice: "narrator", text: "asked the Ember King." },
      { voice: "aladdin", text: "“Mine,”" },
      { voice: "narrator", text: "said Aladdin. And that was the whole of the battle." },
    ],
  },
  {
    sceneId: "ep4_s14",
    narration:
      "The palace came home the way it had left, in one night, and the city threw a festival that lasted three. On the highest terrace two clever people stood side by side and watched the embers rise from the fires below like stars going back where they belonged. The magician had owned every power in the world except the ones that matter. Patience. Attention. A partner. Cleverness beats magic, every single time it is allowed to finish.",
  },
];

/** Narration for a scene, or null where none is written yet. */
export function narrationFor(sceneId: string): string | null {
  return SEASON_SCRIPT.find((l) => l.sceneId === sceneId)?.narration ?? null;
}

/**
 * Rough spoken length in seconds.
 *
 * ~140 words per minute is a measured narration pace for this register — slower
 * than conversation, which is what a story read aloud wants. This is a PLANNING
 * figure only: the renderer overrides it with the real audio length, because a
 * timeline built on an estimate drifts further out of sync with every scene.
 */
export const NARRATION_WPM = 140;

export function estimateSeconds(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / NARRATION_WPM) * 60);
}
