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

function ratePer100(count, denominator, digits = 1) {
  return denominator > 0 ? round((count / denominator) * 100, digits) : null;
}

function coverageBand(ratio) {
  if (ratio >= 0.8) return "high";
  if (ratio >= 0.5) return "medium";
  return "low";
}

export function tokenizeSpokenWords(value) {
  return tokenizeWords(value);
}

function analyzeYukiTurns(turns, modeByIndex) {
  const yukiTurns = turns.filter((turn) => turn?.type === "turn" && turn.speaker === "yuki");
  const redactedTurns = yukiTurns.filter((turn) => redactionPattern.test(turn.text ?? ""));
  const unredactedTurns = yukiTurns.filter((turn) => !redactionPattern.test(turn.text ?? ""));
  const usableTurns = unredactedTurns.filter((turn) => (modeByIndex.get(turn.index) ?? "spontaneous") === "spontaneous");
  const modeCounts = { spontaneous: usableTurns.length, read_aloud: 0, repetition: 0, fixed_probe: 0, unclear: 0 };
  for (const turn of unredactedTurns) {
    const mode = modeByIndex.get(turn.index) ?? "spontaneous";
    if (mode !== "spontaneous") modeCounts[mode] += 1;
  }
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
  const coverageRatio = yukiTurns.length > 0 ? unredactedTurns.length / yukiTurns.length : 0;
  const lengths = usableTurns.map((turn) => tokenizeWords(turn.text).length).sort((a, b) => a - b);

  return {
    yuki_segments: yukiTurns.length,
    usable_yuki_segments: unredactedTurns.length,
    redacted_yuki_segments: redactedTurns.length,
    spontaneous_segments: usableTurns.length,
    speech_mode_counts: modeCounts,
    spontaneous_segment_lengths: lengths,
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
  const annotations = JSON.parse(await fs.readFile(path.join(transcriptRoot, "speech-mode-annotations.json"), "utf8"));
  const modeBySession = new Map();
  for (const annotation of annotations.annotations) {
    if (!modeBySession.has(annotation.session_number)) modeBySession.set(annotation.session_number, new Map());
    modeBySession.get(annotation.session_number).set(annotation.turn_index, annotation.speech_mode);
  }
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
      ...analyzeYukiTurns(turns, modeBySession.get(entry.session_number) ?? new Map()),
    });
  }

  sessions.sort((a, b) => a.session - b.session);
  const bySession = new Map(sessions.map((session) => [session.session, session]));
  const eligible = sessions.filter((session) => session.coverage_band === "high" && session.spontaneous_segments >= 15);
  const recentWindow = eligible.slice(-2).map((session) => session.session);
  // Start with the earliest comparable pair while the evidence series is
  // short. Once six high-coverage sessions exist, use the preceding pair.
  const earlierWindow = (eligible.length > 5 ? eligible.slice(-4, -2) : eligible.slice(0, 2))
    .map((session) => session.session);
  const summarizeGroup = (numbers) => {
    const group = numbers.map((number) => bySession.get(number)).filter(Boolean);
    const sum = (key) => group.reduce((total, session) => total + (session[key] ?? 0), 0);
    const words = sum("words");
    const segments = sum("spontaneous_segments");
    const lengths = group.flatMap((session) => session.spontaneous_segment_lengths).sort((a, b) => a - b);
    const quantile = (p) => {
      if (!lengths.length) return null;
      const position = (lengths.length - 1) * p;
      const lower = Math.floor(position);
      const upper = Math.ceil(position);
      return round(lengths[lower] + (lengths[upper] - lengths[lower]) * (position - lower), 2);
    };
    const buckets = [
      { label: "1–4", count: lengths.filter((length) => length >= 1 && length <= 4).length },
      { label: "5–9", count: lengths.filter((length) => length >= 5 && length <= 9).length },
      { label: "10–19", count: lengths.filter((length) => length >= 10 && length <= 19).length },
      { label: "20–39", count: lengths.filter((length) => length >= 20 && length <= 39).length },
      { label: "40+", count: lengths.filter((length) => length >= 40).length },
    ].map((bucket) => ({ ...bucket, percent: segments ? round(bucket.count / segments * 100) : null }));
    return {
      sessions: numbers,
      words,
      segments,
      repair_per_100_words: ratePer100(sum("repair_marker_count"), words, 2),
      you_know_per_100_words: ratePer100(sum("you_know_count"), words, 2),
      lexical_search_per_100_words: ratePer100(sum("lexical_search_count"), words, 2),
      japanese_fallback_pct: ratePer100(sum("japanese_fallback_turns"), segments),
      mean_words_per_segment: segments ? round(words / segments, 2) : null,
      long_segment_share_pct: segments ? round(lengths.filter((length) => length >= 20).length / segments * 100) : null,
      median: quantile(0.5), q1: quantile(0.25), q3: quantile(0.75), p90: quantile(0.9), buckets,
    };
  };
  return {
    methodology: {
      label: "Spontaneous speech diagnostics from recovered raw transcripts",
      source: "learning-records/transcripts/coverage.json + speech-mode-annotations.json + committed JSONL",
      boundaries: [
        "ASR segments are not guaranteed conversational turn boundaries.",
        "Reading, prompted repetition, uncertain mode, and redacted learner segments are excluded from spontaneous-language counts.",
        "Coverage is the usable proportion of recovered Yuki segments, not completeness of the original session.",
        "Article/preposition errors are not auto-counted because ASR can alter short function words.",
        "Transcript metrics do not score pronunciation, pause duration, or WPM.",
        "Lower filler or repair rates are not automatically better; interpret them with task achievement and interaction.",
      ],
    },
    sessions,
    comparison: { earlier: summarizeGroup(earlierWindow), recent: summarizeGroup(recentWindow), selection: "high usable-recovered ratio (>=80%), at least 15 spontaneous segments; latest two versus earliest two until six eligible sessions, then preceding two" },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(await analyzeTranscripts(), null, 2)}\n`);
}
