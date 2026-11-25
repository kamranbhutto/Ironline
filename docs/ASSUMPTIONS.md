# Ironline ERP — Assumptions

Decisions made without asking, so work could continue. Change any of them and the design
adapts.

1. **Product:** a multi-tenant SaaS sold to many shops (not a single in-house system).
2. **Name:** "Ironline" is a working name. Check trademarks before launch; it is set in
   one place (`packages/shared/src/brand.ts`).
3. **Target customers:** job shops and contract manufacturers — CNC machining, sheet metal,
   fabrication, light assembly — mostly make-to-order with some make-to-stock.
4. **Units and currency:** each organization picks one currency (default USD) and works in
   metric or imperial; multi-currency comes later.
5. **Costing method:** standard estimate at quote time, actual cost from logged labor ×
   rates plus material at receipt cost, drawn from lots oldest first (FIFO). Material
   picked beyond the stock on hand is costed at the job's material unit cost.
6. **Accounting:** Ironline handles invoices and AR; the general ledger stays in the
   customer's accounting system (sync in phase 4).
7. **Competitor research:** Fulcrum's public website, YouTube channel titles and public
   click-through product demos were studied (`docs/research/`), paraphrased, along with
   screenshots and screen recordings the user supplied, as workflow references only. No source code, private documentation, UI
   designs, text or API object models were copied; layouts, components, names and data
   model are our own, based on standard manufacturing ERP practice.
8. **Hosting:** any Linux server with Node.js and PostgreSQL; development on this laptop.
9. **AI provider:** a hosted large-language-model API with tool use, behind our own assistant name; the provider can be swapped.
10. **Quality balloons are placed by hand.** Clicking on the drawing places a balloon; the
    app does not read dimensions or GD&T from the drawing. Automatic ballooning would need
    reliable PDF/vector text extraction and is left for later.
11. **Balloons link to routing steps by step number** (10, 20, 30…), because routing rows
    are rewritten when a part is saved. If the routing is reordered, check the plan's steps.
    A balloon with no step, or a step the job does not have, is checked at the job's last
    operation.
12. **Each job keeps a copy of the plan** made when the job is created. Later plan edits do
    not change existing jobs. A job made before its part had a plan can take the plan from
    its Quality tab, until the first reading is saved; after that the job's plan is locked.
13. **Sampling:** "first + every N" checks piece 1 and pieces N, 2N, 3N… Pieces are
    numbered 1 to the job quantity; operators pick the piece number they are measuring.
14. **Pass/fail is decided by the server** from the job's copy of the limits (inclusive).
    Notes and visual checks are pass/fail chosen by the operator.
15. **Cpk** uses the sample standard deviation of all readings for a balloon on that job
    and the nearer limit; it is shown only with two or more differing readings.
16. **The inspection report** is our own first-article report layout. It is not presented
    as compliant with any customer or industry form standard.
17. **Title-block tolerances** (X ±0.5, X.X ±0.25, X.XX ±0.1, X.XXX ±0.005, angles ±0.5) are
    fixed defaults for now; a per-shop setting comes later.
18. **Picking never blocks the floor.** Picks take the oldest lots of the item first; any
    amount beyond the stock on hand (or for a free-text material) is recorded as an
    untracked pick. Lots never go below zero.
19. **Returns go back where they came from:** into the lots that job line drew from, newest
    first; anything left is an untracked return that does not add stock.
20. **Remnants** come off the job's picked quantity and become a new lot that keeps the
    parent lot's cost, heat number, supplier and certificate. Size is free text; quantity is
    in the material's own unit (e.g. inches of bar, square feet of sheet). The remnant takes
    the details of the newest lot the job line drew from; if a job mixed lots, check the heat
    number on the remnant.
21. **Receiving does not change a part's standard cost** (quotes keep using it). Lot cost is
    used for inventory value and job actual cost.
22. **Stock take uses CSV, not Excel files.** Rows are matched by lot id; a lot whose
    quantity moved after the sheet was downloaded is flagged before saving.
23. **Moves are whole-lot moves.** Splitting part of a lot to another location comes later.
24. **On order** on the Inventory page is what is still to arrive on draft, sent and partly
    received purchase orders.
25. **Buying plan buckets (our own definitions):** "To buy" = the plan says buy more than 0;
    "Can't arrive in time" = stock runs out before an order placed today would arrive (today +
    the primary vendor's lead time); "Urgent" = runs out within 7 days, or an urgent (priority
    90) job is short; "Covered" = nothing to buy up to the chosen date.
26. **To buy** = minimum on hand (reorder point) − (on hand + on order − job demand up to the
    date), never below 0, raised to the vendor's minimum order (or the item's reorder
    quantity). Jobs with no due date count as needed now.
27. **Draft orders count as on order**, so the plan does not recommend the same purchase twice;
    the plan names the draft. Cancelling a draft brings the recommendation back.
28. **Only bought items and raw materials** are planned; made parts are not bought.
29. **Receiving:** only sent or partly received orders can be received; each catalogue line
    becomes a new lot at the order line's price with the vendor as supplier. Receiving more
    than ordered is refused (raise the order first). Free-text lines are counted but not
    stocked. An order with anything received cannot be cancelled.
30. **No emailing yet:** "Mark as sent" only changes the status; print or save the PDF and
    send it yourself. Vendor units of measure (buying in sheets, stocking in sq ft) come later.
31. **A receipt with no location** goes where the item's latest lot is kept, else the first
    location.
32. **Reports read fixed datasets**, not free SQL: each dataset is a read-only query limited to
    the user's shop; grouping and totals are done in the browser (up to 20,000 rows).
33. **Reports are shared** by everyone in the shop; viewers can open but not save or delete.
34. **Piece jobs** are made for every made-in-house part in a job's materials, numbered after
    the assembly job, due the same day, same priority. A part that contains itself is skipped.
35. **The whole assembly waits for all its pieces** (no partial start with some pieces).
36. **Standard cost of made parts** spreads setup over a batch of 10 pieces, the same basis as
    the part page's cost per piece; it updates when the part or a piece is saved, not when a
    work-center rate changes (run db:recost then).
37. **Packing works on the part's bounding box** (length × width × height) with the six
    straight turns. That is exact for box-like parts and a safe (low) count for odd shapes.
38. **Packing units are millimetres and kilograms**, stored on the part; a 3D model's units
    are read as millimetres (the viewer does the same).
39. **Carton price** for made-to-size cartons = board area of a regular slotted carton blank
    (2L + 2W + 35 mm glue flap) × (H + W) × board price per m², plus 0.35 converting cost.
    Board grades, prices and weights are typical starting values in `packing.ts`.
40. **Carton stacking strength** uses the McKee short formula (5.87 × ECT × √(caliper ×
    perimeter)) with a safety factor of 5 by default; totes and crates are not strength-checked.
41. **Returnable payback** assumes 250 working days a year and 10% spare containers; freight is
    included on both sides of the comparison.
42. **The starter packaging library** is added the first time a shop opens Packaging; its
    prices are placeholders.
43. **One person can run several jobs at once** (for example a cutter and an injection
    press). Each timer costs its own work center's rate; starting a timer only replaces the
    same person's timer on that same operation (setup → run). The operator screen lists the
    person's other running jobs.
44. **What happens at the planned time is set per work center**: keep running (default),
    stop the timer, or finish the step. Setup timers stop at the planned setup time; run,
    labor and machine timers at run hours per piece × job quantity, counting everyone's time
    on that step. "Finish the step" counts the rest of the job's pieces good and readies the
    next step. The server checks every 15 seconds and whenever a floor screen loads, and ends
    the timer at the exact moment the plan ran out.
45. **No work starts on a job's first step until its material is picked**: every raw-material
    line fully picked (the same rule as the board's "Material not picked" mark). Setup, labor
    and machine timers are all blocked; later steps are not checked again. Outside services do
    not need picking.
