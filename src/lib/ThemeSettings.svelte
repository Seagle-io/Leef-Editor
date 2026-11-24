<script lang="ts">
  import { createEventDispatcher, tick } from "svelte";
  import { confirmDialog } from "./dialog";
  import { ACCENT_PRESETS, EDITOR_SIZE_RANGE, FONT_PRESETS, NAME_MAX, SIZE_RANGE, type AccentPreset, type Theme, type ThemeBase } from "./themes/model";
  import { activeTheme, deleteTheme, duplicateTheme, editTheme, exportTheme, importTheme, renameTheme, selectTheme, themeState } from "./themes/store";

  /** Popover « Apparence » ouvert ; « Gérer les thèmes… » ouvre la feuille des thèmes. */
  export let open = false;
  /** Bouton Aa de la barre d'outils : le popover s'aligne sur son bord droit, 8 px dessous. */
  export let anchor: HTMLElement | null = null;

  const dispatch = createEventDispatcher<{ close: void }>();
  const IMPORT_MAX = 64 * 1024;
  const BASES: { value: ThemeBase; label: string }[] = [
    { value: "auto", label: "Auto" },
    { value: "light", label: "Clair" },
    { value: "dark", label: "Sombre" },
  ];
  const FONTS: Record<string, string> = { ui: "Système", serif: "Serif", mono: "Mono" };
  const ACCENTS: Record<AccentPreset, string> = {
    seagle: "Seagle",
    blue: "Bleu",
    purple: "Violet",
    pink: "Rose",
    red: "Rouge",
    orange: "Orange",
    green: "Vert",
    graphite: "Graphite",
  };
  /** Design system T002 : Étroite 60ch | Moyenne 68ch | Large 80ch | Pleine. */
  const WIDTHS: { label: string; value: number | null }[] = [
    { label: "Étroite", value: 60 },
    { label: "Moyenne", value: 68 },
    { label: "Large", value: 80 },
    { label: "Pleine", value: null },
  ];
  const LEADINGS: { label: string; value: number }[] = [
    { label: "Serré", value: 1.4 },
    { label: "Normal", value: 1.6 },
    { label: "Aéré", value: 1.8 },
  ];

  let popoverEl: HTMLElement | undefined;
  let sheetEl: HTMLDialogElement | undefined;
  let nameEl: HTMLInputElement | undefined;
  let fileEl: HTMLInputElement | undefined;
  let origin: HTMLElement | null = null;
  let place = "";
  let error: string | null = null;
  let nameDraft = "";
  let nameFor = "";
  let wasOpen = false;

  $: theme = $activeTheme;
  $: if (theme.id !== nameFor) {
    nameFor = theme.id;
    nameDraft = theme.name;
  }
  $: custom = !ACCENT_PRESETS.includes(theme.accent as AccentPreset);
  $: if (open !== wasOpen) void toggled(open);

  async function toggled(now: boolean): Promise<void> {
    wasOpen = now;
    if (!now) return;
    origin = anchor ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    error = null;
    position();
    await tick();
    popoverEl?.querySelector<HTMLElement>("input:checked, input")?.focus();
  }

  function position(): void {
    if (!anchor) {
      place = "";
      return;
    }
    const r = anchor.getBoundingClientRect();
    place = `--anchor-top: ${Math.round(r.bottom)}px; --anchor-right: ${Math.round(window.innerWidth - r.right)}px;`;
  }

  function close(returnFocus: boolean): void {
    dispatch("close");
    if (returnFocus && origin?.isConnected) origin.focus();
  }

  /** Échap ferme et rend le focus au bouton ; Tab boucle du 1er réglage (Thème) au lien « Gérer les thèmes… ». */
  function onPopoverKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== "Tab" || !(e.target instanceof HTMLElement)) return;
    const first = e.target instanceof HTMLInputElement && e.target.name === "ap-base";
    const last = e.target.classList.contains("link-btn");
    if (e.shiftKey ? !first : !last) return;
    e.preventDefault();
    popoverEl?.querySelector<HTMLElement>(e.shiftKey ? ".link-btn" : "input[name=ap-base]:checked, input[name=ap-base]")?.focus();
  }

  function onWindowPointerDown(e: PointerEvent): void {
    if (!open || !(e.target instanceof Node)) return;
    if (popoverEl?.contains(e.target) || anchor?.contains(e.target)) return;
    close(false);
  }

  function accentName(accent: string): string {
    return ACCENT_PRESETS.includes(accent as AccentPreset) ? ACCENTS[accent as AccentPreset] : accent;
  }

  function attempt(action: () => void): void {
    error = null;
    try {
      action();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    void resyncRadios();
  }

  function choose(id: string): void {
    const result = selectTheme(id);
    error = result.ok ? null : result.error.message;
    void resyncRadios();
  }

  /**
   * Un choix refusé laisse coché le radio cliqué : Svelte ne réécrit pas `checked` quand l'état n'a pas changé.
   * Après rendu, chaque radio reprend l'état réel, porté par la classe `on` de son libellé.
   */
  async function resyncRadios(): Promise<void> {
    await tick();
    for (const root of [popoverEl, sheetEl]) {
      root?.querySelectorAll<HTMLInputElement>("input[type=radio]").forEach((radio) => {
        radio.checked = radio.closest("label")?.classList.contains("on") ?? false;
      });
    }
  }

  function patch(change: Partial<Omit<Theme, "id" | "builtin" | "version">>): void {
    attempt(() => void editTheme(theme.id, change));
  }

  /** Valeur de départ du sélecteur libre : l'accent rendu (token hex de tokens.css). */
  function renderedAccent(): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--leef-accent").trim();
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "";
  }

  async function manageThemes(): Promise<void> {
    close(false);
    error = null;
    await tick();
    sheetEl?.showModal();
  }

  function closeSheet(): void {
    if (sheetEl?.open) sheetEl.close();
  }

  function onSheetClose(): void {
    const target = anchor ?? origin;
    if (target?.isConnected) target.focus();
  }

  function commitName(): void {
    if (theme.builtin || nameDraft === theme.name) return;
    const result = renameTheme(theme.id, nameDraft);
    if (result.ok) error = null;
    else {
      error = result.error.message;
      nameDraft = theme.name;
    }
  }

  async function startRename(): Promise<void> {
    await tick();
    nameEl?.focus();
    nameEl?.select();
  }

  async function remove(): Promise<void> {
    const ok = await confirmDialog({
      title: `Supprimer le thème « ${theme.name} » ?`,
      message: "Le thème est supprimé définitivement. Le thème Automatique le remplace.",
      okLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    const result = deleteTheme(theme.id);
    error = result.ok ? null : result.error.message;
  }

  function slug(name: string): string {
    return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "theme";
  }

  function exportCurrent(): void {
    attempt(() => {
      const blob = new Blob([exportTheme(theme.id)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug(theme.name)}.leef-theme.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  }

  async function onImport(): Promise<void> {
    const file = fileEl?.files?.[0];
    if (!file) return;
    error = null;
    if (file.size > IMPORT_MAX) {
      error = "Fichier de thème trop volumineux (64 Kio maximum).";
    } else {
      try {
        const result = importTheme(await file.text());
        if (result.ok) choose(result.value);
        else error = result.error.message;
      } catch (e) {
        error = `Lecture du fichier impossible : ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    if (fileEl) fileEl.value = "";
  }
</script>

<svelte:window on:resize={() => open && position()} on:pointerdown={onWindowPointerDown} />

{#if open}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="popover" role="dialog" aria-label="Apparence" style={place} bind:this={popoverEl} on:keydown={onPopoverKeydown}>
    <div class="setting" role="radiogroup" aria-labelledby="ap-base">
      <span class="setting-label" id="ap-base">Thème</span>
      <div class="segmented">
        {#each BASES as b (b.value)}
          <label class:on={theme.base === b.value}>
            <input type="radio" name="ap-base" checked={theme.base === b.value} on:change={() => patch({ base: b.value })} />{b.label}
          </label>
        {/each}
      </div>
    </div>

    <div class="setting">
      <span class="setting-label" id="ap-accent">Couleur d'accent</span>
      <div class="swatches" role="radiogroup" aria-labelledby="ap-accent">
        {#each ACCENT_PRESETS as a (a)}
          <label class="swatch" data-accent={a} class:on={theme.accent === a} title={ACCENTS[a]}>
            <input type="radio" name="ap-accent" aria-label={ACCENTS[a]} checked={theme.accent === a} on:change={() => patch({ accent: a })} />
          </label>
        {/each}
      </div>
    </div>

    <div class="setting" role="radiogroup" aria-labelledby="ap-font">
      <span class="setting-label" id="ap-font">Police du texte</span>
      <div class="segmented">
        {#each FONT_PRESETS as f (f)}
          <label class:on={theme.contentFont === f} style="font-family: var(--leef-font-{f})">
            <input type="radio" name="ap-font" checked={theme.contentFont === f} on:change={() => patch({ contentFont: f })} />{FONTS[f]}
          </label>
        {/each}
      </div>
    </div>

    <div class="setting">
      <label class="setting-label" for="ap-size">Taille du texte</label>
      <div class="size">
        <span class="small" aria-hidden="true">A</span>
        <input
          id="ap-size"
          type="range"
          min={SIZE_RANGE[0]}
          max={SIZE_RANGE[1]}
          step="1"
          value={theme.size}
          aria-valuetext="{theme.size} pixels"
          on:input={(e) => patch({ size: Number(e.currentTarget.value) })}
        />
        <span class="big" aria-hidden="true">A</span>
        <span class="value" aria-hidden="true">{theme.size} px</span>
      </div>
    </div>

    <div class="setting" role="radiogroup" aria-labelledby="ap-width">
      <span class="setting-label" id="ap-width">Largeur de lecture</span>
      <div class="segmented">
        {#each WIDTHS as w (w.label)}
          <label class:on={theme.lineWidth === w.value}>
            <input type="radio" name="ap-width" checked={theme.lineWidth === w.value} on:change={() => patch({ lineWidth: w.value })} />{w.label}
          </label>
        {/each}
      </div>
    </div>

    <div class="setting" role="radiogroup" aria-labelledby="ap-leading">
      <span class="setting-label" id="ap-leading">Interligne</span>
      <div class="segmented">
        {#each LEADINGS as l (l.label)}
          <label class:on={theme.lineHeight === l.value}>
            <input type="radio" name="ap-leading" checked={theme.lineHeight === l.value} on:change={() => patch({ lineHeight: l.value })} />{l.label}
          </label>
        {/each}
      </div>
    </div>

    {#if error || $themeState.error}
      <p class="error" role="alert">{error ?? $themeState.error}</p>
    {/if}

    <button type="button" class="link-btn" on:click={manageThemes}>Gérer les thèmes…</button>
  </div>
{/if}

<dialog bind:this={sheetEl} class="sheet" aria-labelledby="themes-title" on:close={onSheetClose}>
  <header class="head">
    <h2 id="themes-title">Thèmes</h2>
    <button type="button" class="primary" on:click={closeSheet}>Terminé</button>
  </header>

  <div class="body">
    <fieldset class="themes">
      <legend>Thème actif</legend>
      <ul>
        {#each $themeState.themes as t (t.id)}
          <li>
            <label class="theme" class:on={t.id === theme.id}>
              <input type="radio" name="theme" value={t.id} checked={t.id === theme.id} on:change={() => choose(t.id)} />
              <span class="theme-name">{t.name}</span>
              {#if t.builtin}<span class="tag">intégré</span>{/if}
            </label>
          </li>
        {/each}
      </ul>
      <div class="actions">
        <button type="button" on:click={() => attempt(() => void duplicateTheme(theme.id))}>Dupliquer</button>
        <button type="button" disabled={theme.builtin} title={theme.builtin ? "Un thème intégré ne se renomme pas" : undefined} on:click={startRename}>Renommer</button>
        <button type="button" class="danger" disabled={theme.builtin} title={theme.builtin ? "Un thème intégré ne se supprime pas" : undefined} on:click={remove}>Supprimer</button>
        <button type="button" on:click={() => fileEl?.click()}>Importer…</button>
        <button type="button" on:click={exportCurrent}>Exporter</button>
        <input bind:this={fileEl} class="file" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" on:change={onImport} />
      </div>
    </fieldset>

    <div class="form">
      <div class="setting">
        <label class="setting-label" for="theme-name">Nom</label>
        <input
          id="theme-name"
          bind:this={nameEl}
          class="text"
          type="text"
          maxlength={NAME_MAX}
          readonly={theme.builtin}
          bind:value={nameDraft}
          on:blur={commitName}
          on:keydown={(e) => e.key === "Enter" && commitName()}
        />
        {#if theme.builtin}<p class="help">Modifier un thème intégré en crée une copie.</p>{/if}
      </div>

      <div class="setting">
        <label class="setting-label" for="theme-free">Couleur d'accent libre</label>
        <div class="free">
          <input id="theme-free" type="color" value={custom ? theme.accent : renderedAccent()} on:change={(e) => patch({ accent: e.currentTarget.value })} />
          <span>{accentName(theme.accent)}</span>
        </div>
      </div>

      <div class="setting" role="radiogroup" aria-labelledby="l-efont">
        <span class="setting-label" id="l-efont">Police de l'éditeur</span>
        <div class="segmented">
          {#each FONT_PRESETS as f (f)}
            <label class:on={theme.editorFont === f} style="font-family: var(--leef-font-{f})">
              <input type="radio" name="efont" checked={theme.editorFont === f} on:change={() => patch({ editorFont: f })} />{FONTS[f]}
            </label>
          {/each}
        </div>
      </div>

      <div class="setting">
        <label class="setting-label" for="theme-esize">Taille de l'éditeur</label>
        <div class="size">
          <span class="small" aria-hidden="true">A</span>
          <input
            id="theme-esize"
            type="range"
            min={EDITOR_SIZE_RANGE[0]}
            max={EDITOR_SIZE_RANGE[1]}
            step="1"
            value={theme.editorSize}
            aria-valuetext="{theme.editorSize} pixels"
            on:input={(e) => patch({ editorSize: Number(e.currentTarget.value) })}
          />
          <span class="big" aria-hidden="true">A</span>
          <span class="value" aria-hidden="true">{theme.editorSize} px</span>
        </div>
      </div>
    </div>
  </div>

  {#if error || $themeState.error}
    <p class="error" role="alert">{error ?? $themeState.error}</p>
  {/if}
</dialog>

<style>
  /* Popover hors de la barre d'outils (un ancêtre à backdrop-filter bornerait le flou) : position fixe sous l'ancre. */
  .popover {
    position: fixed;
    z-index: var(--leef-z-popover);
    top: calc(var(--anchor-top, calc(var(--leef-toolbar-h) - var(--leef-space-1) - var(--leef-space-2))) + var(--leef-space-2));
    right: var(--anchor-right, calc(var(--leef-space-3) + 3 * var(--leef-control-h) + 3 * 2px));
    width: 300px;
    max-height: calc(100vh - var(--leef-toolbar-h) - var(--leef-space-4));
    overflow: auto;
    display: grid;
    gap: var(--leef-space-4);
    padding: var(--leef-space-4);
    border-radius: var(--leef-radius-lg);
    background: var(--leef-material-elevated);
    -webkit-backdrop-filter: var(--leef-material-filter);
    backdrop-filter: var(--leef-material-filter);
    box-shadow: var(--leef-shadow-popover);
    color: var(--leef-text);
    font-size: var(--leef-text-13);
    animation: leef-pop var(--leef-dur-base) var(--leef-ease-out);
    transform-origin: top right;
  }
  @keyframes leef-pop {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }
  @media (max-width: 720px) {
    .popover {
      left: var(--leef-space-2);
      right: var(--leef-space-2);
      width: auto;
    }
  }
  .sheet {
    box-sizing: border-box;
    width: min(640px, calc(100vw - 2 * var(--leef-space-2)));
    max-height: calc(100vh - 2 * var(--leef-space-4));
    padding: var(--leef-space-5);
    border: 0;
    border-radius: var(--leef-radius-xl);
    background: var(--leef-material-elevated);
    -webkit-backdrop-filter: var(--leef-material-filter);
    backdrop-filter: var(--leef-material-filter);
    box-shadow: var(--leef-shadow-window);
    color: var(--leef-text);
    font-size: var(--leef-text-13);
    overflow: auto;
  }
  .sheet[open] {
    display: flex;
    flex-direction: column;
    gap: var(--leef-space-4);
    animation: leef-sheet var(--leef-dur-slow) var(--leef-ease-spring);
  }
  .sheet::backdrop {
    background: var(--leef-scrim);
  }
  @keyframes leef-sheet {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.98);
    }
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--leef-space-3);
  }
  h2 {
    margin: 0;
    font-size: var(--leef-text-15);
    font-weight: var(--leef-weight-semibold);
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 200px) minmax(0, 1fr);
    gap: var(--leef-space-5);
  }
  @media (max-width: 520px) {
    .body {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .sheet button {
    min-height: var(--leef-control-h);
    padding: 0 var(--leef-space-3);
    border: 0;
    border-radius: var(--leef-radius-sm);
    background: var(--leef-bg-control);
    color: var(--leef-text);
    font: inherit;
    cursor: default;
    transition: background-color var(--leef-dur-fast) var(--leef-ease-out);
  }
  .sheet button:hover:not(:disabled) {
    background: var(--leef-bg-pressed);
  }
  .sheet button:disabled {
    opacity: 0.4;
  }
  .sheet button.primary {
    background: var(--leef-accent-fill);
    color: var(--leef-text-on-accent);
  }
  .sheet button.danger {
    color: var(--leef-danger);
  }
  :focus-visible {
    outline: 2px solid var(--leef-focus-ring);
    outline-offset: 1px;
  }
  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend,
  .setting-label {
    padding: 0;
    font-size: var(--leef-text-12);
    font-weight: var(--leef-weight-semibold);
    color: var(--leef-text-secondary);
  }
  ul {
    list-style: none;
    margin: var(--leef-space-2) 0;
    padding: 0;
    max-height: 220px;
    overflow: auto;
  }
  .theme {
    display: flex;
    align-items: center;
    gap: var(--leef-space-2);
    min-height: var(--leef-row-h);
    padding: 0 var(--leef-space-2);
    border-radius: var(--leef-radius-sm);
  }
  .theme:hover {
    background: var(--leef-bg-hover);
  }
  .theme.on {
    background: var(--leef-accent-fill);
    color: var(--leef-text-on-accent);
  }
  .theme input,
  .segmented input,
  .swatch input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    margin: 0;
  }
  .theme-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    font-size: var(--leef-text-11);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--leef-space-1);
  }
  .file {
    display: none;
  }
  .form {
    display: grid;
    gap: var(--leef-space-4);
    min-width: 0;
  }
  .setting {
    display: grid;
    gap: var(--leef-space-2);
    min-width: 0;
  }
  .help {
    margin: 0;
    font-size: var(--leef-text-12);
    color: var(--leef-text-secondary);
  }
  .text {
    height: var(--leef-control-h);
    padding: 0 var(--leef-space-2);
    border: var(--leef-hairline) solid var(--leef-border-control);
    border-radius: var(--leef-radius-sm);
    background: var(--leef-bg-content);
    color: var(--leef-text);
    font: inherit;
  }
  .text:focus {
    outline: none;
    box-shadow: var(--leef-shadow-focus);
  }
  .text[readonly] {
    background: var(--leef-bg-code);
    color: var(--leef-text-secondary);
  }
  .segmented {
    display: flex;
    padding: 2px;
    gap: 2px;
    border-radius: var(--leef-radius-md);
    background: var(--leef-bg-control);
  }
  .segmented label {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: var(--leef-control-h-sm);
    padding: 0 var(--leef-space-2);
    border-radius: var(--leef-radius-sm);
    color: var(--leef-text-secondary);
    font-size: var(--leef-text-12);
    white-space: nowrap;
    transition: background-color var(--leef-dur-base) var(--leef-ease-out);
  }
  .segmented label.on {
    background: var(--leef-bg-control-thumb);
    color: var(--leef-text);
    font-weight: var(--leef-weight-medium);
    box-shadow: var(--leef-shadow-thumb);
  }
  .theme:has(input:focus-visible),
  .segmented label:has(input:focus-visible) {
    outline: 2px solid var(--leef-focus-ring);
    outline-offset: 1px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--leef-space-2);
  }
  .swatch {
    position: relative;
    width: var(--leef-control-h-sm);
    height: var(--leef-control-h-sm);
    border-radius: var(--leef-radius-full);
    background: var(--leef-accent);
  }
  .swatch.on {
    box-shadow: 0 0 0 2px var(--leef-bg-elevated), 0 0 0 4px var(--leef-accent);
  }
  /* L'anneau de sélection occupe 2-4 px : le focus clavier se pose au-delà. */
  .swatch:has(input:focus-visible) {
    outline: 2px solid var(--leef-focus-ring);
    outline-offset: 5px;
  }
  .free {
    display: flex;
    align-items: center;
    gap: var(--leef-space-2);
    color: var(--leef-text-secondary);
    font-size: var(--leef-text-12);
  }
  .free input {
    width: var(--leef-control-h);
    height: var(--leef-control-h-sm);
    padding: 0;
    border: 0;
    background: none;
  }
  .size {
    display: flex;
    align-items: center;
    gap: var(--leef-space-2);
    color: var(--leef-text-secondary);
  }
  .size input {
    flex: 1;
    min-width: 0;
    accent-color: var(--leef-accent);
  }
  .small {
    font-size: var(--leef-text-11);
  }
  .big {
    font-size: var(--leef-text-17);
  }
  .value {
    min-width: 36px;
    text-align: right;
    font-size: var(--leef-text-12);
    font-variant-numeric: tabular-nums;
  }
  .link-btn {
    justify-self: start;
    min-height: var(--leef-control-h-sm);
    padding: 0;
    border: 0;
    background: none;
    color: var(--leef-link);
    font: inherit;
    font-size: var(--leef-text-13);
    text-align: left;
    cursor: default;
  }
  .error {
    margin: 0;
    padding: var(--leef-space-2) var(--leef-space-3);
    border-radius: var(--leef-radius-sm);
    background: var(--leef-danger-bg);
    color: var(--leef-danger);
    overflow-wrap: anywhere;
  }
</style>
