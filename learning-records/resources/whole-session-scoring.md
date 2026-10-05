# Whole-session scoring protocol (effective from Session 16)

## Traceable evidence contract v3 (new ratings from Session 17)

Each metric_evidence keeps basis / observed / comparison / reason / confidence and adds provenance:

```json
{"rubric_version":"whole-session-v3","task_kind":"spontaneous","support":"independent","preparation_seconds":null,"turn_indices":[153],"alternative_evidence":null,"comparison_session":null,"comparison_conditions":null,"next_observation":"Observe the same skill in a new unprompted explanation."}
```

The example is a schema illustration, not a new learner assessment. References identify real learner turn indices in that Session's JSONL. If raw evidence is unavailable, alternative_evidence must identify the preserved source and its limitation. Unknown preparation time stays null. A changed/stable comparison needs a prior Session and an explicit account of topic, task, support and capture comparability. N/A does not mean failure. New holistic Pronunciation ratings require pronunciation_evidence.holistic_audio_review=true after actual audio review; ASR processing alone does not qualify.

Keep a separate conversation_quality audit with assistant-turn references for misunderstanding, unsolicited correction, repetitive questions, and UI/tool confusion. Do not penalize the learner for repairing an assistant-caused misunderstanding. Marker counts describe all visible repair markers and cannot assign fault automatically. Record an independent successful reuse only when the learner uses the expression without a supplied model; a single success is not mastery.

Future reports show one observed success, the evidence limit or reason for a flat score, and one (at most two) next practice targets. No fabricated trend, punitive streak, or required extra task when the learner wants to finish.

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

### Evidence-first report assessment (2026-10-05)

Start by identifying the methods actually available in that session and what each can establish. Keep conversation/transcript observations, locally measured audio data, and historical ratings separate. Processing a recording does not establish that Chappy listened to it or judged its individual sounds and prosody.

For the five assessable conversation dimensions, connect an actual utterance or concrete behavior to what it demonstrates, its evidence limits, and a level/stage only when supported. Keep current/previous ratings, comparison reasons, and confidence traceable. Compare topic familiarity, task, support, preparation, and capture conditions; unfamiliar specialist reading and familiar conversation are not interchangeable. Assistant-caused misunderstandings or UI confusion are not learner deficits, and transcript text alone cannot establish timing.

Lead the report with one observed success, the limitation or reason for a stable/withheld rating, and one or two next practice targets. A clearer explanation, self-repair, or independently reused expression can be meaningful without a level increase. If no success or change is established, say it is unconfirmed rather than inventing one. Keep ASR matching and pace as method-labeled measurements, not pronunciation percentages, L ratings, or examination scores. Apply this policy to new reports without silently rescoring history.

### Temporary pause on new holistic Pronunciation ratings (2026-10-05)

At Yuki's request, suspend new holistic Pronunciation L1–L5 ratings and within-level stages until a reliable direct audio review method is verified and resumption is agreed with Yuki. Keep the Pronunciation dimension in the data as N/A, with the reason that holistic assessment is paused because of the review-method limitation. Continue assessing the other five dimensions independently when their evidence is sufficient.

N/A is neither zero nor a low rating. Do not use an unmeasured pronunciation value in an overall score or describe the other five dimensions as a complete assessment including pronunciation. Preserve past ratings and identify their historical evidence limits separately; do not rescore or remove history under this policy.

Local pace, pauses, recording quality, and ASR results may still be reported as limited measurements, not sound-accuracy ratings. Before requesting another recording for a holistic rating, test the review method on existing audio. New software or an automatic score alone does not establish valid sound/prosody review. Any external audio transfer still requires the explicit approval specified in AGENTS.md.

For each dimension, show the current rating or N/A, the previous rating, the comparison decision, one evidence sentence, and a limitation when relevant. Explain specifically why a rating remained unchanged. Do not imply that six unchanged numbers prove no learning, or that a richer conversation alone proves a level increase. If the evidence is mixed, say so plainly and give the next observation that would resolve it.
