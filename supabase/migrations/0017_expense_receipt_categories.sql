-- =====================================================================
-- Tag each uploaded expense receipt to the specific Actual Costs line
-- item it backs (Airfare, Lodging, etc.), so the Expense Report screen
-- can group "actual cost | estimated cost | receipt" per category
-- instead of one flat receipts list at the bottom of the form.
-- Nullable — existing/old receipts (uploaded before this column existed)
-- simply have no category and won't show under any specific row.
-- =====================================================================

alter table public.travel_expense_receipts add column category text;
