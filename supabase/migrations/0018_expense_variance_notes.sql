-- =====================================================================
-- When an Actual Costs category comes in more than 10% over its
-- estimate, the Expense Report form now requires (and shows) an
-- explanation for that specific line item. Stored as one jsonb object
-- on the expense row — {category: note} — rather than a separate
-- table, since this is a handful of short strings per expense report,
-- not a growing collection that needs its own audit trail (the
-- existing travel_expense_audit_log already records who changed what
-- and when at the whole-record level).
-- =====================================================================

alter table public.travel_expenses add column variance_notes jsonb;
