/** Derive cautious speaking-behavior metrics from committed raw transcripts.
 *
 * These metrics intentionally avoid pronunciation and ASR-sensitive grammar counts.
 * They are learning diagnostics, not proficiency scores.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { recordsRoot } from "../lib/project.mjs";

const transcriptRoot = path.join(recordsRoot, "transcripts");
const redactionPattern = /\[REDACTED_[A-Z_]+\]/;
const japanesePattern = /[\u3040-\u30ff\u3400-\u9fff]/u;

function countMatches(value, pattern) {
  return [...String(value ?? "").matchAll(pattern)].length;
}

function tokenizeWords(value) {
  return String(value ?? "").match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? [];
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function ratePer100(count, denominator) {
  return denominator > 0 ? round((count / denominator) * 100) : null;
}

function coverageBand(ratio) {
  if (ratio >= 0.8) return "high";
  if (ratio >= 0.5) return "medium";
  return "low";
}

function analyzeYukiTurns(turns) {
  const yukiTurns = turns.filter((turn) => turn?.type === "turn" && turn.speaker === "yuki");
  const redactedTurns = yukiTurns.filter((turn) => redactionPattern.test(turn.text ?? ""));
  const usableTurns = yukiTurns.filter((turn) => !redactionPattern.test(turn.text ?? ""));
  const usableText = usableTurns.map((turn) => turn.text ?? "").join(" ");
  const words = tokenizeWords(usableText);
  const wordCount = words.length;

  // Planning fillers: keep the definition narrow. "yeah" and "you know" are
  // tracked separately because they can be meaningful discourse markers.
  const fillerCount = countMatches(usableText, /\b(?:uh|um|hmm|hm)\b/gi);
  const youKnowCount = countMatches(usableText, /\byou know\b/gi);
  const iMeanCount = countMatches(usableText, /\bi mean\b/gi);
  const howCanISayCount = countMatches(usableText, /\bhow can i say\b/gi);
  const whatDoYouMeanCount = countMatches(usableText, /\bwhat do you mean\b/gi);
  const iWantToSayCount = countMatches(usableText, /\bi want to say\b/gi);
  const directCorrectionCount = countMatches(usableText, /\bno(?:\s*[,.-]?\s*no){1,}\b/gi);
  const repairMarkerCount = iMeanCount + howCanISayCount + whatDoYouMeanCount + iWantToSayCount + directCorrectionCount;
  const japaneseFallbackTurns = usableTurns.filter((turn) => japanesePattern.test(turn.text ?? "")).length;
  const longTurns = usableTurns.filter((turn) => tokenizeWords(turn.text).length >= 20).length;
  const questionTurns = usableTurns.filter((turn) => /\?/.test(turn.text ?? "")).length;
  const coverageRatio = yukiTurns.length > 0 ? usableTurns.length / yukiTurns.length : 0;

  return {
    yuki_segments: yukiTurns.length,
    usable_yuki_segments: usableTurns.length,
    redacted_yuki_segments: redactedTurns.length,
    usable_segment_ratio: round(coverageRatio, 3),
    coverage_band: coverageBand(coverageRatio),
    words: wordCount,
    avg_words_per_segment: usableTurns.length ? round(wordCount / usableTurns.length) : null,
    long_segment_share_pct: usableTurns.length ? round((longTurns / usableTurns.length) * 100) : null,
    filler_count: fillerCount,
    filler_per_100_words: ratePer100(fillerCount, wordCount),
    you_know_count: youKnowCount,
    you_know_per_100_words: ratePer100(youKnowCount, wordCount),
    repair_marker_count: repairMarkerCount,
    repair_markers_per_100_words: ratePer100(repairMarkerCount, wordCount),
    lexical_search_count: howCanISayCount + iWantToSayCount,
    lexical_search_per_100_words: ratePer100(howCanISayCount + iWantToSayCount, wordCount),
    japanese_fallback_turns: japaneseFallbackTurns,
    japanese_fallback_per_100_segments: ratePer100(japaneseFallbackTurns, usableTurns.length),
    question_turns: questionTurns,
    question_turn_share_pct: usableTurns.length ? round((questionTurns / usableTurns.length) * 100) : null,
    marker_counts: {
      i_mean: iMeanCount,
      how_can_i_say: howCanISayCount,
      what_do_you_mean: whatDoYouMeanCount,
      i_want_to_say: iWantToSayCount,
      direct_correction: directCorrectionCount,
    },
  };
}

export async function analyzeTranscripts() {
  const coverage = JSON.parse(await fs.readFile(path.join(transcriptRoot, "coverage.json"), "utf8"));
  const sessions = [];

  for (const entry of coverage.sessions ?? []) {
    if (!entry.file || !["partial", "complete"].includes(entry.status)) continue;
    const content = await fs.readFile(path.join(transcriptRoot, entry.file), "utf8");
    const records = content.trimEnd().split(/\r?\n/).map((line) => JSON.parse(line));
    const [meta, ...turns] = records;
    sessions.push({
      session: entry.session_number,
      session_id: entry.session_id,
      date: entry.date,
      status: entry.status,
      limitation: entry.reason ?? meta?.completeness ?? "",
      ...analyzeYukiTurns(turns),
    });
  }

  sessions.sort((a, b) => a.session - b.session);
  return {
    methodology: {
      label: "Raw transcript speaking fingerprint",
      source: "learning-records/transcripts/coverage.json + committed JSONL",
      boundaries: [
        "ASR segments are not guaranteed conversational turn boundaries.",
        "Redacted learner segments are excluded from language counts.",
        "Article/preposition errors are not auto-counted because ASR can alter short function words.",
        "Transcript metrics do not score pronunciation, pause duration, or WPM.",
        "Lower filler or repair rates are not automatically better; interpret them with task achievement and interaction.",
      ],
    },
    sessions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(await analyzeTranscripts(), null, 2)}\n`);
}
