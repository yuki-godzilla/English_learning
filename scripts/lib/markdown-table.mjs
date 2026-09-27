/** Parse pipe rows without splitting escaped pipes or code-span pipes. */
export function tableRows(markdown, { bankOnly = true } = {}) {
  return markdown.split(/\r?\n/).filter(l => /^\s*\|.*\|\s*$/.test(l)).map(line => {
    const cells = []; let cell = '', fence = 0;
    const value = line.trim().slice(1, -1);
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '\\' && value[i + 1] === '|') { cell += '|'; i++; continue; }
      if (value[i] === '`') { let n = 1; while (value[i + n] === '`') n++; fence = fence === n ? 0 : fence || n; cell += '`'.repeat(n); i += n - 1; continue; }
      if (value[i] === '|' && !fence) { cells.push(cell.trim()); cell = ''; } else cell += value[i];
    }
    cells.push(cell.trim()); return cells;
  }).filter(c => c.length >= 3 && !c.every(v => /^:?-{3,}:?$/.test(v)))
    .filter(c => !bankOnly || !/^(Expression|Word \/ IPA|Word \/ Chunk)/i.test(c[0]));
}
export function normalizeBankKey(value) {
  return value.replace(/[*_`]/g, '').normalize('NFKC').toLowerCase().trim();
}
