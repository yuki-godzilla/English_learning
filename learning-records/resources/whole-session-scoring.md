# Whole-session scoring protocol (effective from Session 16)

This protocol supplements the L1–L5 rubric in `progress.json`. It applies after every completed conversation, not during the natural exchange. Earlier sessions are not silently rescored. All ratings are learning observations, not official examination results.

## Decision sequence for every dimension

0. Use the committed raw transcript in `learning-records/transcripts/` as the preferred evidence source when it exists. Preserve turn order and distinguish Yuki's spontaneous production, typed input, read-aloud text, Chappy-supplied wording, and ASR uncertainty. Do not silently grammar-correct the raw transcript before scoring. If no raw transcript exists, use the best preserved Journal/progress evidence and state that limitation.
1. Identify what the learner actually did, using a brief utterance or concrete behavior. Separate independent production from Chappy-supplied wording and from self-report.
2. Identify evidence source and task conditions: audio checked, transcript only, read-aloud, spontaneous conversation, prepared versus unprepared, topic familiarity, and opportunity to demonstrate the skill.
3. Apply the dimension's existing L1–L5 descriptor, then `emerging / established / strong` only if the evidence supports that stage. Never copy the previous value simply because there is no new evidence; use N/A for an unmeasured dimension.
4. Compare with the previous session and, when available, the most recent **comparable** task. Record `improved`, `stable`, `mixed`, `declined`, or `not_comparable`, with a short reason and confidence. A level can remain unchanged while an observable behavior improves.
5. Record one `metric_evidence` object per dimension in `progress.json`: `basis`, `observed`, `comparison`, `reason`, and `confidence` (`high`, `medium`, or `low`). For N/A, explain what was missing. A self-report is useful context, but cannot alone establish a level change.

## Evidence to look for

| Dimension | Observable evidence | Boundary |
|---|---|---|
| Task achievement | Whether the intended point, reason, example or trade-off, and conclusion were conveyed without being supplied | Do not reward topic complexity alone or penalize a brief answer to a brief task. |
| Fluency & coherence | Whether the idea stays connected across turns; pauses, restarts, and completed thought groups in comparable spontaneous speech | A transcript cannot reliably measure timing; longer output or higher WPM alone is not improvement. |
| Lexical resource | Independent word retrieval, appropriate use in context, successful paraphrase when a word is missing, reuse after feedback | Separate words supplied by Chappy from words Yuki retrieved independently; avoid raw vocabulary counts across different topics. |
| Grammar control | Accuracy of constructions actually attempted, especially recurring patterns, balanced against sentence complexity and self-repair | Count opportunities, not just errors; ASR-uncertain articles or prepositions are not confirmed errors. |
| Interaction & repair | Independent clarification, question-asking, correction of misunderstanding, turn-taking, and topic direction | Do not score the assistant's repair as Yuki's skill. |
| Pronunciation | Directly reviewed audio for intelligibility, sound patterns, stress, rhythm, and connected speech | No new full rating from transcript or ASR/waveform measures alone; state N/A and retain the prior measured level separately. |

For retrospective re-evaluation, prefer the raw transcript over polished Journal wording. Never reconstruct a missing historical transcript from summaries or model-generated prose. Redactions such as `[REDACTED_WORK_INFO]` are treated as missing lexical content, not learner errors. Transcript timing is usable only when trustworthy timestamps are preserved; plain text alone cannot establish pause duration or WPM.

The separate fixed spontaneous-speaking probe can provide finer evidence for task achievement, fluency, lexis, and grammar. Interaction still needs dialogue; pronunciation still needs suitable direct audio review. Compare probe observations only under materially similar conditions, and wait for at least two observations before claiming a trend.

## Reporting rule

For each dimension, show the current rating or N/A, the previous rating, the comparison decision, one evidence sentence, and a limitation when relevant. Explain specifically why a rating remained unchanged. Do not imply that six unchanged numbers prove no learning, or that a richer conversation alone proves a level increase. If the evidence is mixed, say so plainly and give the next observation that would resolve it.
