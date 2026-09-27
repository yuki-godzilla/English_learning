import { ratingLabel, pronunciationBasis } from '../lib/evidence.mjs';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/** Ordinal levels only. Stage encoded by shape, never invented decimal scores. */
export function skillTimeline(progress) {
  const sessions = progress.sessions, metrics = progress.qualitative_metrics;
  const latest = sessions.at(-1), width = 1400, height = 600;
  const panels = metrics.map((metric, i) => {
    const left = 24 + (i % 3) * 465, top = 18 + Math.floor(i / 3) * 270;
    const x = n => left + 42 + (n / Math.max(1, sessions.length - 1)) * 392;
    const y = l => top + 190 - (l - 1) * 30;
    const grid = [1,2,3,4,5].map(l => `<path d="M${x(0)},${y(l)}H${x(sessions.length-1)}" stroke="#cbd5e1"/><text x="${left+8}" y="${y(l)+5}">L${l}</text>`).join('');
    const marks = sessions.map((s, n) => {
      const value = s.ratings[metric], prior = sessions[n-1]?.ratings[metric];
      if (!Number.isInteger(value)) return `<text x="${x(n)}" y="${y(1)+22}" text-anchor="middle" fill="#4b5563">×</text>`;
      const legacy = metric === 'Pronunciation' && pronunciationBasis(s) === 'legacy_limited';
      const color = legacy ? '#6b7280' : n === sessions.length-1 ? '#047857' : '#1d4ed8';
      const line = Number.isInteger(prior) ? `<path d="M${x(n-1)},${y(prior)}L${x(n)},${y(value)}" stroke="${color}" stroke-width="2" fill="none"/>` : '';
      const stage = s.within_level_stage?.[metric];
      const shape = stage === 'strong' ? `<path d="M${x(n)},${y(value)-6}l6,6 -6,6 -6,-6Z" fill="${color}"/>` : `<circle cx="${x(n)}" cy="${y(value)}" r="5" fill="${stage === 'emerging' ? '#fff' : color}" stroke="${color}" stroke-width="2"/>`;
      return `${line}<g><title>S${s.session}: ${escape(ratingLabel(s,metric))}</title>${shape}</g>`;
    }).join('');
    const labels = sessions.map((s,n) => n === 0 || n === sessions.length-1 || (n+1)%4===0 ? `<text x="${x(n)}" y="${top+239}" text-anchor="middle" font-size="24">${s.session}</text>` : '').join('');
    return `<g><text x="${left+8}" y="${top+20}" font-weight="700" font-size="26">${escape(metric)}</text><text x="${left+8}" y="${top+49}" font-size="24">今回 S${latest.session}: ${escape(ratingLabel(latest,metric))}</text>${grid}${marks}${labels}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>text{font-family:'Yu Gothic',Meiryo,Arial,sans-serif;fill:#1f2937;font-size:24px}</style><rect width="100%" height="100%" fill="white"/>${panels}<text x="32" y="566" font-size="24">横軸: Session　 ○ 形成中 / ● 安定 / ◆ 強い　× N/A（未測定）</text><text x="32" y="596" font-size="24">発音の灰色点は旧基準・限定根拠。個人学習用の観察値であり、公式試験スコアではありません。</text></svg>`;
}
