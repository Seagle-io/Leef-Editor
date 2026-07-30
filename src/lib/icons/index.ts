// Icons from RemixIcon (https://remixicon.com, Apache-2.0). Only the
// specific icons GMD uses are copied in here — not the whole package.
import chevronDown from "./chevronDown.svg?raw";
import chevronRight from "./chevronRight.svg?raw";
import file from "./file.svg?raw";
import folder from "./folder.svg?raw";
import folderOpen from "./folderOpen.svg?raw";
import refresh from "./refresh.svg?raw";
import sidebar from "./sidebar.svg?raw";
import split from "./split.svg?raw";
import bold from "./bold.svg?raw";
import bulletList from "./bulletList.svg?raw";
import check from "./check.svg?raw";
import close from "./close.svg?raw";
import code from "./code.svg?raw";
import codeBlock from "./codeBlock.svg?raw";
import copy from "./copy.svg?raw";
import cut from "./cut.svg?raw";
import dangerAdmonition from "./dangerAdmonition.svg?raw";
import exportIcon from "./export.svg?raw";
import focusEnter from "./focusEnter.svg?raw";
import focusExit from "./focusExit.svg?raw";
import font from "./font.svg?raw";
import footnote from "./footnote.svg?raw";
import h1 from "./h1.svg?raw";
import h2 from "./h2.svg?raw";
import h3 from "./h3.svg?raw";
import hr from "./hr.svg?raw";
import italic from "./italic.svg?raw";
import link from "./link.svg?raw";
import lock from "./lock.svg?raw";
import maximize from "./maximize.svg?raw";
import menu from "./menu.svg?raw";
import minimize from "./minimize.svg?raw";
import newIcon from "./new.svg?raw";
import noteAdmonition from "./noteAdmonition.svg?raw";
import open from "./open.svg?raw";
import orderedList from "./orderedList.svg?raw";
import page from "./page.svg?raw";
import paste from "./paste.svg?raw";
import print from "./print.svg?raw";
import quote from "./quote.svg?raw";
import save from "./save.svg?raw";
import search from "./search.svg?raw";
import strikethrough from "./strikethrough.svg?raw";
import successAdmonition from "./successAdmonition.svg?raw";
import table from "./table.svg?raw";
import theme from "./theme.svg?raw";
import tipAdmonition from "./tipAdmonition.svg?raw";
import toc from "./toc.svg?raw";
import unlock from "./unlock.svg?raw";
import warningAdmonition from "./warningAdmonition.svg?raw";

export const icons = {
  chevronDown,
  chevronRight,
  file,
  folder,
  folderOpen,
  refresh,
  sidebar,
  split,
  bold,
  bulletList,
  check,
  close,
  code,
  codeBlock,
  copy,
  cut,
  dangerAdmonition,
  export: exportIcon,
  focusEnter,
  focusExit,
  font,
  footnote,
  h1,
  h2,
  h3,
  hr,
  italic,
  link,
  lock,
  maximize,
  menu,
  minimize,
  new: newIcon,
  noteAdmonition,
  open,
  orderedList,
  page,
  paste,
  print,
  quote,
  save,
  search,
  strikethrough,
  successAdmonition,
  table,
  theme,
  tipAdmonition,
  toc,
  unlock,
  warningAdmonition,
} as const;

export type IconName = keyof typeof icons;
