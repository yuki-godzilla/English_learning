# Comparable Spontaneous Speaking Probe

Purpose: track changes in word retrieval and connected speaking within a broad L1–L5 level. This is a personal learning measure, not an official test. Keep it separate from read-aloud pronunciation recordings and ordinary conversation.

## Fixed prompt (spontaneous-iot-explanation-v1)

> Explain to a colleague who does not work in software how an IoT device and a cloud service work together. Describe one benefit for users and one trade-off an engineer must consider.

## Conditions

- Use the same prompt for each comparable observation. Give 15 seconds to think, then record one unprepared response of about 60 seconds. Do not read a prepared script.
- Chappy does not interrupt, translate, correct, or supply words until Yuki says the response is finished. Record whether any interruption or assistance nevertheless occurred.
- Yuki controls recording. Keep audio and intermediate analysis in `tmp/pronunciation-recordings/`; do not publish or email them.
- Record task kind as `spontaneous`, purpose as `evaluation`, prompt ID, actual preparation and response duration, and whether the response was one take. A changed condition makes the observation non-comparable until explained.

## Evidence to record in `progress.json`

For each observation, keep the session/date and a short privacy-safe evidence note; never include local audio paths. Review the audio itself before making definite claims about pauses or word retrieval.

Use one object per session in `speaking_probe.observations` with `session`, `date`, `prompt_id`, `task_kind`, `purpose`, `preparation_seconds`, `elapsed_seconds`, `one_take`, `support`, `audio_checked`, `words`, `long_pauses_ge_1s`, `word_search_episodes`, `successful_paraphrases`, `idea_units_completed`, `evidence_confidence`, and `evidence_note`. Use `null` for an unavailable count; do not substitute zero. If audio was not checked, pause and word-search counts must be `null`.

| Measure | Definition and limit |
|---|---|
| `words` | Words in an audio-checked transcript. Mark unavailable if only unverified ASR is available. |
| `elapsed_seconds` | Speaking response duration, including internal pauses but excluding setup and trailing recorder time. |
| `long_pauses_ge_1s` | Internal pauses at least one second, excluding normal sentence-boundary pauses when clearly appropriate. Report per 100 words only when word count is verified. |
| `word_search_episodes` | Clearly evidenced searches for an expression (for example, an explicit request for a word or an abandoned phrase). Silence alone is not sufficient evidence. Report per 100 words only when word count is verified. |
| `successful_paraphrases` | Times Yuki conveyed a missing idea with different words without Chappy supplying the answer. |
| `idea_units_completed` | Count of the three requested ideas: how the parts work together, one user benefit, one engineering trade-off. This is not a pronunciation score. |
| `support` | Any hints, interruption, translation, or other assistance during the answer. |
| `evidence_confidence` | `high`, `medium`, or `low`, with a reason if audio or transcript quality limits interpretation. |

Compare only observations with the same prompt and materially similar conditions. Describe direction and uncertainty, not a fabricated composite score. Improvement in one measure does not automatically change the L-level; use repeated evidence from both this probe and natural conversation. The first recording establishes a baseline and cannot by itself prove improvement.
