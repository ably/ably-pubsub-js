/**
 * partial-json - Parse incomplete JSON strings
 *
 * Vendored from https://github.com/promplate/partial-json-parser-js
 * MIT License - Copyright (c) 2024 promplate
 *
 * Recursive descent parser for incomplete JSON. Useful for rendering
 * streaming JSON as it arrives (e.g., AI/LLM token streaming).
 */

export const Allow = { STR: 1, NUM: 2, ARR: 4, OBJ: 8, NULL: 16, BOOL: 32, NAN: 64, INFINITY: 128, _INFINITY: 256, ALL: 511 } as const;

const fail = (msg?: string): never => { throw Error(msg); };
const J = JSON.parse;

/**
 * Parse a possibly-incomplete JSON string, returning the best-effort result.
 */
export function parsePartialJSON(raw: string, allow: number = 511): unknown {
  if (typeof raw !== 'string') throw TypeError();
  const s = raw.trim();
  if (!s) fail();
  const len = s.length;
  let i = 0;
  const sub = (from: number, to?: number) => s.slice(from, to);

  const lit = (word: string, flag: number, val: unknown): unknown => {
    if (s.startsWith(word, i)) { i += word.length; return val; }
    if (allow & flag && len - i < word.length && word.startsWith(sub(i))) { i = len; return val; }
    fail();
  };

  const ws = () => { while (i < len && s[i] < '!') i++; };

  const parse = (): unknown => {
    ws();
    i >= len && fail();
    const ch = s[i];
    if (ch === '"') {
      const start = i++;
      let esc = false;
      while (i < len && (s[i] !== '"' || esc)) { esc = s[i] === '\\' ? !esc : false; i++; }
      if (s[i] === '"') {
        try { return J(sub(start, ++i - +esc)); } catch (e) { fail('' + e); }
      }
      if (allow & 1) {
        try { return J(sub(start, i - +esc) + '"'); } catch {
          return J(sub(start, s.lastIndexOf('\\')) + '"');
        }
      }
      fail();
    }
    if (ch === '{') {
      i++; ws();
      const obj: Record<string, unknown> = {};
      try {
        while (s[i] !== '}') {
          ws();
          if (i >= len && allow & 8) return obj;
          const key = parse() as string;
          ws(); i++;
          try { obj[key] = parse(); } catch { if (allow & 8) return obj; fail(); }
          ws();
          if (s[i] === ',') i++;
        }
      } catch (e) { if (allow & 8) return obj; throw e; }
      i++;
      return obj;
    }
    if (ch === '[') {
      i++;
      const arr: unknown[] = [];
      try {
        while (s[i] !== ']') {
          arr.push(parse());
          ws();
          if (s[i] === ',') i++;
        }
      } catch { if (allow & 4) return arr; fail(); }
      i++;
      return arr;
    }
    if (ch === 'n') return lit('null', 16, null);
    if (ch === 't') return lit('true', 32, true);
    if (ch === 'f') return lit('false', 32, false);
    if (ch === 'N') return lit('NaN', 64, NaN);
    if (ch === 'I') return lit('Infinity', 128, Infinity);
    // number
    const start = i;
    if (ch === '-') {
      i++;
      if (i < len && s[i] === 'I') try { return -(lit('Infinity', 256, Infinity) as number); } catch { /* not -Infinity */ }
      if (i >= len) { if (allow & 2) return 0; fail(); }
    }
    while (i < len && ',]}'.indexOf(s[i]) < 0) i++;
    const num = sub(start, i);
    try { return J(num); } catch {
      if (i === len && !(allow & 2)) fail();
      if (num === '-') { if (allow & 2) return 0; fail(); }
      try { return J(sub(start, s.lastIndexOf('e'))); } catch (e) { fail('' + e); }
    }
  };

  return parse();
}
