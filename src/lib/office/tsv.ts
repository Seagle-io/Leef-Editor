/**
 * Pasting cells from Excel, LibreOffice Calc, Google Sheets or a Word table:
 * the clipboard's plain text is tab-separated values, turned into a GFM table.
 */
import { escapeCell, escapeInline, markdownTable } from "./markdownOut";

/** TSV as spreadsheets write it: cells holding tabs, newlines or quotes are quoted. */
export function parseTsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  const text = source.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  while (i <= text.length) {
    if (cell === "" && text[i] === '"') {
      // Quoted cell: runs to the closing quote, `""` being an escaped quote.
      let j = i + 1;
      let value = "";
      while (j < text.length) {
        if (text[j] === '"' && text[j + 1] === '"') {
          value += '"';
          j += 2;
        } else if (text[j] === '"') break;
        else value += text[j++];
      }
      if (j < text.length && (text[j + 1] === "\t" || text[j + 1] === "\n" || j + 1 === text.length)) {
        cell = value;
        i = j + 1;
        continue;
      }
    }
    const ch = text[i];
    if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || i === text.length) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
    i++;
  }
  return rows;
}

/** A GFM table for tabular clipboard text, or null when it isn't a grid. */
export function tsvToMarkdownTable(source: string): string | null {
  const rows = parseTsv(source);
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (cols < 2 || rows.length === 0) return null;
  const cells = rows.map((r) => r.map((value) => escapeCell(escapeInline(value.replace(/\n/g, " ")))));
  return markdownTable(cells, Array.from({ length: cols }, () => null));
}
