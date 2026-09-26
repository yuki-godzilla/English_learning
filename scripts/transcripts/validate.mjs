/** Validate public raw-evidence transcripts without treating them as Journal input. */
import fs from "node:fs/promises";
import path from "node:path";
import { loadJournal } from "../lib/journal-parser.mjs";
import { projectRoot as root } from "../lib/project.mjs";
import { analyzeTranscripts } from "./analyze.mjs";

const directory = path.join(root, "learning-records", "transcripts");
const failures = [];
const fail = (message) => failures.push(message);
const journal = await loadJournal();
const byNumber = new Map(journal.sessions.map((session) => [session.session, session]));
const coverage = JSON.parse(await fs.readFile(path.join(directory, "coverage.json"), "utf8"));
const annotations = JSON.parse(await fs.readFile(path.join(directory, "speech-mode-annotations.json"), "utf8"));
const allowedModes = new Set(["spontaneous", "read_aloud", "repetition", "fixed_probe", "unclear"]);
if (annotations.schema_version !== 1 || annotations.default_mode !== "spontaneous" || !Array.isArray(annotations.annotations)) fail("Invalid speech-mode annotation manifest");
const annotationsBySession = new Map();
for (const annotation of annotations.annotations ?? []) {
  if (!allowedModes.has(annotation.speech_mode) || !Number.isInteger(annotation.turn_index) || annotation.turn_index < 1 || typeof annotation.evidence !== "string" || !annotation.evidence.trim()) fail(`Invalid speech-mode annotation: ${annotation.session_number}/${annotation.turn_index}`);
  if (!annotationsBySession.has(annotation.session_number)) annotationsBySession.set(annotation.session_number, new Map());
  const byIndex = annotationsBySession.get(annotation.session_number);
  if (byIndex.has(annotation.turn_index)) fail(`Duplicate speech-mode annotation: ${annotation.session_number}/${annotation.turn_index}`);
  byIndex.set(annotation.turn_index, annotation);
}
const statuses = new Set(["complete", "partial", "unavailable"]);
const allowedSources = new Set(["voice_asr", "read_aloud_asr", "typed", "assistant"]);
const privatePatterns = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "email address"],
  [/\b(?:Daikin|Osaka\s*Gas|Otaka\s*Gas|Osotogasu|Daigas)\b|ダイキン|大阪ガス/i, "specific employer name"],
  [/\bYuki\s+Okuma\b|\bOkuma\b|大熊/i, "direct identifier"],
  [/\b(?:mental hospital|mental health care|psychiatric (?:hospital|care)|I (?:went|go|was admitted) to (?:a |the )?hospital)\b/i, "personal health information"],
  [/\b(?:sk-[A-Za-z0-9_-]{15,}|ghp_[A-Za-z0-9]{20,})\b/i, "credential-like token"],
  [/\b(?:api[_-]?key|secret|token)\s*[:=]\s*["'][^"']+["']/i, "credential-like value"],
  [/(?:[A-Za-z]:\\Users\\|file:\/\/|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/i, "local file path"],
];

if (coverage.schema_version !== 1 || !Array.isArray(coverage.sessions)) fail("Transcript coverage must use schema_version 1 with a sessions array");
const seenSessions = new Set();
const referencedFiles = new Set();
let turnCount = 0;

for (const entry of coverage.sessions ?? []) {
  const session = byNumber.get(entry.session_number);
  if (!session || entry.session_id !== session.id || entry.date !== session.date) {
    fail(`Coverage has no matching Journal session: ${entry.session_number}`);
    continue;
  }
  if (seenSessions.has(entry.session_number)) fail(`Duplicate coverage for Session ${entry.session_number}`);
  seenSessions.add(entry.session_number);
  if (!statuses.has(entry.status)) fail(`Invalid coverage status for Session ${entry.session_number}`);
  if (entry.status === "unavailable") {
    if (entry.file || !entry.reason) fail(`Unavailable Session ${entry.session_number} must have a reason and no file`);
    continue;
  }
  if (entry.status === "partial" && !entry.reason) fail(`Partial Session ${entry.session_number} needs a limitation reason`);
  const expectedName = `${entry.date}-session-${entry.session_id.slice(-2)}.jsonl`;
  if (entry.file !== expectedName) { fail(`Incorrect transcript filename for Session ${entry.session_number}`); continue; }
  referencedFiles.add(entry.file);

  let records;
  try {
    const content = await fs.readFile(path.join(directory, entry.file), "utf8");
    if (!content.endsWith("\n")) fail(`${entry.file} must end with a newline`);
    records = content.trimEnd().split(/\r?\n/).map((line) => JSON.parse(line));
  } catch (error) {
    fail(`Cannot parse ${entry.file}: ${error.message}`);
    continue;
  }
  const [meta, ...turns] = records;
  const yukiTurns = turns.filter((turn) => turn.speaker === "yuki");
  const usable = yukiTurns.filter((turn) => !/\[REDACTED_[A-Z_]+\]/.test(turn.text ?? ""));
  const ratio = yukiTurns.length ? Math.round(usable.length / yukiTurns.length * 1000) / 1000 : 0;
  if (entry.usable_recovered_ratio !== ratio) fail(`${entry.file} usable_recovered_ratio must equal ${ratio}`);
  for (const [index, annotation] of annotationsBySession.get(entry.session_number) ?? []) {
    const target = turns[index - 1];
    if (!target || target.speaker !== "yuki" || /\[REDACTED_[A-Z_]+\]/.test(target.text ?? "")) fail(`Speech-mode annotation does not identify a usable Yuki turn: ${entry.session_number}/${index}`);
  }
  if (!meta || meta.type !== "session_meta" || meta.session_number !== session.session || meta.session_id !== session.id || meta.date !== session.date || meta.timezone !== "Asia/Tokyo" || !meta.capture || !meta.completeness || meta.redaction_reviewed !== true) {
    fail(`${entry.file} is missing matching provenance, scope, or completed redaction review`);
  }
  if (!turns.length) fail(`${entry.file} has no turns`);
  let previousTimestamp = "";
  for (const [offset, turn] of turns.entries()) {
    const line = offset + 2;
    if (turn.type !== "turn" || turn.index !== offset + 1) fail(`${entry.file}:${line} has a missing or out-of-order turn index`);
    if (!["yuki", "chappy"].includes(turn.speaker) || !allowedSources.has(turn.source) || (turn.speaker === "chappy") !== (turn.source === "assistant")) fail(`${entry.file}:${line} has an invalid speaker/source pair`);
    if (typeof turn.text !== "string" || !turn.text.trim()) fail(`${entry.file}:${line} has empty text`);
    if (turn.timestamp != null) {
      if (typeof turn.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(turn.timestamp) || Number.isNaN(Date.parse(turn.timestamp))) fail(`${entry.file}:${line} has an invalid timestamp`);
      else if (turn.timestamp < previousTimestamp) fail(`${entry.file}:${line} timestamps are not chronological`);
      previousTimestamp = turn.timestamp;
    }
    if (/\/?(?:realtime_delegation|transcript_delta)>/i.test(turn.text)) fail(`${entry.file}:${line} contains a handoff wrapper, not a transcript turn`);
    for (const [pattern, label] of privatePatterns) if (pattern.test(turn.text)) fail(`${entry.file}:${line} contains ${label}`);
  }
  turnCount += turns.length;
}

for (const session of journal.sessions) if (!seenSessions.has(session.session)) fail(`Missing transcript coverage for Session ${session.session}`);
for (const file of (await fs.readdir(directory)).filter((name) => name.endsWith(".jsonl"))) {
  if (!referencedFiles.has(file)) fail(`Transcript is not registered in coverage.json: ${file}`);
}
if (!failures.length) {
  const analytics = await analyzeTranscripts();
  for (const session of analytics.sessions) {
    if (session.spontaneous_segments + session.speech_mode_counts.read_aloud + session.speech_mode_counts.repetition + session.speech_mode_counts.fixed_probe + session.speech_mode_counts.unclear !== session.usable_yuki_segments) fail(`Speech modes do not partition usable Session ${session.session} turns`);
    if (session.spontaneous_segment_lengths.length !== session.spontaneous_segments) fail(`Missing segment-length observations for Session ${session.session}`);
  }
  for (const window of [analytics.comparison.earlier, analytics.comparison.recent]) {
    if (window.sessions.some((number) => analytics.sessions.find((session) => session.session === number)?.coverage_band !== "high")) fail("Speaking comparison includes a low-coverage session");
    if (window.buckets.reduce((total, bucket) => total + bucket.count, 0) > window.segments) fail("Length buckets exceed spontaneous segments");
  }
  if (analytics.comparison.earlier.sessions.some((number) => analytics.comparison.recent.sessions.includes(number))) fail("Earlier and recent speaking windows overlap");
}
if (failures.length) {
  console.error(`Transcript validation failed with ${failures.length} issue(s):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`Transcript validation passed: ${referencedFiles.size} source-backed files, ${turnCount} preserved segments, ${journal.sessions.length - referencedFiles.size} unavailable sessions.`);
