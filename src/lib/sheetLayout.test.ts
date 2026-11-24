import { describe, expect, it } from "vitest";
import { planSheets, SHEET_GAP_PX, type MeasuredUnit } from "./sheetLayout";

const geo = { contentPx: 1000, sheetPx: 1100, bodyOffsetPx: 50 };
/** Text top of the second sheet when the first keeps its normal height. */
const secondTop = 50 + 1100 + SHEET_GAP_PX;

function unit(top: number, height: number, target: number, extra: Partial<MeasuredUnit> = {}): MeasuredUnit {
  return { top, height, prevBottom: top, forcedBreak: false, target, unbreakable: false, ...extra };
}

describe("planSheets", () => {
  it("gives an empty document one sheet and no push", () => {
    expect(planSheets([], geo)).toEqual({ pushes: [], sheets: [{ contentTop: 50, height: 1100 }], pageOfUnit: [] });
  });

  it("keeps blocks that fit on the first sheet", () => {
    const plan = planSheets([unit(50, 100, 0), unit(170, 300, 1, { prevBottom: 150 }), unit(490, 200, 2, { prevBottom: 470 })], geo);
    expect(plan.pushes).toEqual([]);
    expect(plan.sheets).toHaveLength(1);
    expect(plan.pageOfUnit).toEqual([0, 0, 0]);
  });

  it("pushes a block crossing the bottom to the next sheet, margin measured from the previous bottom", () => {
    // Previous block ends at 900, this one starts 16px lower (its own margin) and ends past 1050.
    const plan = planSheets([unit(50, 850, 0), unit(916, 200, 1, { prevBottom: 900 }), unit(1136, 50, 2, { prevBottom: 1116 })], geo);
    expect(plan.pushes).toEqual([{ target: 1, marginTop: secondTop - 900 }]);
    expect(plan.sheets).toEqual([
      { contentTop: 50, height: 1100 },
      { contentTop: secondTop, height: 1100 },
    ]);
    expect(plan.pageOfUnit).toEqual([0, 1, 1]);
  });

  it("starts a new sheet after a manual break even when the block fits", () => {
    const plan = planSheets([unit(50, 100, 0), unit(170, 100, 1, { prevBottom: 150, forcedBreak: true })], geo);
    expect(plan.pushes).toEqual([{ target: 1, marginTop: secondTop - 150 }]);
    expect(plan.pageOfUnit).toEqual([0, 1]);
  });

  it("ignores a manual break at the top of a sheet", () => {
    const plan = planSheets([unit(50, 100, 0, { forcedBreak: true })], geo);
    expect(plan.pushes).toEqual([]);
    expect(plan.sheets).toHaveLength(1);
  });

  it("lengthens the sheet of a table taller than a page instead of cutting it", () => {
    const plan = planSheets(
      [unit(50, 100, 0), unit(170, 1300, 1, { prevBottom: 150, unbreakable: true }), unit(1490, 50, 2, { prevBottom: 1470 })],
      geo,
    );
    // The table gets a sheet of its own, 300px longer than a normal one; what follows goes on the next.
    expect(plan.sheets[1]).toEqual({ contentTop: secondTop, height: 1100 + 300 });
    expect(plan.sheets[2].contentTop).toBe(secondTop + 1400 + SHEET_GAP_PX);
    expect(plan.pushes.map((p) => p.target)).toEqual([1, 2]);
    expect(plan.pageOfUnit).toEqual([0, 1, 2]);
  });

  it("cuts a long list between two items, the margin going on the item", () => {
    // List items already measured one by one (the list is taller than a sheet).
    const items = [0, 1, 2, 3, 4].map((i) => unit(50 + i * 240, 230, i, { prevBottom: i === 0 ? 50 : 40 + i * 240 }));
    const plan = planSheets(items, geo);
    // 4 items end at 1000 ≤ 1050; the 5th (1010 → 1240) crosses.
    expect(plan.pushes).toEqual([{ target: 4, marginTop: secondTop - 1000 }]);
    expect(plan.pageOfUnit).toEqual([0, 0, 0, 0, 1]);
  });

  it("puts the margin on the parent when the crossing unit is its first child", () => {
    // Unit 1 is the first item of a list (element 7) that starts near the bottom.
    const plan = planSheets([unit(50, 900, 0), unit(980, 100, 7, { prevBottom: 960 })], geo);
    expect(plan.pushes).toEqual([{ target: 7, marginTop: secondTop - 960 }]);
  });

  it("moves later blocks along with a push", () => {
    const plan = planSheets([unit(50, 980, 0), unit(1040, 100, 1, { prevBottom: 1030 }), unit(1150, 950, 2, { prevBottom: 1140 })], geo);
    // Unit 1 now starts at secondTop; unit 2 follows 10px under its bottom, and crosses again.
    expect(plan.pushes).toEqual([
      { target: 1, marginTop: secondTop - 1030 },
      { target: 2, marginTop: secondTop + 1100 + SHEET_GAP_PX - (1140 + secondTop - 1040) },
    ]);
    expect(plan.sheets.map((s) => s.contentTop)).toEqual([50, secondTop, secondTop + 1100 + SHEET_GAP_PX]);
  });

  it("is deterministic", () => {
    const units = [unit(50, 850, 0), unit(916, 200, 1, { prevBottom: 900, forcedBreak: true }), unit(1136, 1500, 2, { prevBottom: 1116 })];
    expect(planSheets(units, geo)).toEqual(planSheets(units, geo));
    expect(planSheets(units, geo).sheets.length).toBeGreaterThanOrEqual(1);
  });
});
