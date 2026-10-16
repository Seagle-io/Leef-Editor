import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const store = vi.hoisted(() => {
  const data = new Map<string, string>();
  const fake = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  vi.stubGlobal("localStorage", fake);
  return data;
});

import type { AppCommand } from "./commands";

let m: typeof import("./commands");

function cmd(id: string, extra: Partial<AppCommand> = {}): AppCommand {
  return { id, title: id, group: "Fichier", enabled: () => true, run: () => {}, ...extra };
}

function key(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault: vi.fn(), ...init } as unknown as KeyboardEvent;
}

function platform(value: string): void {
  vi.stubGlobal("navigator", { platform: value });
}

let unregister: () => void = () => {};

beforeEach(async () => {
  unregister();
  unregister = () => {};
  store.clear();
  platform("Linux x86_64");
  vi.resetModules();
  m = await import("./commands");
});

describe("registry", () => {
  it("registers in order, finds by id, unregisters", () => {
    unregister = m.registerCommands([cmd("a"), cmd("b")]);
    expect(get(m.commands).map((c) => c.id)).toEqual(["a", "b"]);
    expect(m.getCommand("b")?.id).toBe("b");
    unregister();
    expect(m.getCommand("a")).toBeUndefined();
  });

  it("throws on duplicate id, across calls and inside one list, without registering", () => {
    unregister = m.registerCommands([cmd("a")]);
    expect(() => m.registerCommands([cmd("a")])).toThrow("Commande en double : a");
    expect(() => m.registerCommands([cmd("x"), cmd("x")])).toThrow("Commande en double : x");
    expect(m.getCommand("x")).toBeUndefined();
  });

  it("reserves the human-decided shortcuts for their ids", () => {
    expect(m.reservedShortcuts["palette.open"]).toBe("Mod-k");
    expect(() => m.registerCommands([cmd("other", { shortcut: { keys: "Mod-Shift-k", scope: "global" } })])).toThrow("Raccourci réservé");
    unregister = m.registerCommands([cmd("palette.open", { shortcut: { keys: "Mod-k", scope: "global" } })]);
    expect(m.getCommand("palette.open")).toBeDefined();
  });

  it("reserves chords, not strings: modifier order, case and repetition do not bypass D2 (T013 D8)", () => {
    for (const keys of ["Shift-Mod-k", "Mod-Shift-K", "Alt-Mod-f", "Mod-Mod-k", "Mod-".repeat(50_000) + "k"]) {
      expect(() => m.registerCommands([cmd("other", { shortcut: { keys, scope: "global" } })]), keys).toThrow("Raccourci réservé");
    }
    expect(m.getCommand("other")).toBeUndefined();
    unregister = m.registerCommands([
      cmd("insert.link", { shortcut: { keys: "Shift-Mod-k", scope: "global" } }),
      cmd("x.empty", { shortcut: { keys: "", scope: "global" } }),
      cmd("x.emoji", { shortcut: { keys: "Mod-😀", scope: "global" } }),
      cmd("x.lone", { shortcut: { keys: "Mod-\uD800", scope: "global" } }),
      cmd("x.rtl", { shortcut: { keys: "Mod-ש", scope: "global" } }),
    ]);
    expect(get(m.commands)).toHaveLength(5);
  });

  it("an old unregister called again does not remove a re-registered command (T013 D9)", () => {
    const off = m.registerCommands([cmd("theme.select.x")]);
    off();
    unregister = m.registerCommands([cmd("theme.select.x", { title: "neuf" })]);
    off();
    expect(m.getCommand("theme.select.x")?.title).toBe("neuf");
  });

  it("an unregister acts once: the same object re-registered survives the old one (T022 F7)", () => {
    const x = cmd("theme.select.a");
    const off = m.registerCommands([x]);
    off();
    unregister = m.registerCommands([x]);
    off();
    expect(m.getCommand("theme.select.a")).toBe(x);
  });

  it("treats hostile ids as opaque: empty, huge, control chars, unicode, RTL", () => {
    const ids = ["", "x".repeat(100_000), "a\u0000b‮\n", "é́😀", "مرحبا"];
    unregister = m.registerCommands(ids.map((id) => cmd(id)));
    for (const id of ids) expect(m.getCommand(id)?.id).toBe(id);
  });
});

describe("runCommand", () => {
  it("runs, awaits, and records recent", async () => {
    const run = vi.fn();
    unregister = m.registerCommands([cmd("a", { run })]);
    expect(await m.runCommand("a")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(get(m.recentCommands)).toEqual(["a"]);
  });

  it("returns false for unknown ids and for disabled m.commands, without running", async () => {
    const run = vi.fn();
    unregister = m.registerCommands([cmd("off", { enabled: () => false, run })]);
    expect(await m.runCommand("off")).toBe(false);
    expect(await m.runCommand("missing")).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(get(m.recentCommands)).toEqual([]);
  });

  it("rethrows run errors and does not record them", async () => {
    unregister = m.registerCommands([cmd("bad", { run: () => Promise.reject(new Error("boom")) })]);
    await expect(m.runCommand("bad")).rejects.toThrow("boom");
    expect(get(m.recentCommands)).toEqual([]);
  });

  it("bounds recent to 8, most recent first, deduplicated, persisted", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
    unregister = m.registerCommands(ids.map((id) => cmd(id)));
    for (const id of ids) await m.runCommand(id);
    await m.runCommand("c5");
    const recent = get(m.recentCommands);
    expect(recent).toHaveLength(8);
    expect(recent[0]).toBe("c5");
    expect(new Set(recent).size).toBe(8);
    expect(JSON.parse(store.get("leef-recent-commands") ?? "[]")).toEqual(recent);
  });

  it("survives a storage that refuses writes: import, run and in-memory recent (T013 D7)", async () => {
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      vi.resetModules();
      const fresh = await import("./commands");
      unregister = fresh.registerCommands([cmd("a")]);
      expect(await fresh.runCommand("a")).toBe(true);
      expect(get(fresh.recentCommands)).toEqual(["a"]);
      expect(setItem).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  it("reports a storage that refuses reads or writes in recentStorageError (T022 F9)", async () => {
    expect(get(m.recentStorageError)).toBeNull();
    const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("bloqué", "SecurityError");
    });
    try {
      vi.resetModules();
      const blocked = await import("./commands");
      expect(get(blocked.recentCommands)).toEqual([]);
      expect(get(blocked.recentStorageError)).toBe("Commandes récentes illisibles : bloqué");
    } finally {
      getItem.mockRestore();
    }
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      vi.resetModules();
      const full = await import("./commands");
      unregister = full.registerCommands([cmd("a")]);
      expect(await full.runCommand("a")).toBe(true);
      expect(get(full.recentCommands)).toEqual(["a"]);
      expect(get(full.recentStorageError)).toBe("Commandes récentes non enregistrées : quota");
    } finally {
      setItem.mockRestore();
    }
    store.set("leef-recent-commands", "{pas du json");
    vi.resetModules();
    const corrupt = await import("./commands");
    expect(get(corrupt.recentCommands)).toEqual([]);
    expect(get(corrupt.recentStorageError)).toMatch(/^Commandes récentes illisibles : /);
  });

  it("a successful write clears the write error, not a read error (T029 G4)", async () => {
    let failures = 1;
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation((k: string, v: string) => {
      if (failures-- > 0) throw new DOMException("quota", "QuotaExceededError");
      store.set(k, v);
    });
    try {
      unregister = m.registerCommands([cmd("a"), cmd("b")]);
      await m.runCommand("a");
      expect(get(m.recentStorageError)).toBe("Commandes récentes non enregistrées : quota");
      await m.runCommand("b");
      expect(store.get("leef-recent-commands")).toBe('["b","a"]');
      expect(get(m.recentStorageError)).toBeNull();
    } finally {
      setItem.mockRestore();
    }
    store.set("leef-recent-commands", "{pas du json");
    vi.resetModules();
    const corrupt = await import("./commands");
    expect(store.get("leef-recent-commands")).toBe("[]");
    expect(get(corrupt.recentStorageError)).toMatch(/^Commandes récentes illisibles : /);
  });
});

describe("matchShortcut", () => {
  it("Mod is Ctrl on PC and rejects Meta", () => {
    expect(m.matchShortcut(key({ key: "k", ctrlKey: true }), "Mod-k")).toBe(true);
    expect(m.matchShortcut(key({ key: "k", metaKey: true }), "Mod-k")).toBe(false);
  });

  it("Mod is Meta on Mac and rejects Ctrl", () => {
    platform("MacIntel");
    expect(m.matchShortcut(key({ key: "k", metaKey: true }), "Mod-k")).toBe(true);
    expect(m.matchShortcut(key({ key: "k", ctrlKey: true }), "Mod-k")).toBe(false);
  });

  it("Shift and Alt are exact", () => {
    expect(m.matchShortcut(key({ key: "K", ctrlKey: true, shiftKey: true }), "Mod-Shift-k")).toBe(true);
    expect(m.matchShortcut(key({ key: "k", ctrlKey: true }), "Mod-Shift-k")).toBe(false);
    expect(m.matchShortcut(key({ key: "k", ctrlKey: true, shiftKey: true }), "Mod-k")).toBe(false);
    expect(m.matchShortcut(key({ key: "f", ctrlKey: true, altKey: true }), "Mod-Alt-f")).toBe(true);
    expect(m.matchShortcut(key({ key: "f", ctrlKey: true }), "Mod-Alt-f")).toBe(false);
  });

  it("matches Alt-rewritten keys on e.code (Mac)", () => {
    platform("MacIntel");
    expect(m.matchShortcut(key({ key: "ƒ", code: "KeyF", metaKey: true, altKey: true }), "Mod-Alt-f")).toBe(true);
  });

  it("AZERTY: the e.code fallback needs Alt, so Mod-z / Mod-a never match Mod-w / Mod-q (T013 D2)", () => {
    expect(m.matchShortcut(key({ key: "z", code: "KeyW", ctrlKey: true }), "Mod-w")).toBe(false);
    expect(m.matchShortcut(key({ key: "a", code: "KeyQ", ctrlKey: true }), "Mod-q")).toBe(false);
    expect(m.matchShortcut(key({ key: "z", code: "KeyW", ctrlKey: true }), "Mod-z")).toBe(true);
    platform("MacIntel");
    expect(m.matchShortcut(key({ key: "z", code: "KeyW", metaKey: true }), "Mod-w")).toBe(false);
    expect(m.matchShortcut(key({ key: "ƒ", code: "KeyF", metaKey: true, altKey: true }), "Mod-Alt-f")).toBe(true);
  });

  it("non-Latin layouts fall back on e.code, AZERTY still does not (T022 F3)", () => {
    expect(m.matchShortcut(key({ key: "ы", code: "KeyS", ctrlKey: true }), "Mod-s")).toBe(true);
    expect(m.matchShortcut(key({ key: "ς", code: "KeyW", ctrlKey: true }), "Mod-w")).toBe(true);
    expect(m.matchShortcut(key({ key: "ל", code: "KeyK", ctrlKey: true }), "Mod-k")).toBe(true);
    expect(m.matchShortcut(key({ key: "Ы", code: "KeyS", ctrlKey: true, shiftKey: true }), "Mod-Shift-s")).toBe(true);
    expect(m.matchShortcut(key({ key: "ы", code: "KeyS", ctrlKey: true }), "Mod-w")).toBe(false);
    expect(m.matchShortcut(key({ key: "😀", code: "KeyK", ctrlKey: true }), "Mod-k")).toBe(true);
    expect(m.matchShortcut(key({ key: "z", code: "KeyW", ctrlKey: true }), "Mod-w")).toBe(false);
    expect(m.matchShortcut(key({ key: "z", code: "KeyW", ctrlKey: true }), "Mod-z")).toBe(true);
    expect(m.matchShortcut(key({ key: "ы", code: "", ctrlKey: true }), "Mod-s")).toBe(false);
    expect(m.matchShortcut(key({ key: "ы", code: "KeyS", ctrlKey: true }), "Mod-ы")).toBe(true);
  });

  it("AltGr (Ctrl+Alt on Windows) typing a symbol is no shortcut: Hungarian or Czech AltGr+F is « [ » (T029 G1)", () => {
    expect(m.matchShortcut(key({ key: "[", code: "KeyF", ctrlKey: true, altKey: true }), "Mod-Alt-f")).toBe(false);
    expect(m.matchShortcut(key({ key: "€", code: "KeyE", ctrlKey: true, altKey: true }), "Mod-Alt-e")).toBe(false);
    expect(m.matchShortcut(key({ key: "😀", code: "KeyF", ctrlKey: true, altKey: true }), "Mod-Alt-f")).toBe(false);
    expect(m.matchShortcut(key({ key: " ", code: "KeyF", ctrlKey: true, altKey: true }), "Mod-Alt-f")).toBe(false);
    expect(m.matchShortcut(key({ key: "а", code: "KeyF", ctrlKey: true, altKey: true }), "Mod-Alt-f")).toBe(true);
    expect(m.matchShortcut(key({ key: "Dead", code: "KeyF", ctrlKey: true, altKey: true }), "Mod-Alt-f")).toBe(true);
    expect(m.matchShortcut(key({ key: "ś", code: "KeyS", ctrlKey: true, altKey: true }), "Mod-Alt-s")).toBe(true);
    expect(m.matchShortcut(key({ key: "ы", code: "KeyS", ctrlKey: true }), "Mod-s")).toBe(true);
    const search = vi.fn();
    unregister = m.registerCommands([cmd("folder.search", { shortcut: { keys: "Mod-Alt-f", scope: "global" }, run: search })]);
    const altGr = key({ key: "[", code: "KeyF", ctrlKey: true, altKey: true });
    expect(m.handleGlobalKeydown(altGr)).toBe(false);
    expect(altGr.preventDefault).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    platform("MacIntel");
    expect(m.matchShortcut(key({ key: "ƒ", code: "KeyF", metaKey: true, altKey: true }), "Mod-Alt-f")).toBe(true);
  });

  it("AZERTY Ctrl+Z does not run the Mod-w global command (T013 D2)", () => {
    const close = vi.fn();
    unregister = m.registerCommands([cmd("file.close", { shortcut: { keys: "Mod-w", scope: "global" }, run: close })]);
    expect(m.handleGlobalKeydown(key({ key: "z", code: "KeyW", ctrlKey: true }))).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("rejects empty, malformed and hostile keys", () => {
    expect(m.matchShortcut(key({ key: "k", ctrlKey: true }), "")).toBe(false);
    expect(m.matchShortcut(key({ key: "k", ctrlKey: true }), "Mod-")).toBe(false);
    expect(m.matchShortcut(key({ key: "\u0000", ctrlKey: true }), "Mod-k")).toBe(false);
    expect(m.matchShortcut(key({ key: "é", ctrlKey: true }), "Mod-é")).toBe(true);
    expect(m.matchShortcut(key({ key: "😀", ctrlKey: true }), "Mod-k")).toBe(false);
    expect(m.matchShortcut(key({ key: "k", ctrlKey: true }), "Mod-".repeat(50_000) + "k")).toBe(true);
  });
});

describe("handleGlobalKeydown", () => {
  const global = { keys: "Mod-s", scope: "global" } as const;

  it("runs the first enabled matching global command and prevents default", async () => {
    const first = vi.fn();
    const second = vi.fn();
    unregister = m.registerCommands([
      cmd("off", { shortcut: global, enabled: () => false }),
      cmd("on", { shortcut: global, run: first }),
      cmd("later", { shortcut: global, run: second }),
    ]);
    const e = key({ key: "s", ctrlKey: true });
    expect(m.handleGlobalKeydown(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("ignores defaultPrevented events and editor-scope shortcuts", () => {
    const run = vi.fn();
    unregister = m.registerCommands([cmd("g", { shortcut: global, run }), cmd("e", { shortcut: { keys: "Mod-b", scope: "editor" }, run })]);
    expect(m.handleGlobalKeydown(key({ key: "s", ctrlKey: true, defaultPrevented: true }))).toBe(false);
    expect(m.handleGlobalKeydown(key({ key: "b", ctrlKey: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("formatShortcut", () => {
  it("formats for Mac and PC", () => {
    expect(m.formatShortcut("Mod-Shift-s", true)).toBe("⌘⇧S");
    expect(m.formatShortcut("Mod-Shift-s", false)).toBe("Ctrl+Maj+S");
    expect(m.formatShortcut("Mod-Alt-f", true)).toBe("⌘⌥F");
    expect(m.formatShortcut("Mod-Alt-f", false)).toBe("Ctrl+Alt+F");
  });

  it("survives empty input", () => {
    expect(m.formatShortcut("", true)).toBe("");
  });
});
