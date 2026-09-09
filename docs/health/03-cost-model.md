# ONIQ Health — cost model

USD list prices as read on 2026-09-08 (see `01-research.md` for the source label
on each price). Rupee figures use an **assumed** ₹88 per USD; change one number
in the "Rates" block of the calculation below and everything follows. Nothing
here is a quote, a forecast or a budget — it is arithmetic over stated
assumptions so the owner can change the assumptions.

## Assumptions (labelled, so they can be disagreed with one at a time)

| #   | Assumption                                                                  | Value                                                                                           |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A1  | Users who open Health in a month ("active")                                 | 30% of registered users                                                                         |
| A2  | Documents uploaded per active user per month                                | 2, average 1.5 MB each (a phone photo of a report, or a PDF)                                    |
| A3  | Manual records (vitals, medicines, allergies) per active user per month     | 15                                                                                              |
| A4  | Health chat turns per active user per month                                 | 4, each ≈ 6,000 input tokens (records context + question) and 600 output tokens                 |
| A5  | Document understanding per document                                         | ≈ 2,000 input tokens (one image or PDF page set) and 400 output tokens                          |
| A6  | FHIR store traffic per active user per month (V2)                           | 90 standard requests, 20 complex (searches); 30 resources × 2 KB structured; documents as blobs |
| A7  | Steady state after 12 months of accumulation                                | storage = 12 × monthly additions                                                                |
| A8  | Agent Search for Healthcare (V3 only)                                       | 4 queries per active user per month                                                             |
| A9  | Google consent enforcement (only if records are shared from the FHIR store) | 1 active patient consent per active user                                                        |
| A10 | MedGemma (evaluation)                                                       | 1 × `a2-highgpu-1g` on demand, 24 × 7                                                           |
| A11 | Health Connect, ABDM API calls                                              | $0 in Google fees; engineering and certification costs are outside this model                   |
| A12 | Supabase Storage and Postgres for Phase 1                                   | billed by Lovable Cloud, not Google — outside this model                                        |
| A13 | Exchange rate                                                               | ₹88 = $1                                                                                        |

## Rates used

| Rate                                          | Value                                                 | Source label |
| --------------------------------------------- | ----------------------------------------------------- | ------------ |
| Gemini 3.1 Flash-Lite                         | $0.25 in / $1.50 out per 1M tokens                    | PAGE         |
| Gemini 3.6 Flash (introductory to 2026-12-31) | $0.75 / $3.75; standard from 2027-01-01 $1.50 / $7.50 | PAGE         |
| Healthcare NLP                                | $0.10 per 1,000 characters after 2,500 free records   | PAGE         |
| FHIR standard / complex requests              | $0.39 / $0.69 per 100,000 after 25,000 free each      | PAGE         |
| Healthcare structured storage                 | $0.24 per GiB-month (1–1,024 GiB), first GiB free     | PAGE         |
| Healthcare blob / Cloud Storage Mumbai        | $0.02 per GiB-month                                   | PAGE         |
| Pub/Sub notifications                         | $0.29 per million after 100,000                       | PAGE         |
| Agent Search for Healthcare                   | $20 per 1,000 queries                                 | PAGE         |
| FHIR consent enforcement                      | $0.05 per active consent per month                    | PAGE         |
| `a2-highgpu-1g`                               | $4.2244949 per hour                                   | PAGE         |

## Per-active-user unit costs (per month)

| Line                                                                            | Working                                   | USD         |
| ------------------------------------------------------------------------------- | ----------------------------------------- | ----------- |
| Chat on Flash-Lite (A4)                                                         | 24,000 in × $0.25/M + 2,400 out × $1.50/M | $0.0096     |
| Document understanding on Flash-Lite (A2, A5)                                   | 4,000 in × $0.25/M + 800 out × $1.50/M    | $0.0022     |
| **AI subtotal, Flash-Lite**                                                     |                                           | **$0.0118** |
| Same two lines on Gemini 3.6 Flash (introductory)                               | 28,000 in × $0.75/M + 3,200 out × $3.75/M | $0.033      |
| Healthcare NLP instead of Gemini for extraction (A2: 2 docs ≈ 3,000 chars each) | 6 text records × $0.10                    | $0.60       |
| Agent Search for Healthcare (A8)                                                | 4 × $20/1,000                             | $0.08       |
| Google consent enforcement (A9)                                                 | 1 × $0.05                                 | $0.05       |

## The four scales

Active users (A1): **300 / 3,000 / 30,000 / 300,000**.

### V1 — Phases 1–3: Postgres + Supabase Storage + Gemini Flash-Lite, no Healthcare API

| Users                                          | 1,000           | 10,000           | 100,000            | 1,000,000             |
| ---------------------------------------------- | --------------- | ---------------- | ------------------ | --------------------- |
| AI (Flash-Lite)                                | $3.5            | $35              | $354               | $3,540                |
| AI if on Gemini 3.6 Flash introductory instead | $9.9            | $99              | $990               | $9,900                |
| Google total, V1                               | **$3.5 (₹310)** | **$35 (₹3,100)** | **$354 (₹31,200)** | **$3,540 (₹311,500)** |

**Measured on production, 2026-09-09 (Phase 3 live, `07`):** one Health AI
answer on `gemini-3.1-flash-lite` through Vertex is about **840 input tokens**
(the system instruction and the closed response schema dominate; the person's
record is a few dozen) and **80–210 output tokens**, receipted at
**$0.00033–0.00053** at the code's list price row. Six calls: 5,056 in / 625
out / $0.0022. At the model's A3 (10 answers per active user per month) that is
$0.003–0.005 per active user — under the $0.0117 the V1 line assumed, so the V1
figures above are a ceiling, not a floor. The figure is read from the receipts
(`scripts/health-ai-cost-report.sql`), not estimated.

A document read (Phase 3b, `05 §18`) is one receipt with up to two calls on
it: a PDF's own text layer costs nothing to read and then one extraction call
(~840 input tokens plus the text); a photo or scan adds a transcription first,
which Vertex bills at about 258 input tokens per image or page plus the
transcribed text as output. Measured on the live test in `07`,
"2026-09-09 (later)".

Supabase Storage for documents (A2, A7 — steady state 36 MB per active user): 10.5 GiB / 105 GiB / 1.05 TiB / 10.5 TiB, billed by Lovable Cloud at its own rates (outside this model).

### V2 — adds a FHIR store mirror in `asia-south1` and Pub/Sub notifications

| Users                                                            | 1,000           | 10,000             | 100,000            | 1,000,000             |
| ---------------------------------------------------------------- | --------------- | ------------------ | ------------------ | --------------------- |
| Standard requests (90/active, −25,000 free)                      | $0.01           | $0.96              | $10.43             | $105.20               |
| Complex requests (20/active, −25,000 free)                       | $0              | $0.24              | $3.97              | $41.23                |
| Structured storage (60 KB/active/month × 12, −1 GiB free)        | $0 (< 1 GiB)    | $0.24              | $4.59              | $48.05                |
| Blob storage for documents in Google (36 MB/active, −1 GiB free) | $0.18           | $1.99              | $20.10             | $201                  |
| Notifications (30/active, −100,000 free)                         | $0              | $0                 | $0.23              | $2.58                 |
| **V2 increment**                                                 | **$0.19**       | **$3.43**          | **$39.32**         | **$398**              |
| **Google total, V2**                                             | **$3.7 (₹330)** | **$38.8 (₹3,400)** | **$393 (₹34,600)** | **$3,938 (₹346,500)** |

### V3 — adds Agent Search for Healthcare and Google consent enforcement (ABDM sharing, imaging)

| Users                                                                                                                    | 1,000              | 10,000             | 100,000               | 1,000,000             |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------------------ | --------------------- | --------------------- |
| Agent Search for Healthcare (4/active)                                                                                   | $24                | $240               | $2,400                | $24,000               |
| Consent enforcement (1/active)                                                                                           | $15                | $150               | $1,500                | $15,000               |
| De-identification for analytics (assume 10% of structured bytes/month, 10 infoTypes; free tier absorbs the small scales) | $0                 | $0                 | ≈ $1                  | ≈ $12                 |
| BigQuery (scans stay under the free 1 TiB until 1M; storage under 10 GiB free until 100K)                                | $0                 | $0                 | ≈ $1                  | ≈ $12                 |
| **V3 increment**                                                                                                         | **$39**            | **$390**           | **$3,902**            | **$39,024**           |
| **Google total, V3**                                                                                                     | **$42.7 (₹3,800)** | **$429 (₹37,700)** | **$4,295 (₹378,000)** | **$42,962 (₹3.78 M)** |

### Fixed options, independent of user count

| Option                                                                                       | Monthly                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MedGemma 27B evaluation endpoint, 24 × 7 on `a2-highgpu-1g` (730 h)                          | $3,084 (₹271,400); $2,467 with a 3-year plan; **≈ $34 for an 8-hour evaluation run then deleted**                                                                |
| MedGemma 4B on `g2-standard-12` (L4), 24 × 7                                                 | $840 (₹74,000)                                                                                                                                                   |
| Healthcare NLP for extraction instead of Gemini (6 text records per active user, 2,500 free) | +$0 / +$1,550 / +$17,750 / +$99,750 for the first million records plus 800,000 records at the unprinted high-volume rate — **this is why it is not recommended** |

## What the numbers say

1. **V1 is cheap.** At 100,000 users the Google bill is a few hundred dollars a month, dominated by Gemini, and every rupee of it is metered per request with a per-user cap the code already knows how to enforce.
2. **The FHIR store is not the expensive part.** A mirror in Mumbai adds about ten percent to V1. The expensive lines are the two hospital-grade products: Agent Search for Healthcare ($20 per 1,000 queries) and per-consent enforcement ($0.05 per consent per month). Neither is needed for a person reading their own records; both are needed only when ONIQ becomes a sharing hub.
3. **Healthcare NLP is the wrong extractor at consumer volumes.** Gemini Flash-Lite extracts from the same document for about 1/270th of the price.
4. **MedGemma is a fixed cost.** Rent it by the hour for evaluation ($34 for an eight-hour run); do not run it as a service until an evaluation shows it beating Gemini on ONIQ's own suite.
5. **The model choice moves the AI line by 3× to 6×.** Flash-Lite is the right default; the heavier Flash tiers are an owner decision with the introductory-pricing cliff on 2027-01-01 in view.

## How to recompute

Every table above is `unit cost × active users` with the free tiers subtracted once per billing account. The active share (A1) is the single most sensitive assumption: at 60% active every V1 figure doubles.
