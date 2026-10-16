export interface FuzzyMatch {
  score: number;
  positions: number[];
}

const QUERY_MAX = 64;
const TEXT_MAX = 256;
const SEPARATORS = " -_./";
const ASCII = /^[\x00-\x7f]*$/;
const MARKS = /\p{M}/gu;
const cache = new Map<string, string>();

function normalizeChar(ch: string): string {
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  const folded = ch.normalize("NFD").replace(MARKS, "").toLowerCase();
  const out = [...folded].length === 1 ? folded : ch;
  cache.set(ch, out);
  return out;
}

/** Par point de code : NFD, sans diacritiques, minuscule ; 1 point de code -> 1 point de code. */
export function normalizeForSearch(s: string): string {
  if (ASCII.test(s)) return s.toLowerCase();
  let out = "";
  for (const ch of s) out += normalizeChar(ch);
  return out;
}

function isWordStart(prev: string, cur: string): boolean {
  if (SEPARATORS.includes(prev)) return true;
  const prevLower = prev.toLowerCase() === prev && prev.toUpperCase() !== prev;
  const curUpper = cur.toUpperCase() === cur && cur.toLowerCase() !== cur;
  return prevLower && curUpper;
}

/** Sous-séquence obligatoire ; null si requête > 64 points de code ; texte tronqué à 256. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = [...normalizeForSearch(query.replace(/\s+/gu, ""))];
  if (q.length === 0) return { score: 0, positions: [] };
  if (q.length > QUERY_MAX) return null;
  const original = [...text.slice(0, TEXT_MAX * 2)].slice(0, TEXT_MAX);
  const t = [...normalizeForSearch(original.join(""))];
  const n = q.length;
  const m = t.length;

  let at = 0;
  for (let j = 0; j < m && at < n; j++) if (t[j] === q[at]) at++;
  if (at < n) return null;

  const start = t.map((_, j) => (j === 0 ? 8 : isWordStart(original[j - 1], original[j]) ? 6 : 0));
  const parent = new Int32Array(n * m).fill(-1);
  let prev: number[] = [];
  for (let i = 0; i < n; i++) {
    const cur: number[] = new Array<number>(m).fill(-Infinity);
    let far = -Infinity;
    let farAt = -1;
    for (let j = 0; j < m; j++) {
      if (i > 0 && j >= 4 && prev[j - 4] - 3 > far) {
        far = prev[j - 4] - 3;
        farAt = j - 4;
      }
      if (t[j] !== q[i]) continue;
      let best = 0;
      let from = -1;
      if (i > 0) {
        best = far;
        from = farAt;
        for (let k = Math.max(0, j - 3); k <= j - 2; k++) {
          const v = prev[k] - (j - k - 1);
          if (v > best) {
            best = v;
            from = k;
          }
        }
        if (j >= 1 && prev[j - 1] + 4 > best) {
          best = prev[j - 1] + 4;
          from = j - 1;
        }
        if (best === -Infinity) continue;
      }
      cur[j] = best + 1 + start[j];
      parent[i * m + j] = from;
    }
    prev = cur;
  }

  let end = -1;
  for (let j = 0; j < m; j++) if (prev[j] > (end === -1 ? -Infinity : prev[end])) end = j;
  const positions: number[] = new Array<number>(n);
  for (let i = n - 1, j = end; i >= 0; i--) {
    positions[i] = j;
    j = parent[i * m + j];
  }
  return { score: prev[end], positions };
}

/** Requête vide : ordre d'origine. Sinon score décroissant, texte plus court, ordre d'origine. */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  text: (i: T) => string,
  limit = 50,
): { item: T; match: FuzzyMatch }[] {
  const max = Math.max(0, limit);
  if (query.replace(/\s+/gu, "") === "") {
    return items.slice(0, max).map((item) => ({ item, match: { score: 0, positions: [] } }));
  }
  const hits: { item: T; match: FuzzyMatch; length: number; order: number }[] = [];
  items.forEach((item, order) => {
    const s = text(item);
    const match = fuzzyMatch(query, s);
    if (match) hits.push({ item, match, length: s.length, order });
  });
  hits.sort((a, b) => b.match.score - a.match.score || a.length - b.length || a.order - b.order);
  return hits.slice(0, max).map(({ item, match }) => ({ item, match }));
}
