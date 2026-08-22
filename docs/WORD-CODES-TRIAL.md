# Read-Aloud Transcription Trial — Protocol

> Applies to the current **UK 5-word offline sentence** ("Orderly lark sweeps
> full pedestal") — see `docs/WORD-CODES.md`. The format specifics below predate
> that; the method (compare sentence vs NATO letters vs lat/long vs Plus Code over
> a degraded line, measure silent-error rate) stands.

**Project:** whereareyou (emergency location handover)
**Question under test:** Does encoding a location as a memorable grammatical
sentence let a person read it back over a bad phone line *more accurately and
more safely* than the alternatives?

This is the make-or-break test for the sentence format. The claim — that
word-sentences fail more safely than letters or coordinates — cannot be settled
in code. It needs real people, real voices, and a real (degraded) line. This
document is a runnable plan: someone who has never run a study should be able to
execute it end to end in an afternoon.

---

## 1. Hypothesis and the decision it informs

**Hypothesis.** A location read aloud as a sentence code (e.g. *"The silver
otter guards the sleepy lighthouse by the harbour"*) is transcribed by a
dispatcher with **fewer errors** and **fewer re-asks** than the same location
delivered as:

- **(a)** the current 8-character code read in NATO phonetic —
  *"X-ray Seven Kilo Nine, Papa Two Quebec Four"*
- **(b)** raw latitude / longitude — *"fifty-one point five zero seven two,
  minus zero point one two seven six"*
- **(c)** a Plus Code — *"9C3XGV2H+9M"* read aloud

And, critically, that the sentence's checksum drives its **silent-error rate**
(transcribed to a *valid but wrong* location, unflagged) to approximately zero,
where lat/long and Plus Codes — which carry no error detection — do not.

**Two things decide this, and they are not the same thing:**

1. **Safety** — does a mishearing get *caught*, or does it resolve confidently
   to the wrong place? A wrong pin with no warning is the failure this whole
   project exists to prevent.
2. **Accuracy** — does the message get through first time, or does it take
   repeats?

**Decision criteria.**

| Outcome | What we saw | Action |
|---|---|---|
| **SHIP the sentence** | Zero silent errors on sentences, **and** sentence first-pass success ≥ the NATO code, **and** both clearly beat lat/long and Plus Code | Continue building the sentence format |
| **STOP** | Sentences produce silent errors (checksum not actually protecting callers), **or** sentence first-pass success is no better than the NATO code | Do not ship. The complexity buys nothing, or worse, it is unsafe |
| **ITERATE** | Promising but noisy — sentence beats coordinates but is level with NATO, or one or two silent errors need explaining | Fix the specific failure, re-run the affected condition |

The safety gate is absolute and comes first: **any** silent error on a sentence
is a red flag to investigate before shipping, because the sentence's entire
advantage over the NATO code is supposed to be that it is at least as safe while
being easier to say. If it is not safer, there is no case for the added words.

---

## 2. Conditions to compare

Four formats, one shared set of underlying locations, so any difference is the
format and not the place.

| # | Condition | What the reader says |
|---|---|---|
| S | **Sentence** | The generated sentence, read as an ordinary sentence |
| N | **NATO code** | The 8-char code in phonetic — *"X-ray Seven Kilo Nine…"* |
| L | **Lat/long** | Decimal degrees to 5 dp, read digit by digit |
| P | **Plus Code** | The Open Location Code, read character by character |

**Counterbalancing.** Order effects are real — readers warm up, dispatchers
tire. Rotate the order of the four formats across participants using a 4×4 Latin
square so each format appears in each position (1st–4th) equally often:

| Participant (mod 4) | 1st | 2nd | 3rd | 4th |
|---|---|---|---|---|
| 0 | S | N | L | P |
| 1 | N | P | S | L |
| 2 | L | S | P | N |
| 3 | P | L | N | S |

Each participant does **two reads per format** (8 reads total), using different
locations each time so nothing is memorised. Rotate which location goes to which
format across participants (shift the assignment by one each time) so every
location is eventually spoken in every format. See §4 for the location pool.

---

## 3. Realistic degradation (cheap and repeatable)

The trial is worthless on a clean line — a clean line is not where this fails.
Reproduce a bad 999 call with kit you already own. Pick **one** fixed setup and
keep it identical for every trial so the comparison is fair.

**Recommended baseline (do this):**

1. **Reader and dispatcher in separate rooms**, on a real phone call between two
   handsets — not sitting together. This alone supplies genuine line loss.
2. **Reader on speakerphone, held at arm's length** (~1 m from the mouth), to
   mimic a phone lying on the ground or gripped in a panic.
3. **Background noise at the reader's end.** Play a looped street/café/traffic
   recording from a laptop at a fixed volume — loud enough to talk over, not
   shout over. Mark the volume level and do not change it.
4. **Mild time pressure on the reader.** Tell them: *"Read it once, at the pace
   you'd use if you were actually scared. Don't spell it out slowly."* Do not
   let them rehearse the sentence or the code silently first.

**Cheaper still (if two rooms aren't available):** one laptop plays the noise
loop next to the reader; the reader speaks into a low-bitrate voice call
(any consumer VOIP app, mic gain low) to the dispatcher's headphones in the same
room, facing away. Less realistic, still degraded.

**Keep it constant.** Whatever you choose, freeze it: same rooms, same distance,
same noise track, same volume, same instruction. The degradation is a fixed
condition of the experiment, not a variable.

---

## 4. Participants

- **How many:** aim for **15–20 readers**. That yields ~30–40 reads per format
  (2 reads × participants), enough for a first, honest signal — not a
  publishable result, but enough to see a real gap if one exists.
- **Recruiting:** none special. Colleagues, friends, family. No training, no
  screening. A frightened member of the public is untrained, so untrained
  readers are the right population.
- **Accents:** deliberately mix them. The project's real-world failure mode is a
  **regional accent meeting a bad line** — that is exactly what confuses both a
  human dispatcher and a speech parser. If you can get a spread of regional and
  non-native English accents, do. Note each reader's rough accent on the sheet;
  it is a dimension to look at later, not to screen on.
- **Dispatchers:** 1–2 people play dispatcher for the whole trial (consistency
  matters more than variety here). They transcribe and type into the tool; they
  have *never* seen the target locations.

---

## 5. Procedure

Per trial (repeat 8 times per reader):

1. **Set up the read.** The facilitator shows the *reader* the code/sentence for
   the assigned location and format — on the whereareyou share screen where
   possible, or on a printed card. The reader does not see the map or the answer.
2. **Start the clock** when the reader begins speaking.
3. **Read aloud, once.** Reader speaks the sentence / code / coordinate over the
   degraded line at their scared-but-not-shouting pace.
4. **Dispatcher transcribes.** The dispatcher types what they *heard* into the
   dispatcher console exactly as they would on a live call — and may **re-ask**
   ("say the third word again?") just as they would in real life. Record every
   re-ask.
5. **Resolve.** The dispatcher submits. The tool either resolves to a pin,
   flags an error (bad checksum / unreadable / wrong length), or — for lat/long
   and Plus Codes — resolves to *whatever coordinate the typed text decodes to*,
   right or wrong.
6. **Stop the clock** when the dispatcher has a resolution they are willing to
   commit to (after any re-asks). This is *time-to-correct* if it lands right,
   or the point of failure if it does not.
7. **Record the outcome** against the true location (see §6/§7). Capture the
   **verbatim transcription** every time — it is the evidence, and it is where
   the interesting failures live.

Do not coach. Do not let the reader retry off the record. Do not tell the reader
whether it resolved — that would change how they read the next one.

---

## 6. Metrics

Compute each per format.

- **First-pass success rate.** Share of trials where the dispatcher's *first*
  submission resolves to the correct location with no re-ask. The headline
  usability number.
- **Re-ask rate.** Share of trials needing at least one "say that again". Cheap
  proxy for how much a format costs a busy control room.
- **Time-to-correct.** Median seconds from start-of-read to a committed correct
  resolution, re-asks included. Report the median, not the mean — a couple of
  disasters shouldn't dominate.
- **Silent-error rate — the one that matters.** Share of trials where the final
  transcription was **accepted as valid** *and* pinned a **wrong** location
  *with no error flag*. This is the dangerous failure: a confident pin in the
  wrong place.
  - **Sentence and NATO code** carry a checksum, so a single mistranscription is
    caught and shown as an error → a re-ask, not a silent wrong pin. Expect
    ≈ 0 here. Any non-zero result is a finding.
  - **Lat/long and Plus Code** have *no* error detection — any plausible string
    of digits decodes to *some* real coordinate. Expect the silent-error rate to
    be visibly non-zero. Measuring that gap is the point of the whole trial.

**Defining "correct".** For all four formats: the resolved pin is within a small
tolerance of the intended point (use **≤ 25 m**, or exact-match for the code and
sentence formats since those are discrete). Anything accepted-as-valid but
outside tolerance is a **silent error**. Anything the tool flags is a caught
error → counts against first-pass success but *not* as a silent error.

Each trial ends in exactly one of three states:

- **Correct** — resolved, right place.
- **Silent-wrong** — resolved, wrong place, no warning. (The failure we fear.)
- **Failed** — tool flagged it / dispatcher gave up. Safe failure: at least
  everyone knows it didn't work.

---

## 7. Scoring sheet

One row per trial. A spreadsheet is fine; these are the columns.

| Field | Example | Notes |
|---|---|---|
| Trial ID | `P07-3` | participant-read number |
| Participant | `P07` | |
| Reader accent | `Glaswegian` | note, don't screen |
| Format | `S / N / L / P` | |
| Order position | `3` | 1st–4th, for the Latin square |
| Location ID | `LOC-05` | from the fixed pool |
| Re-asks | `1` | count |
| Resolved? | `Y / N` | did the tool accept it |
| Error flagged? | `Y / N` | did the tool reject before success |
| **Outcome** | `Correct / Silent-wrong / Failed` | the one classification that matters |
| Time-to-correct | `00:41` | mm:ss; blank if Failed/Silent-wrong |
| Verbatim transcription | `The silver otter guards the sleepy lighthouse by the harbour` | exactly what the dispatcher typed |
| Notes | `misheard "otter" as "otter"→"odder"` | anything odd |

Blank scoring row to copy:

```
Trial ID | Participant | Accent | Format | Order | Location | Re-asks | Resolved? | Flagged? | Outcome | Time | Transcription | Notes
         |             |        |        |       |          |         |           |          |         |      |               |
```

---

## 8. Analysis

**Per-format summary table** — fill this in and it tells the story:

| Format | Trials | First-pass % | Re-ask % | Median time | **Silent-wrong (n)** | **Silent-error %** |
|---|---|---|---|---|---|---|
| Sentence | | | | | | |
| NATO code | | | | | | |
| Lat/long | | | | | | |
| Plus Code | | | | | | |

**How to read it.**

1. **Look at the silent-error column first.** If Sentence and NATO are 0 and
   Lat/long and Plus Code are not, you have demonstrated the safety thesis:
   error-detecting formats fail *safely*; coordinate formats fail *silently*.
   That is the single most important line in the whole trial.
2. **Then compare Sentence vs NATO on first-pass and re-asks.** This is the
   sentence's reason to exist. If it matches or beats the NATO code while staying
   at zero silent errors, that supports **ship**. If it is worse, that supports
   **stop** — you'd be adding words for nothing.
3. **Lat/long and Plus Code are the floor.** They are there to show how much
   worse an unprotected, character-dense format is over a bad line.

**How much confidence to claim.** With ~30–40 reads per format, the numbers are
*directional*, not precise. Two honest guidance points:

- A single percentage-point difference is noise; a 15–20 point gap in first-pass
  success is a real signal. Do not over-read small gaps.
- **Zero is not "proven zero".** Observing no silent errors in ~40 sentence
  trials does not prove the rate is zero — the 95% upper bound is still roughly
  **9%** (a Wilson interval on 0/40). The honest claim is: "no silent errors
  observed in 40 trials, consistent with the checksum guarantee, versus *N*
  observed for coordinates." Let the *contrast* carry the argument, not the
  absolute.
- If you want a slightly firmer number on the sentence's safety, run *more*
  sentence trials specifically (the cheap ones), since that is the load-bearing
  claim.

**Caveats to state plainly in any writeup:**

- **Small N.** 15–20 readers is a first signal, not a validation. It can kill a
  bad idea confidently and only *support* a good one.
- **Simulated line.** A noise loop and a speakerphone approximate a bad 999 call;
  they are not one. Real calls add panic, wind, hyperventilation, and codec
  quirks we did not reproduce.
- **Self-selected readers.** Volunteers are calmer and more cooperative than a
  real caller in an emergency. The instruction to read "scared and rushed" only
  goes so far.
- **One or two dispatchers.** Results partly reflect *their* ear. A different
  dispatcher pool might shift the absolute numbers (though the format *ranking*
  should be more robust).
- **Accent coverage is opportunistic**, not representative. Treat any
  accent-specific pattern as a lead to chase, not a conclusion.

The trial is designed to answer one question well — *does the sentence fail more
safely than the alternatives, without costing accuracy?* — and to be honest
about everything it cannot answer.
