export interface FuzzyMatchResult {
  matches: boolean;
  score: number;
  indices: number[];
}

export function fuzzyMatch(query: string, text: string): FuzzyMatchResult {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let qi = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      qi++;
    }
  }

  if (qi < q.length) return { matches: false, score: 0, indices: [] };

  // score: bonus for consecutive matches and start-of-string
  let score = 0;
  for (let i = 0; i < indices.length; i++) {
    if (i > 0 && indices[i] === indices[i - 1]! + 1) score += 2;
    if (indices[i] === 0) score += 3;
  }

  return { matches: true, score, indices };
}
