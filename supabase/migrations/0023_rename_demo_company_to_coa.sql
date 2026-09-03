-- =====================================================================
-- Rebrand the seeded demo company from "Axiom Forward Consulting" to
-- "Cyber Offset Alliance". Only updates rows that still carry the old
-- name, so any real prospect's own display_company_name (set at signup,
-- see 0015) is untouched.
-- =====================================================================

update public.customers
  set name = 'Cyber Offset Alliance'
  where name = 'Axiom Forward Consulting';

update public.billing_nodes
  set label = 'Cyber Offset Alliance'
  where node_type = 'Customer' and label = 'Axiom Forward Consulting';

update public.personas
  set description = replace(description, 'Axiom Forward Consulting', 'Cyber Offset Alliance')
  where description like '%Axiom Forward Consulting%';
