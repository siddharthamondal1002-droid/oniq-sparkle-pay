// faith-scripture — proxies free scripture APIs into a normalized shape.
// Input: { religion, book?, chapter? } → { title, verses: [{ ref, text, translation? }] }
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Verse = { ref: string; text: string; translation?: string };
type Out = { title: string; verses: Verse[]; note?: string };

const cache = new Map<string, { at: number; data: Out }>();
const TTL = 60 * 60 * 1000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function gita(chapter: number): Promise<Out> {
  const ch = Math.max(1, Math.min(18, chapter || 1));
  // vedicscriptures returns per-verse; fetch up to first 15 concurrently
  const verseCounts: Record<number, number> = {1:47,2:72,3:43,4:42,5:29,6:47,7:30,8:28,9:34,10:42,11:55,12:20,13:35,14:27,15:20,16:24,17:28,18:78};
  const total = verseCounts[ch] ?? 20;
  const n = Math.min(total, 20);
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => i + 1).map(async (v) => {
      try {
        const r = await fetch(`https://vedicscriptures.github.io/slok/${ch}/${v}/`);
        if (!r.ok) return null;
        const d = await r.json();
        const text = d?.slok || "";
        const translation = d?.tej?.et || d?.siva?.et || d?.purohit?.et || d?.gambir?.et || "";
        return { ref: `${ch}.${v}`, text, translation } as Verse;
      } catch { return null; }
    }),
  );
  return { title: `Bhagavad Gita — Chapter ${ch}`, verses: results.filter(Boolean) as Verse[], note: `showing ${n} of ${total}` };
}

async function quran(surah: number): Promise<Out> {
  const s = Math.max(1, Math.min(114, surah || 1));
  const [ar, en] = await Promise.all([
    fetch(`https://api.alquran.cloud/v1/surah/${s}`).then((r) => r.json()),
    fetch(`https://api.alquran.cloud/v1/surah/${s}/en.asad`).then((r) => r.json()),
  ]);
  const arAyahs = ar?.data?.ayahs ?? [];
  const enAyahs = en?.data?.ayahs ?? [];
  const name = ar?.data?.englishName || `Surah ${s}`;
  const verses: Verse[] = arAyahs.slice(0, 30).map((a: { numberInSurah: number; text: string }, i: number) => ({
    ref: `${s}:${a.numberInSurah}`,
    text: a.text,
    translation: enAyahs[i]?.text ?? "",
  }));
  return { title: `Quran — ${name}`, verses, note: verses.length < arAyahs.length ? `showing ${verses.length} of ${arAyahs.length}` : undefined };
}

async function bible(book: string, chapter: number): Promise<Out> {
  const b = (book || "john").toLowerCase();
  const ch = chapter || 1;
  const r = await fetch(`https://bible-api.com/${encodeURIComponent(b)}+${ch}`);
  const d = await r.json();
  const verses: Verse[] = (d?.verses ?? []).map((v: { chapter: number; verse: number; text: string }) => ({
    ref: `${v.chapter}:${v.verse}`,
    text: (v.text || "").trim(),
  }));
  return { title: d?.reference || `${book} ${ch}`, verses };
}

async function torah(book: string, chapter: number): Promise<Out> {
  const b = book || "Genesis";
  const ch = chapter || 1;
  const r = await fetch(`https://www.sefaria.org/api/texts/${encodeURIComponent(b)}.${ch}?context=0`);
  const d = await r.json();
  const he: string[] = Array.isArray(d?.he) ? d.he : [];
  const en: string[] = Array.isArray(d?.text) ? d.text : [];
  const strip = (s: string) => (s || "").replace(/<[^>]+>/g, "");
  const n = Math.min(Math.max(he.length, en.length), 40);
  const verses: Verse[] = Array.from({ length: n }, (_, i) => ({
    ref: `${ch}:${i + 1}`,
    text: strip(he[i] || ""),
    translation: strip(en[i] || ""),
  }));
  return { title: `${b} ${ch}`, verses };
}

const SIKH_CURATED: Verse[] = [
  { ref: "Mool Mantar", text: "ੴ ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ ਨਿਰਭਉ ਨਿਰਵੈਰੁ ਅਕਾਲ ਮੂਰਤਿ ਅਜੂਨੀ ਸੈਭੰ ਗੁਰ ਪ੍ਰਸਾਦਿ ॥", translation: "One Universal Creator God. The Name Is Truth. Creative Being Personified. Fearless. No Hatred. Timeless Form. Beyond Birth. Self-Existent. By Guru's Grace." },
  { ref: "Japji Sahib 1", text: "ਸੋਚੈ ਸੋਚਿ ਨ ਹੋਵਈ ਜੇ ਸੋਚੀ ਲਖ ਵਾਰ ॥", translation: "By thinking, He cannot be reduced to thought, even by thinking hundreds of thousands of times." },
  { ref: "Japji Sahib 2", text: "ਹੁਕਮੀ ਹੋਵਨਿ ਆਕਾਰ ਹੁਕਮੁ ਨ ਕਹਿਆ ਜਾਈ ॥", translation: "By His Command, bodies are created; His Command cannot be described." },
];

const DHAMMAPADA_SAMPLE: Verse[] = [
  { ref: "1.1", text: "Mind precedes all mental states. Mind is their chief; they are all mind-wrought. If with an impure mind a person speaks or acts, suffering follows him like the wheel that follows the foot of the ox." },
  { ref: "1.2", text: "Mind precedes all mental states. Mind is their chief; they are all mind-wrought. If with a pure mind a person speaks or acts, happiness follows him like his never-departing shadow." },
  { ref: "1.5", text: "Hatred is never appeased by hatred in this world. By non-hatred alone is hatred appeased. This is a law eternal." },
  { ref: "5.50", text: "Let none find fault with others; let none see the omissions and commissions of others. But let one see one's own acts, done and undone." },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const religion = String(body?.religion || "").toLowerCase();
    const book = body?.book ? String(body.book) : undefined;
    const chapter = body?.chapter ? Number(body.chapter) : undefined;
    const key = `${religion}:${book || ""}:${chapter || ""}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < TTL) return json(200, hit.data);

    let out: Out;
    switch (religion) {
      case "hindu": out = await gita(chapter ?? 1); break;
      case "islam": out = await quran(chapter ?? 1); break;
      case "christian": out = await bible(book ?? "john", chapter ?? 3); break;
      case "jewish": out = await torah(book ?? "Genesis", chapter ?? 1); break;
      case "sikh": out = { title: "Gurbani — Selected Passages", verses: SIKH_CURATED, note: "curated selection" }; break;
      case "buddhist": out = { title: "Dhammapada — Selected Verses", verses: DHAMMAPADA_SAMPLE, note: "curated selection" }; break;
      default: return json(400, { error: "unknown religion" });
    }
    cache.set(key, { at: now, data: out });
    return json(200, out);
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
