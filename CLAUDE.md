# SERVPLUS Office Management CRM

The office manager's CRM (bills, shop purchasing, equipment, owner approvals, renewals, workday). Built 2026-11-25 from the office manager's ChatGPT interview "CRM Brainstorm Interview" and their dashboard picture. It is SEPARATE from the restoration CRM (`E:\Water Damage CRM`); connecting the two comes later.

## Rules
- **No Social Security numbers, ever** (owner's rule). Employees will only track which papers each person turned in.
- Logins later: only the owner + the office manager.
- Same habits as the restoration CRM: "are you sure?" pop-ups before saves (in-app `ask` / `sure`, never native confirm), ‹ back + ✕ Close on windows, the owner is not technical, show mock-ups before visual changes.
- Look = the restoration CRM's blues (`--brand #0b6fb8`, Segoe UI), layout = the office manager's picture (left menu, dashboard cards).

## Running it
- Plain HTML/CSS/JS, no build. Preview: `powershell -File ".claude/serve.ps1" -Port 5190` → http://localhost:5190/ (launch config "office" in the restoration CRM's .claude/launch.json).
- Data: this browser's IndexedDB `servplus-office`, store `data`, key `db`. Practice data (`sample: true`) is added on first run; Dashboard / Management → Remove practice data.

## What works (app.js)
- Dashboard: Weekly Shop Budget ($500, week Friday → Thursday, `weekStart`; Purchased = ordered/received this week, Pending = open requests), Owner Approval, My Workday checklist, Purchase Request Queue, Bills, Shop & Equipment alerts, Sunday Dispatch Updates, Coverage & Time Off.
- Purchasing: requests → Approve / Send to owner / Decline → Mark ordered → Mark received; repeat-order warning (same item ordered in the last 30 days).
- Owner Approvals: Approve / Pay later (date) / Decline, history kept.
- Bills: add, due / late states, Mark paid (monthly bills add next month's), near-30-days-late warning.
- Shop & Equipment: machines with condition, counts per type, parts ordered per machine.
- Insurance & Licenses renewals, Calendar & Coverage (time off + backups), Management (budget, everyday workday list, backup download).
- Not built yet ("Coming next" pages): Employee Requests, Employees, Company Stats (spending stat formula), Vehicles, Resources, Meetings, Help.

## 📄 Smart Scan (scan.js, 2026-11-25)
- "📄 Scan anything" (top bar, Smart Scan page, or drop files anywhere): pictures / PDFs, several at once. The AI says what it is; a check screen shows the document on the left and the details + "Suggested actions" ticks on the right; Confirm & File makes: bill (+ optional owner approval when ≥ $300, her personal comfort level), shop receipt items (received, count in this week's budget), jobsite receipt (`db.receipts`, for stats), renewal / COI / DMV (`db.renewals`), order (matches an open purchase → ordered + delivery date), payment (matches an unpaid bill → paid). Duplicate warning (same bill / same file). Original always kept: IndexedDB store `files` (db v2), list `db.docs`, renamed "Bill - Vendor - MM.DD.YY.ext".
- AI = Edge Function `office-assistant` mode `scan` (Haiku, reads the image / PDF, structured JSON; monthly cap in `office_private`). Until the CRM is online (`window.officeCloud`) answers are PRETEND, guessed from the file name (`scanPretend`), shown with a 🧪 note.
- Setup later (all together): own Supabase project, run supabase/schema.sql, secret ANTHROPIC_API_KEY, deploy office-assistant, logins for the owner + office manager, hosting.

## ✨ Ask SERVPLUS AI side helper (helper.js, 2026-11-25, from the owner's pink picture)
Only for the owner + office manager. Main job: keep her on track (she gets scattered). Right column (`#helper`, 340px, sticky; ≤1100px it slides over the page and starts hidden, ✨ round button bottom right opens it; ✕ hides, remembered in localStorage `office-hp-hidden`). Header ✦ badge (no photo of a real person on purpose), greeting bubble, a pink "Right now" card, then "How can I help you today?" cards: Scan a Document (Smart Scan), Plan My Day, Find Information, Show My Reports, plus "🅿 Got interrupted? Park a thought". Ask box at the bottom with 🎤 (browser speech, else keyboard mic) and ➤.
- **Plan My Day** = ONE task at a time from her own records (`helperTasks`: bills due ≤ 2 days / late, Sunday calls not handed off, owner answers waiting 2+ days, pending shop requests, renewals ≤ 30 days, unticked My Workday items): ✓ Done (workday items tick; others open their screen so "done" is real), Not now (back of the line for today, `db.helper.notNow[day]`), I'm stuck (a tip + Park it / Ask the owner → an approval). Progress bar, Next up, and a nudge after 30 min on one task (`HP_NUDGE_MIN`). Parked thoughts `db.helper.parked` (＋ Today = a workday item, ✓ = remove, asks).
- Ask box: free answers from her records (`hpAnswer`: what now, bills this week, budget, renewals, owner approvals, "park: …", search by words); anything else says the real AI comes once online.

## 🗓 Week + month on My Workday (calendar.js, 2026-11-25)
Under the checklist: "My week" (Mon–Sun, ‹ This week ›) and the month calendar (‹ This month ›). Each weekday has a 🎯 FOCUS subject (her interview: one subject a day; `db.settings.focus`, ✏️ Focus days, defaults `FOCUS_DEFAULT`: Mon dispatch handoff & stats, Tue bills, Wed employees, Thu insurance / licenses / vehicles, Fri shop purchasing & meeting, Sun after-hours dispatch). Days fill in by themselves (`dayItems`): unpaid / paid bills by due date, renewals expiring, owner "pay later" dates, deliveries, time off, Friday purchasing + breakfast, Thursday Red Bulls, Sunday dispatch; plus her own items `db.events` (+ Add on a week day or click a month day → Add; click one to edit / mark done / delete, asks first). Month cells show 3 items + "+N more"; a click opens the whole day.
