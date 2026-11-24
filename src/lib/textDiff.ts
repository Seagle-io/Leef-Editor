/**
 * Smallest single replacement turning `prev` into `next` (common prefix and
 * suffix trimmed), so a document sync leaves the caret and scroll of the editor
 * outside the changed zone untouched. `null` when the texts are equal.
 */
const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

export function minimalChange(prev: string, next: string): { from: number; to: number; insert: string } | null {
  if (prev === next) return null;

  const max = Math.min(prev.length, next.length);
  let start = 0;
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  // Never cut a surrogate pair in two: step back before its high half.
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--;

  let suffix = 0;
  while (suffix < max - start && prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) suffix++;
  // The suffix must not begin on a low half whose high half is left outside it.
  if (suffix > 0 && isLowSurrogate(prev.charCodeAt(prev.length - suffix))) suffix--;

  return { from: start, to: prev.length - suffix, insert: next.slice(start, next.length - suffix) };
}
