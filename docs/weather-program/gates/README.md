# Pre-registered gates

One gate per candidate, written before the candidate runs.

- `gates/<id>.md` is the gate. Start from `TEMPLATE.md`.
- `results/<id>.md` is the result. It must be committed in a LATER commit than its gate.
- `backend/scripts/gate_order_check.py` enforces both: the gate file exists, has every required field, and its first
  commit is a strict ancestor of the result's first commit.

Why: a threshold chosen after the numbers is not a gate (LESSONS L-S1, L-S6). The pre-registration is only evidence if
git can show it came first.
