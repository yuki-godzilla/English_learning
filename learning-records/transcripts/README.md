# Raw Conversation Transcripts

This directory stores session-by-session raw conversation evidence for later English re-evaluation.
`coverage.json` lists every Journal session, whether a source-backed transcript is complete, partial, or unavailable, and why. A partial file is not a complete voice-session record.

## Purpose

- Preserve the original learner output well enough to re-score earlier sessions with future rubrics.
- Separate raw evidence from the polished Journal and from derived evaluation data.
- Make recurring patterns such as articles, prepositions, restarts, self-repair, lexical retrieval, and interaction repair auditable later.

## File naming

`YYYY-MM-DD-session-NN.jsonl`

Use the same date and session number as `journal.md` / `progress.json`.

## Required JSONL records

The first line is session metadata.

```json
{"type":"session_meta","session_number":17,"session_id":"2026-09-27-01","date":"2026-09-27","timezone":"Asia/Tokyo","capture":"realtime_segment_log","completeness":"available voice segments only; typed follow-ups not included","redaction_reviewed":true}
```

Then preserve each turn in original order.

```json
{"type":"turn","index":1,"speaker":"yuki","source":"voice_asr","timestamp":null,"text":"..."}
{"type":"turn","index":2,"speaker":"chappy","source":"assistant","timestamp":null,"text":"..."}
```

Allowed `source` examples: `voice_asr`, `typed`, `assistant`, `read_aloud_asr`.

If trustworthy timing or ASR confidence is available, it may be added as optional fields. Do not invent either.
Realtime `transcript_segment` items are kept in source order as numbered records. Consecutive records from one speaker can be pieces of one spoken turn; do not infer pause length or an exact conversational turn boundary from them.

## Fidelity rules

- Do not correct grammar, articles, prepositions, word choice, fillers, restarts, repetitions, or incomplete sentences in the raw transcript.
- Do not replace Yuki's original wording with a polished correction or Journal summary.
- Keep self-repairs as they occurred when the source preserves them.
- Do not reconstruct missing historical turns from summaries.
- A repeated, overlapping `transcript_delta` handoff is not an ordered raw stream unless its original turns can be established without guessing. Record that limitation in `coverage.json` instead of manufacturing a transcript.
- Assistant-supplied model sentences must remain distinguishable from Yuki's spontaneous production.
- A raw transcript can support grammar, lexical, discourse, and interaction re-analysis, but transcript text alone does not prove pronunciation, pause duration, or speaking speed.

## Public-repository redaction

This repository is public. Before commit, redact only information that must not be published, while preserving the surrounding language evidence.

Examples:

- `[REDACTED_EMAIL]`
- `[REDACTED_PERSON]`
- `[REDACTED_WORK_INFO]`
- `[REDACTED_SECRET]`

Redaction is not grammar correction. Do not redact ordinary mistakes or awkward English.

Never commit credentials, tokens, cookies, private internal product/project names, confidential internal processes, or other secrets.
Redact personal health or other sensitive personal context before public commit. A segment replaced with a placeholder remains in the chronology but is not usable as language evidence. `redaction_reviewed: true` means the publishable file was inspected after redaction; the automated checker does not replace that review.

Run `npm run transcripts:check` before commit. It checks JSONL structure, Journal/coverage correspondence, chronology, and known private patterns. It cannot recognize every confidential detail.

## What is not stored here

- Audio recordings
- Pronunciation-analysis intermediate files
- Session Package temporary files
- Generated reports

Audio and analysis intermediates remain outside Git according to `AGENTS.md`.

## Evaluation priority

When a later audit is requested:

1. raw transcript, when available;
2. directly measured audio evidence for pronunciation, when separately available and permitted;
3. `progress.json` preserved evidence;
4. `journal.md` summaries and excerpts.

A later audit must state when the raw transcript is missing or materially redacted.
