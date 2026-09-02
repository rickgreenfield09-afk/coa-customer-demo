-- =====================================================================
-- Rename the customer_admin persona's DISPLAY text to "Prime" and
-- rewrite its description to name the actual responsibility (final
-- travel authorization + contract financial management on behalf of
-- the Prime contractor). The underlying slug/role string stays
-- "customer_admin" everywhere else (RLS policies across several
-- migrations, customer_users.role, JS checks like isCustomerAdmin())
-- — renaming that too would touch a lot of security-critical policy
-- text for a change that's purely cosmetic. customer_viewer is left
-- in the table (nothing references it by FK from elsewhere that this
-- would break) but is filtered out of the role-picker UI in app.js,
-- so only Employee/Supervisor/Prime are selectable going forward.
-- =====================================================================

update public.personas set
  display_role = 'Prime',
  description = 'Acting as the Prime contractor''s authorized representative — give final authorization on travel requests before they can be expensed, and manage contract financials (SLINs, funding mods, ODC commitments) for your company.'
where slug = 'customer_admin';
