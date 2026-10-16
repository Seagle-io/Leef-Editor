import { bench } from "vitest";
import { compileQuery, searchNotes, type SearchableNote } from "./search";

const LINE = "Lorem ipsum dolor sit amet, consectetur adipiscing élit — sed do eiusmod tempor 😀.\n";
const notes: SearchableNote[] = Array.from({ length: 1000 }, (_, i) => ({
  path: `/d/n${i}.md`,
  rel: `n${String(i).padStart(4, "0")}.md`,
  content: ((i % 10 === 0 ? "needle here\n" : "") + LINE.repeat(65)).slice(0, 5000),
  headings: [`Note ${i}`],
}));
const compiled = compileQuery("needle", { caseSensitive: false, wholeWord: true, regex: false });
if (!compiled.ok) throw new Error(compiled.error.message);
const re = compiled.value;

// Budget: 1 000 files x 5 kB < 300 ms (Node).
const first = await searchNotes(notes, re, () => {}, new AbortController().signal);
console.log(`single run: ${first.ms.toFixed(1)} ms, ${first.files} files`);
if (first.ms >= 300) throw new Error(`budget exceeded: ${first.ms.toFixed(1)} ms >= 300 ms`);

bench("search 1000 x 5 kB", async () => {
  await searchNotes(notes, re, () => {}, new AbortController().signal);
});
