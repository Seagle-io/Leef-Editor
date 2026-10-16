import { bench, describe } from "vitest";
import { NoteIndex, type NoteFile } from "./noteIndex";

const COUNT = 1000;

function note(i: number): NoteFile {
  let content = `# Note ${i}\n`;
  for (let l = 0; content.length < 5000; l++) {
    content += l % 20 === 0
      ? `## Section ${l}\n`
      : `Ligne ${l} de texte courant ${"lorem ipsum ".repeat(4)}${l % 2 === 0 ? `[[note-${(i * 7 + l) % COUNT}]] ` : ""}\n`;
  }
  return { path: `/w/d${i % 10}/note-${i}.md`, rel: `d${i % 10}/note-${i}.md`, content };
}

const files = Array.from({ length: COUNT }, (_, i) => note(i));
const index = NoteIndex.build(files);
let n = 0;

describe("noteIndex 1000 x 5 kB", () => {
  bench("build (budget < 150 ms)", () => {
    NoteIndex.build(files);
  });

  bench("upsert (budget < 2 ms)", () => {
    const f = files[n++ % COUNT];
    index.upsert({ ...f, content: f.content + "[[note-1]]\n" });
  });
});
