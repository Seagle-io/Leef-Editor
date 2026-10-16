import { searchNotes, type FileResult, type SearchOutcome, type WorkerRequest } from "./search";

// One search per worker: searchInWorker terminates it on abort or timeout, so it needs no live signal.
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const results: FileResult[] = [];
  const summary = await searchNotes(e.data.notes, e.data.re, (b) => results.push(...b), new AbortController().signal);
  self.postMessage({ results, summary } satisfies SearchOutcome);
};
