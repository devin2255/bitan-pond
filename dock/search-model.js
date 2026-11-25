const path = require("node:path");

function parseQuery(value) {
  const words = String(value ?? "").trim().slice(0, 240).match(/"[^"]+"|[^\s]+/g) || [];
  const query = { terms: [], root: "", extension: "" };
  for (const word of words) {
    const root = /^(?:盘符:)?([a-z]):(?:[\\/])?$/i.exec(word);
    const ext = /^(?:ext:|后缀:)\.?([\p{L}\p{N}_+-]+)$/iu.exec(word);
    if (root) query.root = `${root[1].toLowerCase()}:\\`;
    else if (ext) query.extension = `.${ext[1].toLowerCase()}`;
    else query.terms.push(word.replace(/^"|"$/g, "").toLowerCase());
  }
  return query;
}

function matchScore(fullPath, kind, query, label) {
  const lower = fullPath.toLowerCase();
  if (query.root && !lower.startsWith(query.root)) return -1;
  if (query.extension && (kind !== "file" || !lower.endsWith(query.extension))) return -1;
  if (!query.terms.length) return 0;
  const name = label ? label.toLowerCase() : lower.slice(lower.lastIndexOf("\\") + 1);
  let score = 0;
  for (const term of query.terms) {
    if (name === term) score += 30;
    else if (name.startsWith(term)) score += 20;
    else if (name.includes(term)) score += 10;
    else if (lower.includes(term)) score += 2;
    else return -1;
  }
  return score;
}

function mergeResults(groups, query, limit = 90, category = "all") {
  const unique = new Map();
  for (const rows of groups) {
    for (const row of rows) {
      if (!row || typeof row.target !== "string" || !["app", "file", "folder"].includes(row.kind)) continue;
      if (category !== "all" && row.kind !== category) continue;
      const key = `${row.kind}:${row.target.toLowerCase()}`;
      if (unique.has(key)) continue;
      const name = row.name || path.win32.basename(row.target);
      const score = matchScore(row.target, row.kind, query, name);
      if (score >= 0) unique.set(key, { ...row, name, score });
    }
  }
  return [...unique.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, limit);
}

module.exports = { parseQuery, matchScore, mergeResults };
