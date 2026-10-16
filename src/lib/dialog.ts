import { readable, type Readable } from "svelte/store";

export interface PromptOptions { title: string; label: string; value?: string; okLabel?: string; validate?: (v: string) => string | null }
export interface ConfirmOptions { title: string; message: string; okLabel: string; cancelLabel?: string; danger?: boolean }

export type DialogRequest =
  | { kind: "prompt"; options: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "confirm"; options: ConfirmOptions; resolve: (v: boolean) => void };

const queue: DialogRequest[] = [];
let current: DialogRequest | null = null;
let publish: (r: DialogRequest | null) => void = () => {};

export const dialogRequest: Readable<DialogRequest | null> = readable<DialogRequest | null>(null, (set) => {
  publish = set;
  set(current);
  return () => {
    publish = () => {};
  };
});

function advance(): void {
  current = queue.shift() ?? null;
  publish(current);
}

function enqueue(request: DialogRequest): void {
  if (current) queue.push(request);
  else {
    current = request;
    publish(current);
  }
}

export function promptDialog(o: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => enqueue({ kind: "prompt", options: o, resolve }));
}

export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => enqueue({ kind: "confirm", options: o, resolve }));
}

/** Message d'erreur de `validate` pour `value`, ou null si accepté. Un `validate` qui lève = refus explicite. */
export function validatePrompt(o: PromptOptions, value: string): string | null {
  if (!o.validate) return null;
  try {
    return o.validate(value);
  } catch (e) {
    return e instanceof Error && e.message ? e.message : "Valeur refusée.";
  }
}

/** Valide la saisie de la demande courante : renvoie le message de refus (la demande reste ouverte) ou null (résolue, suivante affichée). */
export function submitPrompt(value: string): string | null {
  if (!current || current.kind !== "prompt") return null;
  const error = validatePrompt(current.options, value);
  if (error !== null) return error;
  const done = current;
  advance();
  done.resolve(value);
  return null;
}

/** Résout la demande courante : confirm → `ok` ; prompt → null (annulation). */
export function answerConfirm(ok: boolean): void {
  if (!current || current.kind !== "confirm") return;
  const done = current;
  advance();
  done.resolve(ok);
}

export function cancelDialog(): void {
  if (!current) return;
  const done = current;
  advance();
  if (done.kind === "prompt") done.resolve(null);
  else done.resolve(false);
}
