# Ironline ERP — UI and UX design

**Look:** colours from the machine shop. Layout blue `#2340A8` (the dye machinists brush on
metal before scribing) for actions, links and selection; safety yellow `#F5C518` only for
things running live (timers, in-progress status, the start button while running); cool steel
greys `#F4F6F9` / `#FFFFFF` for surfaces and graphite `#172230` for text. Typeface: Archivo
(variable width), slightly condensed for headings, tabular figures for every number. No
all-caps labels. The one bold element is the 3D part view, which appears on the part page,
the job page and fills the centre of the operator screen.

**Theme tokens** (`apps/web/src/styles.css`, light and dark): `bg`, `panel`, `panel-2`, `ink`,
`muted`, `line`, `accent`, `live`, `rail`, and status colours `ok`, `warn`, `bad`, `info`, each
with a `-soft` background.

**Layout:** light sidebar grouped by department (Sales · Production · Quality · Supply ·
Finance · Setup), drawer below 1024 px; top bar with global search (press `/`), a Create
menu, assistant, theme and account. Record pages: header with status and actions → stage
track → estimate-vs-actual cost tiles → key fields panel + tabbed detail panel (Files & 3D,
cost, log) → operations and materials. Lists: view tabs (Open / Late / All…) and search
above a table. The operator screen is touch-first: big start/pause, counters with ± buttons,
the part in 3D in the middle, details/material/history on the right.

**Components** (`apps/web/src/components/ui.tsx`): Button (primary / secondary / ghost /
danger), ButtonLink, Input, Select, Textarea, Field (label + hint + error), Card,
PageHeader (with back link), Status pill, Tabs, ViewTabs, StageTrack, CostTile, Table/Td (numbers right-aligned in tabular
figures), Stat tile, Modal (native dialog), SearchBox, ErrorNote, Loading.

**Status colours:** grey = not started (draft, planned, pending, closed); blue = waiting on
someone (sent, released, confirmed, ready); yellow with a dot = running now; amber = paused
or expiring; green = done or won; red = lost, cancelled or late. Late always overrides the normal status in lists.

**Behavior rules:** money is shown in the shop's currency; every price shows its cost and
margin next to it; margins under 15 % are flagged red; forms show field errors from the
server under the field; read-only documents (won quotes) show all details expanded;
nothing refetches silently while a form has unsaved edits.
