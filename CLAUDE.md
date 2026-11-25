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
