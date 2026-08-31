import fs from "node:fs/promises";
import path from "node:path";
import { recordsRoot } from "./project.mjs";

const sectionHeadings = {
  review: /^# 今日の5分復習\s*$/m,
  sessions: /^# 英会話セッション \/ Sessions\s*$/m,
  growth: /^# 英語力の成長・評価 \/ Growth & Evaluation\s*$/m,
  expressions: /^# 表現バンク \/ Expression Bank\s*$/m,
  vocabulary: /^# 語彙バンク \/ Vocabulary Bank\s*$/m,
  speaking: /^# 発音・スピーキングバンク \/ Pronunciation & Speaking Bank\s*$/m,
};

function sliceSection(markdown, startPattern, nextPatterns = []) {
  const start = markdown.search(startPattern);
  if (start < 0) return "";
  const candidates = nextPatterns
    .map((pattern) => markdown.slice(start + 1).search(pattern))
    .filter((index) => index >= 0)
    .map((index) => start + 1 + index);
  const end = candidates.length ? Math.min(...candidates) : markdown.length;
  return markdown.slice(start, end).trim();
}

export function parseJournal(markdown) {
  const matches = [...markdown.matchAll(/<!--\s*session-meta:\s*(\{.*?\})\s*-->\s*\r?\n<a id="session-([^"]+)"><\/a>/g)];
  const growthStart = markdown.search(sectionHeadings.growth);
  const sessions = matches.map((match, index) => {
    const metadata = JSON.parse(match[1]);
    if (metadata.session_id !== match[2]) {
      throw new Error(`Session metadata and anchor differ: ${metadata.session_id} / ${match[2]}`);
    }
    const nextStart = matches[index + 1]?.index ?? growthStart;
    if (nextStart < 0) throw new Error(`Growth section is missing after ${metadata.session_id}`);
    return {
      session: Number(metadata.session_number),
      id: metadata.session_id,
      date: metadata.date,
      title: metadata.title,
      tags: metadata.tags,
      remember: metadata.remember,
      prompt: metadata.prompt,
      anchor: `session-${metadata.session_id}`,
      raw: markdown.slice(match.index, nextStart).trim(),
    };
  });

  return {
    markdown,
    sessions,
    sections: {
      review: sliceSection(markdown, sectionHeadings.review, [sectionHeadings.sessions]),
      sessions: sliceSection(markdown, sectionHeadings.sessions, [sectionHeadings.growth]),
      growth: sliceSection(markdown, sectionHeadings.growth, [sectionHeadings.expressions]),
      expressions: sliceSection(markdown, sectionHeadings.expressions, [sectionHeadings.vocabulary]),
      vocabulary: sliceSection(markdown, sectionHeadings.vocabulary, [sectionHeadings.speaking]),
      speaking: sliceSection(markdown, sectionHeadings.speaking),
    },
  };
}

export async function loadJournal() {
  const markdown = await fs.readFile(path.join(recordsRoot, "journal.md"), "utf8");
  return parseJournal(markdown);
}

export { sectionHeadings };
