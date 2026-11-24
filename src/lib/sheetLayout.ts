/**
 * Page mode, editable: the rendered blocks stay in one editable flow and the
 * sheets are painted behind it. A page break is only a `margin-top` on the
 * first block of each sheet — no node is ever moved. This module decides
 * those margins from measured block positions; it never touches the DOM.
 */

/** Space between two sheets on screen (the old `.pages` gap, 1.5rem). */
export const SHEET_GAP_PX = 24;

export interface SheetGeometry {
  /** Height available to the text on one sheet. */
  contentPx: number;
  /** Full sheet height. */
  sheetPx: number;
  /** From the top of a sheet to the top of its text (margin + header band). */
  bodyOffsetPx: number;
}

export interface MeasuredUnit {
  /** Border box, in px, relative to the flow, with no push applied. */
  top: number;
  height: number;
  /** Bottom of the previous sibling's border box; first child: top of the parent's content. */
  prevBottom: number;
  /** Preceded by a manual `.page-break`. */
  forcedBreak: boolean;
  /** Index of the element that takes the margin (the unit itself; its parent for a first child). */
  target: number;
  /** TABLE, IMG, PRE, `.mermaid`, or not splittable. */
  unbreakable: boolean;
}

/** In flow coordinates; `height` grows past `sheetPx` when a block can't fit on one sheet. */
export interface Sheet {
  contentTop: number;
  height: number;
}

export interface LayoutPlan {
  pushes: { target: number; marginTop: number }[];
  sheets: Sheet[];
  pageOfUnit: number[];
}

/**
 * A unit that runs past the bottom of its sheet, or follows a manual break,
 * starts the next sheet — unless it already heads its sheet. A unit taller
 * than a sheet lengthens its sheet instead of being cut.
 */
export function planSheets(units: MeasuredUnit[], geo: SheetGeometry): LayoutPlan {
  const { contentPx, sheetPx, bodyOffsetPx } = geo;
  const sheets: Sheet[] = [{ contentTop: bodyOffsetPx, height: sheetPx }];
  const pushes: LayoutPlan["pushes"] = [];
  const pageOfUnit: number[] = [];
  // How far the pushes placed so far have moved everything below them.
  let shift = 0;
  let sheetEmpty = true;

  for (const unit of units) {
    let sheet = sheets[sheets.length - 1];
    const contentBottom = sheet.contentTop + contentPx + (sheet.height - sheetPx);
    if (!sheetEmpty && (unit.forcedBreak || unit.top + shift + unit.height > contentBottom)) {
      sheet = { contentTop: sheet.contentTop + sheet.height + SHEET_GAP_PX, height: sheetPx };
      sheets.push(sheet);
      pushes.push({ target: unit.target, marginTop: sheet.contentTop - (unit.prevBottom + shift) });
      shift = sheet.contentTop - unit.top;
    }

    const overflow = unit.top + shift + unit.height - (sheet.contentTop + contentPx);
    if (overflow > 0) sheet.height = Math.max(sheet.height, sheetPx + overflow);

    pageOfUnit.push(sheets.length - 1);
    sheetEmpty = false;
  }

  return { pushes, sheets, pageOfUnit };
}
