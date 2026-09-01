// COA Customer Demo — burndown.js
// Contract Data screen ("Contract Data" nav item), ported from the COA
// Employee Portal's screen-burndown.js: Customers/Contracts/Contacts CRUD,
// the Billing Tree (billing_nodes, self-referencing) with SLIN detail
// (funding ledger), the SLIN Table (filterable existing-SLIN view + bulk
// multi-row SLIN/funding entry), and Rates (labor_categories +
// employee_rates). Gated to Supervisor / Customer Admin (migration 0010),
// not platform-admin-only like the source app — see app.js
// updateNavVisibility().
//
// NOT ported: the SLIN employee-authorization ledger (bdLoadAuthorizations/
// bdShowAddAuthForm/bdSubmitAddAuth/bdRevokeAuthorization and the
// slin_employee_authorization table) — that table doesn't exist in this
// app's schema and is explicitly out of scope for this port.
//
// Schema differences from the pilot portal (see migration 0010's header
// comment and supabase/migrations/0001_core_schema.sql): this app's
// contracts/billing_nodes/slins/slin_funding_history/customers/
// contract_contacts have no created_by/entered_by_admin_id/updated_by/
// billable columns, customers has only (customer_id, name,
// is_default_demo_company, created_at) — no customer_type/cage_code/uei/
// address/is_active — and slins has no contract_type column. Rates'
// employee_rates has no pay_rate column (bill_rate/bill_rate_with_fee
// only) and employee_rates.employee_id references demo_employees, not
// profiles, so the Rates employee picker pulls from demo_employees
// (template rows — owner_profile_id is null — since those are what the
// seeded employee_rates rows actually reference) instead of the pilot
// portal's org-wide profiles list.

var burndown = {
  // Customers & Contracts subtab
  customers: [],
  contractsByCustomer: {},
  pendingNewCustomerContractId: null,
  // Billing Tree subtab
  treeContracts: [],
  treeSelectedContractId: null,
  treeContractCustomerId: null,
  nodes: [],
  nodesById: {},
  nodeChildren: {},
  expandedNodeIds: {},
  selectedNodeId: null,
  slinOptionYearByNode: {},
  treeOptionYearFilter: '',
  currentSlin: null,
  // SLIN Table subtab
  stContracts: [],
  stSelectedContractId: null,
  stSelectedCustomerId: null,
  stExistingSlins: [],
  stLatestFundingBySlin: {},
  stOptionYearFilter: '',
  // Rates subtab
  laborCategories: [],
  ratesSelectedEmployeeId: null,
  ratesAllSlins: null,
  employees: null,
  // Bulk SLIN entry widget instances, keyed by an arbitrary instanceKey
  bulk: {},
  // Deep-link target for loadBurndownScreen(contractId, nodeId) — consumed
  // (and cleared) inside bdLoadTree() once the tree for that contract loads.
  deepLinkContractId: null,
  deepLinkNodeId: null
};

// Entry point — called by app.js's switchScreen('burndown') and by the
// Dashboard drill-down popups (openClinDetail/openOdcDetail in
// dashboard.js) for a deep link straight to a contract's Billing Tree,
// optionally with one node pre-selected/expanded.
function loadBurndownScreen(contractId, nodeId){
  if(!contractId){
    burndown.deepLinkContractId = null;
    burndown.deepLinkNodeId = null;
    switchBurndownSubtab('customers');
    return;
  }
  burndown.deepLinkContractId = contractId;
  burndown.deepLinkNodeId = nodeId || null;
  switchBurndownSubtab('tree');
}

// ---------- Subtab switcher ----------
function switchBurndownSubtab(name){
  document.querySelectorAll('#screen-burndown .bd-subscreen').forEach(function(s){ s.classList.remove('active'); });
  document.querySelectorAll('#screen-burndown [data-bdsubtab]').forEach(function(b){ b.classList.toggle('active', b.dataset.bdsubtab === name); });
  document.getElementById('bd-' + name).classList.add('active');
  if(name === 'customers'){ bdLoadCustomers(); }
  if(name === 'tree'){
    burndown.treeSelectedContractId = null;
    burndown.treeContractCustomerId = null;
    burndown.selectedNodeId = null;
    burndown.expandedNodeIds = {};
    document.getElementById('bd-tree-panel').innerHTML = '';
    document.getElementById('bd-detail-panel').innerHTML = '';
    bdLoadTreeContractPicker();
  }
  if(name === 'slintable'){
    burndown.stSelectedContractId = null;
    burndown.stSelectedCustomerId = null;
    burndown.stExistingSlins = [];
    burndown.stLatestFundingBySlin = {};
    document.getElementById('bd-st-existing-wrap').innerHTML = '';
    document.getElementById('bd-st-bulk-wrap').innerHTML = '';
    bdLoadSlinTableContractPicker();
  }
  if(name === 'rates'){
    burndown.ratesSelectedEmployeeId = null;
    document.getElementById('bd-rates-list').innerHTML = '';
    bdLoadRatesTab();
  }
}

// ---------- Shared small render helpers ----------
function bdInput(label, id, value, type){
  return '<div><label class="field-label">' + label + '</label><input type="' + (type || 'text') + '" id="' + id + '" class="field-input" value="' + escAttr(value == null ? '' : value) + '"></div>';
}
function bdSelect(label, id, options, selected){
  return '<div><label class="field-label">' + label + '</label><select id="' + id + '" class="field-input">'
    + options.map(function(o){ return '<option value="' + escAttr(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + o.label + '</option>'; }).join('')
    + '</select></div>';
}
function bdCheckboxRow(label, id, checked){
  return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><label class="field-label" style="margin:0;" for="' + id + '">' + label + '</label></div>';
}
function bdMoney(v){
  if(v == null || v === ''){ return '—'; }
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function bdVal(id){
  var el = document.getElementById(id);
  return el ? el.value : '';
}
function bdChecked(id){
  var el = document.getElementById(id);
  return el ? el.checked : false;
}

// ---------- Shared employee cache (Rates tab's employee picker —
// employee_rates.employee_id references demo_employees; only template
// rows (owner_profile_id null) are used, matching what the seeded
// employee_rates rows reference and what RLS lets every guest read) ----------
async function bdFetchEmployees(){
  if(burndown.employees){ return burndown.employees; }
  var { data, error } = await supabaseClient.from('demo_employees').select('id,full_name').is('owner_profile_id', null).order('full_name');
  if(error){ throw error; }
  burndown.employees = data || [];
  return burndown.employees;
}

// ---------- Shared constants (used across Customers, Tree, and SLIN Table) ----------
var bdContractTypes = ['CPFF', 'COST', 'FFP', 'T&M'];
var bdSlinCategories = ['Labor/Fee', 'ODC/Cost', 'Materials'];
var bdContactRoles = ['Technical POC', 'Contractual POC', 'Security POC', 'Billing POC'];
var bdLineItemLabels = ['SLIN', 'CLIN'];
var bdNodeTypesForAdd = ['Task Order', 'SLIN', 'Indirect Pool'];

// ---------- Contract Contacts (shared by Add Contract, Edit Contract, and
// the Add Customer "also add first contract" flow) ----------
function bdContactFieldsGrid(prefix, existingByRole){
  return bdContactRoles.map(function(role){
    var c = (existingByRole && existingByRole[role]) || {};
    var key = prefix + '-' + role.replace(/\s+/g, '');
    return '<div class="bd-nested-section">'
      + '<div class="tk-section-title">' + role + '</div>'
      + '<input type="hidden" id="' + key + '-id" value="' + escAttr(c.contact_id || '') + '">'
      + '<div class="asset-form-grid">'
      + bdInput('Name', key + '-name', c.name)
      + bdInput('Email', key + '-email', c.email)
      + bdInput('Phone', key + '-phone', c.phone)
      + '</div></div>';
  }).join('');
}

async function bdFetchContactsForContract(contractId){
  var { data, error } = await supabaseClient.from('contract_contacts').select('*').eq('contract_id', contractId);
  if(error){ throw error; }
  var byRole = {};
  (data || []).forEach(function(r){ byRole[r.contact_role] = { contact_id: r.contact_id, name: r.name, email: r.email, phone: r.phone }; });
  return byRole;
}

// Upserts one row per role that has a Name filled in — PATCH if that role
// already had a contact (hidden -id field populated), POST otherwise.
// Blank roles are left alone (no delete UI, matching the rest of the app).
async function bdSaveContactsForContract(contractId, prefix){
  for(var i = 0; i < bdContactRoles.length; i++){
    var role = bdContactRoles[i];
    var key = prefix + '-' + role.replace(/\s+/g, '');
    var name = bdVal(key + '-name');
    if(!name){ continue; }
    var existingId = bdVal(key + '-id');
    var email = bdVal(key + '-email') || null;
    var phone = bdVal(key + '-phone') || null;
    if(existingId){
      var { error } = await supabaseClient.from('contract_contacts').update({ name: name, email: email, phone: phone }).eq('contact_id', existingId);
      if(error){ throw error; }
    }else{
      var { error: insErr } = await supabaseClient.from('contract_contacts').insert({
        contract_id: contractId, contact_role: role, name: name, email: email, phone: phone
      });
      if(insErr){ throw insErr; }
    }
  }
}

// =============================================================
// CUSTOMERS + CONTRACTS
// =============================================================

async function bdLoadCustomers(){
  var container = document.getElementById('bd-customers-list');
  try{
    var { data, error } = await supabaseClient.from('customers').select('*').order('name');
    if(error){ throw error; }
    burndown.customers = data || [];
    bdRenderCustomerList();
  }catch(e){
    container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load customers</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
    console.error(e);
  }
}

function bdRenderCustomerList(){
  var container = document.getElementById('bd-customers-list');
  var addBtnHtml = '<div class="tk-grid-actions" style="justify-content:flex-start;margin-bottom:16px;"><button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdShowAddCustomerForm()">+ Add Customer</button></div>'
    + '<div id="bd-add-customer-form-wrap"></div>';

  if(!burndown.customers.length){
    container.innerHTML = addBtnHtml + '<div class="tk-empty">No customers yet.</div>';
    return;
  }

  container.innerHTML = addBtnHtml + burndown.customers.map(function(c){
    return '<div class="tk-entry-card bd-row-card">'
      + '<div class="bd-row-summary" onclick="bdToggleCustomerRow(\'' + c.customer_id + '\')">'
      + '<div><div class="bd-row-title">' + escAttr(c.name) + '</div>'
      + (c.is_default_demo_company ? '<div class="bd-row-sub">Default demo company</div>' : '') + '</div>'
      + '</div>'
      + '<div class="bd-row-expand" id="bd-customer-expand-' + c.customer_id + '"></div>'
      + '</div>';
  }).join('');
}

function bdToggleCustomerRow(customerId){
  var wrap = document.getElementById('bd-customer-expand-' + customerId);
  if(!wrap){ return; }
  if(wrap.classList.contains('open')){
    wrap.classList.remove('open');
    wrap.innerHTML = '';
    return;
  }
  wrap.classList.add('open');
  bdRenderCustomerDetail(customerId);
}

function bdRenderCustomerDetail(customerId){
  var c = burndown.customers.find(function(x){ return x.customer_id === customerId; });
  var wrap = document.getElementById('bd-customer-expand-' + customerId);
  if(!c || !wrap){ return; }
  wrap.innerHTML = '<div class="bd-detail-inline">'
    + '<div class="asset-form-grid">'
    + bdInput('Name', 'bdc-name-' + customerId, c.name)
    + '</div>'
    + '<div class="tk-grid-actions">'
    + '<button class="btn-cancel" onclick="bdToggleCustomerRow(\'' + customerId + '\')">Close</button>'
    + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSaveCustomer(\'' + customerId + '\')">Save</button>'
    + '</div>'
    + '<div class="login-error" id="bdc-error-' + customerId + '"></div>'
    + '<div class="bd-nested-section"><div class="tk-section-title">Contracts</div><div id="bd-contracts-for-' + customerId + '"><div class="tk-empty">Loading...</div></div></div>'
    + '</div>';
  bdLoadContractsForCustomer(customerId);
}

async function bdSaveCustomer(customerId){
  var errorEl = document.getElementById('bdc-error-' + customerId);
  var name = bdVal('bdc-name-' + customerId);
  if(!name){ errorEl.textContent = 'Name is required.'; return; }
  try{
    var { error } = await supabaseClient.from('customers').update({ name: name }).eq('customer_id', customerId);
    if(error){ throw error; }
    await bdLoadCustomers();
  }catch(e){
    errorEl.textContent = 'Could not save — try again.';
    console.error(e);
  }
}

function bdShowAddCustomerForm(){
  var wrap = document.getElementById('bd-add-customer-form-wrap');
  wrap.innerHTML = '<div class="tk-entry-card bd-add-form">'
    + '<div class="asset-form-grid">'
    + bdInput('Name', 'bdc-new-name', '')
    + '</div>'
    + bdCheckboxRow('Also add this customer\'s first contract now — POCs, and SLINs/funding straight from a Task Order or Mod document', 'bdc-new-includecontract', false)
    + '<div id="bdc-new-contract-wrap"></div>'
    + '<div class="tk-grid-actions">'
    + '<button class="btn-cancel" onclick="document.getElementById(\'bd-add-customer-form-wrap\').innerHTML=\'\';burndown.pendingNewCustomerContractId=null;delete burndown.bulk.newcust;">Cancel</button>'
    + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddCustomer()">Add Customer</button>'
    + '</div>'
    + '<div class="login-error" id="bdc-new-error"></div>'
    + '</div>';
  document.getElementById('bdc-new-includecontract').addEventListener('change', bdToggleNewCustomerContractSection);
}

function bdToggleNewCustomerContractSection(){
  var wrap = document.getElementById('bdc-new-contract-wrap');
  if(!bdChecked('bdc-new-includecontract')){
    wrap.innerHTML = '';
    burndown.pendingNewCustomerContractId = null;
    delete burndown.bulk.newcust;
    return;
  }
  burndown.pendingNewCustomerContractId = crypto.randomUUID();
  wrap.innerHTML = '<div class="bd-nested-section">'
    + '<div class="tk-section-title">Contract</div>'
    + '<div class="asset-form-grid">'
    + bdInput('Prime Contract #', 'bdc-new-k-pcn', '')
    + bdInput('Delivery Order #', 'bdc-new-k-don', '')
    + bdInput('Subcontract #', 'bdc-new-k-scn', '')
    + bdSelect('Contract Type', 'bdc-new-k-type', bdContractTypes.map(function(t){ return { value: t, label: t }; }), bdContractTypes[0])
    + bdInput('Fee Type', 'bdc-new-k-feetype', '')
    + bdInput('Fee % (default)', 'bdc-new-k-fee', '', 'number')
    + bdSelect('Line Item Label', 'bdc-new-k-lineitem', bdLineItemLabels.map(function(t){ return { value: t, label: t }; }), bdLineItemLabels[0])
    + bdInput('Issuing Organization', 'bdc-new-k-issuer', '')
    + bdInput('DPAS Priority Rating', 'bdc-new-k-dpas', '')
    + bdInput('Payment Terms', 'bdc-new-k-terms', '')
    + '</div>'
    + '<div class="tk-section-title" style="margin-top:16px;">Contract Contacts</div>'
    + bdContactFieldsGrid('bdc-new-contacts', null)
    + '<div class="tk-section-title" style="margin-top:16px;">SLINs (optional — add now, straight off the document, or later from the Billing Tree / SLIN Table)</div>'
    + '<div id="bdc-new-bulk-wrap"></div>'
    + '</div>';
  bdBulkInit('newcust', 'bdc-new-bulk-wrap', burndown.pendingNewCustomerContractId, null, null, true);
}

// Builds the { slin_code, slin_desc, category, ... } row payload the
// bd_bulk_add_slins RPC expects out of a bulk instance's staged rows.
// Numeric fields are passed as raw strings — the RPC casts them, so a
// blank field becomes SQL NULL via nullif() instead of JS parseFloat
// silently producing NaN.
function bdBulkRowsPayload(instanceKey){
  var state = burndown.bulk[instanceKey];
  if(!state){ return []; }
  return state.rows.filter(function(r){ return r.slinCode; }).map(function(r){
    return {
      slin_code: r.slinCode,
      slin_desc: r.slinDesc || null,
      category: r.category,
      option_year: r.optionYear || null,
      pop_start: r.popStart || null,
      pop_end: r.popEnd || null,
      prev_funding: r.prevFunding || null,
      award_total: r.awardTotal || null,
      cum_total: r.cumTotal || null
    };
  });
}

// When a contract's included, the whole submit (customer + contract +
// contacts + any staged SLINs) goes through one atomic RPC call — see
// bd_add_customer_with_contract in migration 0010. Without a contract, a
// plain customer insert is already a single atomic row, so no RPC needed.
async function bdSubmitAddCustomer(){
  var errorEl = document.getElementById('bdc-new-error');
  var name = bdVal('bdc-new-name');
  if(!name){ errorEl.textContent = 'Name is required.'; return; }
  var includeContract = bdChecked('bdc-new-includecontract');
  try{
    if(!includeContract){
      var { error } = await supabaseClient.from('customers').insert({ name: name });
      if(error){ throw error; }
    }else{
      if(burndown.bulk.newcust){ bdBulkSyncFromDom('newcust'); }
      var bulkRows = bdBulkRowsPayload('newcust');
      var bulkState = burndown.bulk.newcust;

      var { error: rpcErr } = await supabaseClient.rpc('bd_add_customer_with_contract', {
        payload: {
          name: name,
          contract: {
            prime_contract_number: bdVal('bdc-new-k-pcn') || null,
            delivery_order_number: bdVal('bdc-new-k-don') || null,
            subcontract_number: bdVal('bdc-new-k-scn') || null,
            contract_type: bdVal('bdc-new-k-type'),
            fee_type: bdVal('bdc-new-k-feetype') || null,
            fee_percentage: bdVal('bdc-new-k-fee') || null,
            line_item_label: bdVal('bdc-new-k-lineitem') || null,
            issuing_organization: bdVal('bdc-new-k-issuer') || null,
            dpas_priority_rating: bdVal('bdc-new-k-dpas') || null,
            payment_terms: bdVal('bdc-new-k-terms') || null,
            contacts: bdCollectContactsPayload('bdc-new-contacts')
          },
          bulk: bulkRows.length ? {
            mod_number: bulkState ? bulkState.modNumber : null,
            mod_date: bulkState ? bulkState.modDate : null,
            source_document: bulkState ? bulkState.sourceDocument : null,
            rows: bulkRows
          } : null
        }
      });
      if(rpcErr){ throw rpcErr; }
    }

    document.getElementById('bd-add-customer-form-wrap').innerHTML = '';
    burndown.pendingNewCustomerContractId = null;
    delete burndown.bulk.newcust;
    await bdLoadCustomers();
  }catch(e){
    errorEl.textContent = 'Could not add customer — nothing was saved (this runs as one transaction). Try again.';
    console.error(e);
  }
}

// ---- Contracts (nested under a customer) ----

async function bdLoadContractsForCustomer(customerId){
  var container = document.getElementById('bd-contracts-for-' + customerId);
  if(!container){ return; }
  try{
    var { data, error } = await supabaseClient.from('contracts').select('*').eq('customer_id', customerId).order('prime_contract_number');
    if(error){ throw error; }
    bdRenderContractsForCustomer(customerId, data || []);
  }catch(e){
    container.innerHTML = '<div class="tk-empty">Couldn\'t load contracts.</div>';
    console.error(e);
  }
}

function bdRenderContractsForCustomer(customerId, rows){
  var container = document.getElementById('bd-contracts-for-' + customerId);
  if(!container){ return; }
  var addBtn = '<button class="btn-edit" onclick="bdShowAddContractForm(\'' + customerId + '\')">+ Add Contract</button>'
    + '<div id="bd-add-contract-form-wrap-' + customerId + '"></div>';

  var listHtml = rows.length
    ? rows.map(function(k){
        return '<div class="bd-row-card-nested">'
          + '<div class="bd-row-summary" onclick="bdToggleContractRow(\'' + k.contract_id + '\')">'
          + '<div><div class="bd-row-title">' + escAttr(k.prime_contract_number || k.subcontract_number || '(unnumbered)') + '</div>'
          + '<div class="bd-row-sub">' + escAttr(k.contract_type) + ' · ' + escAttr(k.status) + (k.issuing_organization ? (' · ' + escAttr(k.issuing_organization)) : '') + '</div></div>'
          + '</div>'
          + '<div class="bd-row-expand" id="bd-contract-expand-' + k.contract_id + '"></div>'
          + '</div>';
      }).join('')
    : '<div class="tk-empty">No contracts for this customer yet.</div>';

  container.innerHTML = addBtn + listHtml;
  // Keep the fetched rows accessible to bdToggleContractRow/bdSaveContract without a second round trip.
  burndown.contractsByCustomer[customerId] = rows;
}

function bdShowAddContractForm(customerId){
  var wrap = document.getElementById('bd-add-contract-form-wrap-' + customerId);
  wrap.innerHTML = '<div class="bd-add-form">'
    + '<div class="asset-form-grid">'
    + bdInput('Prime Contract #', 'bdk-new-pcn-' + customerId, '')
    + bdInput('Delivery Order #', 'bdk-new-don-' + customerId, '')
    + bdInput('Subcontract #', 'bdk-new-scn-' + customerId, '')
    + bdSelect('Contract Type', 'bdk-new-type-' + customerId, bdContractTypes.map(function(t){ return { value: t, label: t }; }), bdContractTypes[0])
    + bdInput('Fee Type', 'bdk-new-feetype-' + customerId, '')
    + bdInput('Fee % (default)', 'bdk-new-fee-' + customerId, '', 'number')
    + bdSelect('Line Item Label', 'bdk-new-lineitem-' + customerId, bdLineItemLabels.map(function(t){ return { value: t, label: t }; }), bdLineItemLabels[0])
    + bdInput('Issuing Organization', 'bdk-new-issuer-' + customerId, '')
    + bdInput('DPAS Priority Rating', 'bdk-new-dpas-' + customerId, '')
    + bdInput('Payment Terms', 'bdk-new-terms-' + customerId, '')
    + '</div>'
    + '<div class="tk-section-title" style="margin-top:16px;">Contract Contacts</div>'
    + bdContactFieldsGrid('bdk-new-contacts-' + customerId, null)
    + '<div class="tk-grid-actions">'
    + '<button class="btn-cancel" onclick="document.getElementById(\'bd-add-contract-form-wrap-' + customerId + '\').innerHTML=\'\'">Cancel</button>'
    + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddContract(\'' + customerId + '\')">Add Contract</button>'
    + '</div>'
    + '<div class="login-error" id="bdk-new-error-' + customerId + '"></div>'
    + '</div>';
}

// Collects the 4-role contacts grid into the [{role,name,email,phone}]
// shape the bd_add_contract/bd_add_customer_with_contract RPCs expect —
// only roles with a Name filled in are included.
function bdCollectContactsPayload(prefix){
  return bdContactRoles.map(function(role){
    var key = prefix + '-' + role.replace(/\s+/g, '');
    var name = bdVal(key + '-name');
    if(!name){ return null; }
    return { role: role, name: name, email: bdVal(key + '-email') || null, phone: bdVal(key + '-phone') || null };
  }).filter(Boolean);
}

// One atomic RPC (bd_add_contract) instead of a contract insert followed by
// separate contact inserts — a failure partway no longer leaves a contract
// with no contacts or vice versa. See migration 0010.
async function bdSubmitAddContract(customerId){
  var errorEl = document.getElementById('bdk-new-error-' + customerId);
  try{
    var { error } = await supabaseClient.rpc('bd_add_contract', {
      payload: {
        customer_id: customerId,
        prime_contract_number: bdVal('bdk-new-pcn-' + customerId) || null,
        delivery_order_number: bdVal('bdk-new-don-' + customerId) || null,
        subcontract_number: bdVal('bdk-new-scn-' + customerId) || null,
        contract_type: bdVal('bdk-new-type-' + customerId),
        fee_type: bdVal('bdk-new-feetype-' + customerId) || null,
        fee_percentage: bdVal('bdk-new-fee-' + customerId) || null,
        line_item_label: bdVal('bdk-new-lineitem-' + customerId) || null,
        issuing_organization: bdVal('bdk-new-issuer-' + customerId) || null,
        dpas_priority_rating: bdVal('bdk-new-dpas-' + customerId) || null,
        payment_terms: bdVal('bdk-new-terms-' + customerId) || null,
        contacts: bdCollectContactsPayload('bdk-new-contacts-' + customerId)
      }
    });
    if(error){ throw error; }
    document.getElementById('bd-add-contract-form-wrap-' + customerId).innerHTML = '';
    await bdLoadContractsForCustomer(customerId);
  }catch(e){
    errorEl.textContent = 'Could not add contract — nothing was saved (this runs as one transaction). Try again.';
    console.error(e);
  }
}

async function bdToggleContractRow(contractId){
  var wrap = document.getElementById('bd-contract-expand-' + contractId);
  if(!wrap){ return; }
  if(wrap.classList.contains('open')){
    wrap.classList.remove('open');
    wrap.innerHTML = '';
    return;
  }
  wrap.classList.add('open');
  var k = null;
  Object.keys(burndown.contractsByCustomer).some(function(custId){
    var found = burndown.contractsByCustomer[custId].find(function(x){ return x.contract_id === contractId; });
    if(found){ k = found; }
    return !!found;
  });
  if(!k){ return; }
  wrap.innerHTML = '<div class="tk-empty">Loading...</div>';
  var contactsByRole = {};
  try{ contactsByRole = await bdFetchContactsForContract(contractId); }catch(e){ console.error(e); }
  wrap.innerHTML = '<div class="bd-detail-inline">'
    + '<div class="asset-form-grid">'
    + bdInput('Prime Contract #', 'bdk-pcn-' + contractId, k.prime_contract_number)
    + bdInput('Delivery Order #', 'bdk-don-' + contractId, k.delivery_order_number)
    + bdInput('Subcontract #', 'bdk-scn-' + contractId, k.subcontract_number)
    + bdSelect('Contract Type', 'bdk-type-' + contractId, bdContractTypes.map(function(t){ return { value: t, label: t }; }), k.contract_type)
    + bdInput('Fee Type', 'bdk-feetype-' + contractId, k.fee_type)
    + bdInput('Fee % (default)', 'bdk-fee-' + contractId, k.fee_percentage, 'number')
    + bdSelect('Line Item Label', 'bdk-lineitem-' + contractId, bdLineItemLabels.map(function(t){ return { value: t, label: t }; }), k.line_item_label)
    + bdInput('Issuing Organization', 'bdk-issuer-' + contractId, k.issuing_organization)
    + bdInput('DPAS Priority Rating', 'bdk-dpas-' + contractId, k.dpas_priority_rating)
    + bdInput('Payment Terms', 'bdk-terms-' + contractId, k.payment_terms)
    + bdSelect('Status', 'bdk-status-' + contractId, [{value:'active',label:'Active'},{value:'closed',label:'Closed'},{value:'on_hold',label:'On Hold'}], k.status)
    + '</div>'
    + '<div class="tk-section-title" style="margin-top:16px;">Contract Contacts</div>'
    + bdContactFieldsGrid('bdk-contacts-' + contractId, contactsByRole)
    + '<div class="tk-grid-actions">'
    + '<button class="btn-cancel" onclick="bdToggleContractRow(\'' + contractId + '\')">Close</button>'
    + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSaveContract(\'' + contractId + '\',\'' + k.customer_id + '\')">Save</button>'
    + '</div>'
    + '<div class="login-error" id="bdk-error-' + contractId + '"></div>'
    + '</div>';
}

async function bdSaveContract(contractId, customerId){
  var errorEl = document.getElementById('bdk-error-' + contractId);
  try{
    var { error } = await supabaseClient.from('contracts').update({
      prime_contract_number: bdVal('bdk-pcn-' + contractId) || null,
      delivery_order_number: bdVal('bdk-don-' + contractId) || null,
      subcontract_number: bdVal('bdk-scn-' + contractId) || null,
      contract_type: bdVal('bdk-type-' + contractId),
      fee_type: bdVal('bdk-feetype-' + contractId) || null,
      fee_percentage: bdVal('bdk-fee-' + contractId) ? parseFloat(bdVal('bdk-fee-' + contractId)) : null,
      line_item_label: bdVal('bdk-lineitem-' + contractId),
      issuing_organization: bdVal('bdk-issuer-' + contractId) || null,
      dpas_priority_rating: bdVal('bdk-dpas-' + contractId) || null,
      payment_terms: bdVal('bdk-terms-' + contractId) || null,
      status: bdVal('bdk-status-' + contractId)
    }).eq('contract_id', contractId);
    if(error){ throw error; }
    await bdSaveContactsForContract(contractId, 'bdk-contacts-' + contractId);
    await bdLoadContractsForCustomer(customerId);
  }catch(e){
    errorEl.textContent = 'Could not save — try again.';
    console.error(e);
  }
}

// =============================================================
// BILLING TREE (billing_nodes + slins + funding)
// =============================================================

function bdExpandToNode(nodeId){
  var n = burndown.nodesById[nodeId];
  while(n && n.parent_node_id){
    burndown.expandedNodeIds[n.parent_node_id] = true;
    n = burndown.nodesById[n.parent_node_id];
  }
}

async function bdLoadTreeContractPicker(){
  var wrap = document.getElementById('bd-tree-contract-picker');
  try{
    var { data, error } = await supabaseClient.from('contracts').select('contract_id,customer_id,prime_contract_number,subcontract_number,customers(name)').order('prime_contract_number');
    if(error){ throw error; }
    burndown.treeContracts = data || [];
    var options = '<option value="">Select a contract...</option>' + burndown.treeContracts.map(function(k){
      var custName = k.customers && k.customers.name ? k.customers.name : 'Unknown Customer';
      var label = custName + ' — ' + (k.prime_contract_number || k.subcontract_number || '(unnumbered)');
      return '<option value="' + k.contract_id + '">' + escAttr(label) + '</option>';
    }).join('');
    wrap.innerHTML = '<select class="field-input" id="bd-tree-contract-select" style="max-width:480px;" onchange="bdOnTreeContractChange()">' + options + '</select>';

    if(burndown.deepLinkContractId){
      var select = document.getElementById('bd-tree-contract-select');
      select.value = burndown.deepLinkContractId;
      bdOnTreeContractChange();
    }
  }catch(e){
    wrap.innerHTML = '<div class="tk-empty">Couldn\'t load contracts.</div>';
    console.error(e);
  }
}

function bdOnTreeContractChange(){
  var contractId = bdVal('bd-tree-contract-select');
  burndown.treeSelectedContractId = contractId || null;
  var contractRow = burndown.treeContracts.find(function(k){ return k.contract_id === contractId; });
  burndown.treeContractCustomerId = contractRow ? contractRow.customer_id : null;
  burndown.selectedNodeId = null;
  burndown.expandedNodeIds = {};
  if(!contractId){
    document.getElementById('bd-tree-panel').innerHTML = '';
    document.getElementById('bd-detail-panel').innerHTML = '';
    return;
  }
  bdLoadTree(contractId);
}

async function bdLoadTree(contractId){
  var treePanel = document.getElementById('bd-tree-panel');
  treePanel.innerHTML = '<div class="tk-empty">Loading...</div>';
  try{
    var { data: nodes, error } = await supabaseClient.from('billing_nodes').select('*').eq('contract_id', contractId).order('sort_order');
    if(error){ throw error; }
    burndown.nodes = nodes || [];
    burndown.nodesById = {};
    burndown.nodeChildren = {};
    burndown.nodes.forEach(function(n){ burndown.nodesById[n.node_id] = n; });
    burndown.nodes.forEach(function(n){
      var key = n.parent_node_id || '__root__';
      if(!burndown.nodeChildren[key]){ burndown.nodeChildren[key] = []; }
      burndown.nodeChildren[key].push(n);
    });

    var { data: slinRows, error: slinErr } = await supabaseClient.from('slins').select('billing_node_id,option_year').eq('contract_id', contractId);
    if(slinErr){ throw slinErr; }
    burndown.slinOptionYearByNode = {};
    (slinRows || []).forEach(function(s){ burndown.slinOptionYearByNode[s.billing_node_id] = s.option_year; });
    burndown.treeOptionYearFilter = '';

    var deepNodeId = burndown.deepLinkNodeId;
    burndown.deepLinkContractId = null;
    burndown.deepLinkNodeId = null;
    if(deepNodeId){ bdExpandToNode(deepNodeId); }

    bdRenderTree();
    if(deepNodeId && burndown.nodesById[deepNodeId]){ bdSelectNode(deepNodeId); }
  }catch(e){
    treePanel.innerHTML = '<div class="tk-empty">Couldn\'t load the billing tree.</div>';
    console.error(e);
  }
}

// Filter is SLIN-level (option_year lives on slins, not billing_nodes) —
// when active, a node is visible if it's a matching SLIN or an ancestor
// of one, so the tree stays navigable instead of showing orphaned leaves.
function bdComputeVisibleNodeIds(){
  if(!burndown.treeOptionYearFilter){ return null; }
  var visible = {};
  burndown.nodes.forEach(function(n){
    if(n.node_type === 'SLIN' && burndown.slinOptionYearByNode[n.node_id] === burndown.treeOptionYearFilter){
      var cur = n;
      while(cur){
        visible[cur.node_id] = true;
        cur = cur.parent_node_id ? burndown.nodesById[cur.parent_node_id] : null;
      }
    }
  });
  return visible;
}

function bdRenderTree(){
  var treePanel = document.getElementById('bd-tree-panel');
  var roots = burndown.nodeChildren['__root__'] || [];
  var visibleSet = bdComputeVisibleNodeIds();

  var years = {};
  Object.keys(burndown.slinOptionYearByNode).forEach(function(nodeId){ var y = burndown.slinOptionYearByNode[nodeId]; if(y){ years[y] = true; } });
  var yearOptions = '<option value="">All Option Years</option>' + Object.keys(years).sort().map(function(y){
    return '<option value="' + escAttr(y) + '"' + (y === burndown.treeOptionYearFilter ? ' selected' : '') + '>' + escAttr(y) + '</option>';
  }).join('');
  var filterHtml = Object.keys(years).length
    ? '<select class="field-input" style="margin-bottom:12px;" onchange="burndown.treeOptionYearFilter=this.value;bdRenderTree();">' + yearOptions + '</select>'
    : '';

  var addRootBtn = '<button class="btn-edit" style="margin-bottom:12px;" onclick="bdShowAddNodeForm(null)">+ Add Top-Level Node</button>'
    + '<div id="bd-add-node-form-wrap-root"></div>';
  var visibleRoots = visibleSet ? roots.filter(function(n){ return visibleSet[n.node_id]; }) : roots;
  if(!visibleRoots.length){
    treePanel.innerHTML = filterHtml + addRootBtn + '<div class="tk-empty">' + (visibleSet ? 'No SLINs match that option year.' : 'No billing nodes under this contract yet.') + '</div>';
    return;
  }
  treePanel.innerHTML = filterHtml + addRootBtn + '<div class="bd-tree">' + visibleRoots.map(function(n){ return bdNodeRowHtml(n, 0, visibleSet); }).join('') + '</div>';
}

function bdNodeRowHtml(node, depth, visibleSet){
  var kids = burndown.nodeChildren[node.node_id] || [];
  if(visibleSet){ kids = kids.filter(function(k){ return visibleSet[k.node_id]; }); }
  var hasKids = kids.length > 0;
  var isOpen = !!burndown.expandedNodeIds[node.node_id];
  var isSelected = node.node_id === burndown.selectedNodeId;
  var caret = hasKids ? (isOpen ? '&#9662;' : '&#9656;') : '';
  var optionYear = burndown.slinOptionYearByNode[node.node_id];
  var html = '<div class="bd-tree-row' + (isSelected ? ' selected' : '') + '" style="padding-left:' + (depth * 20 + 10) + 'px;">'
    + '<span class="bd-tree-caret" onclick="bdToggleNodeExpand(\'' + node.node_id + '\')">' + caret + '</span>'
    + '<span class="bd-tree-label" onclick="bdSelectNode(\'' + node.node_id + '\')">' + escAttr(node.label) + '</span>'
    + (optionYear ? '<span class="bd-tree-type-tag">' + escAttr(optionYear) + '</span>' : '')
    + '<span class="bd-tree-type-tag">' + escAttr(node.node_type) + '</span>'
    + '</div>';
  if(hasKids && isOpen){
    html += kids.map(function(k){ return bdNodeRowHtml(k, depth + 1, visibleSet); }).join('');
  }
  return html;
}

function bdToggleNodeExpand(nodeId){
  burndown.expandedNodeIds[nodeId] = !burndown.expandedNodeIds[nodeId];
  bdRenderTree();
}

function bdSelectNode(nodeId){
  burndown.selectedNodeId = nodeId;
  burndown.expandedNodeIds[nodeId] = true;
  bdRenderTree();
  bdRenderNodeDetail(nodeId);
}

// ---- Add node (+ SLIN fields inline when node_type === 'SLIN') ----

function bdShowAddNodeForm(parentNodeId){
  var wrapId = parentNodeId ? ('bd-add-node-form-wrap-' + parentNodeId) : 'bd-add-node-form-wrap-root';
  var wrap = document.getElementById(wrapId);
  if(!wrap){ return; }
  wrap.innerHTML = '<div class="bd-add-form">'
    + bdSelect('Node Type', 'bdn-new-type', bdNodeTypesForAdd.map(function(t){ return { value: t, label: t }; }), 'Task Order')
    + '<div class="asset-form-grid">'
    + bdInput('Label', 'bdn-new-label', '')
    + bdInput('Code', 'bdn-new-code', '')
    + bdInput('Sort Order', 'bdn-new-sort', '0', 'number')
    + bdInput('Effective Start', 'bdn-new-effstart', '', 'date')
    + bdInput('Effective End', 'bdn-new-effend', '', 'date')
    + '</div>'
    + bdCheckboxRow('Leaf node (no children expected)', 'bdn-new-isleaf', false)
    + '<div id="bdn-new-slin-fields"></div>'
    + '<div class="tk-grid-actions">'
    + '<button class="btn-cancel" onclick="document.getElementById(\'' + wrapId + '\').innerHTML=\'\'">Cancel</button>'
    + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddNode(' + (parentNodeId ? ('\'' + parentNodeId + '\'') : 'null') + ')">Add Node</button>'
    + '</div>'
    + '<div class="login-error" id="bdn-new-error"></div>'
    + '</div>';
  document.getElementById('bdn-new-type').addEventListener('change', bdRenderSlinFieldsIfNeeded);
  bdRenderSlinFieldsIfNeeded();
}

function bdRenderSlinFieldsIfNeeded(){
  var slinWrap = document.getElementById('bdn-new-slin-fields');
  if(!slinWrap){ return; }
  if(bdVal('bdn-new-type') !== 'SLIN'){
    slinWrap.innerHTML = '';
    return;
  }
  slinWrap.innerHTML = '<div class="bd-nested-section"><div class="tk-section-title">SLIN Details</div>'
    + '<div class="asset-form-grid">'
    + bdInput('SLIN Code', 'bdn-new-slincode', '')
    + bdSelect('SLIN Category', 'bdn-new-slincat', bdSlinCategories.map(function(t){ return { value: t, label: t }; }), bdSlinCategories[0])
    + bdInput('Option Year', 'bdn-new-optionyear', '', 'text')
    + bdInput('Period of Performance — Start', 'bdn-new-popstart', '', 'date')
    + bdInput('Period of Performance — End', 'bdn-new-popend', '', 'date')
    + bdInput('Fee % (override)', 'bdn-new-slinfee', '', 'number')
    + '</div>'
    + '<div><label class="field-label">SLIN Description</label><input type="text" id="bdn-new-slindesc" class="field-input"></div>'
    + '</div>';
}

async function bdSubmitAddNode(parentNodeId){
  var errorEl = document.getElementById('bdn-new-error');
  var label = bdVal('bdn-new-label');
  var nodeType = bdVal('bdn-new-type');
  if(!label){ errorEl.textContent = 'Label is required.'; return; }
  if(nodeType === 'SLIN' && !bdVal('bdn-new-slincode')){ errorEl.textContent = 'SLIN Code is required for a SLIN node.'; return; }

  var parentNode = parentNodeId ? burndown.nodesById[parentNodeId] : null;
  var nodeId = crypto.randomUUID();

  try{
    var { error } = await supabaseClient.from('billing_nodes').insert({
      node_id: nodeId,
      parent_node_id: parentNodeId || null,
      customer_id: parentNode ? parentNode.customer_id : burndown.treeContractCustomerId,
      contract_id: burndown.treeSelectedContractId,
      node_type: nodeType,
      code: bdVal('bdn-new-code') || null,
      label: label,
      is_leaf: bdChecked('bdn-new-isleaf'),
      status: 'active',
      sort_order: bdVal('bdn-new-sort') ? parseInt(bdVal('bdn-new-sort'), 10) : 0,
      effective_start: bdVal('bdn-new-effstart') || null,
      effective_end: bdVal('bdn-new-effend') || null
    });
    if(error){ throw error; }

    if(nodeType === 'SLIN'){
      var { error: slinErr } = await supabaseClient.from('slins').insert({
        slin_id: crypto.randomUUID(),
        billing_node_id: nodeId,
        contract_id: burndown.treeSelectedContractId,
        slin_code: bdVal('bdn-new-slincode'),
        slin_description: bdVal('bdn-new-slindesc') || null,
        slin_category: bdVal('bdn-new-slincat'),
        option_year: bdVal('bdn-new-optionyear') || null,
        pop_start: bdVal('bdn-new-popstart') || null,
        pop_end: bdVal('bdn-new-popend') || null,
        fee_percentage: bdVal('bdn-new-slinfee') ? parseFloat(bdVal('bdn-new-slinfee')) : null,
        status: 'active'
      });
      if(slinErr){ throw slinErr; }
    }

    if(parentNodeId){ burndown.expandedNodeIds[parentNodeId] = true; }
    await bdLoadTree(burndown.treeSelectedContractId);
  }catch(e){
    errorEl.textContent = 'Could not add node — try again.';
    console.error(e);
  }
}

// ---- Node detail panel (generic fields, + SLIN detail when applicable) ----

function bdRenderNodeDetail(nodeId){
  var panel = document.getElementById('bd-detail-panel');
  var node = burndown.nodesById[nodeId];
  if(!node){ panel.innerHTML = ''; return; }

  var html = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">' + escAttr(node.node_type) + ' — ' + escAttr(node.label) + '</div>'
    + '<div class="asset-form-grid">'
    + bdInput('Label', 'bdn-label-' + nodeId, node.label)
    + bdInput('Code', 'bdn-code-' + nodeId, node.code)
    + bdInput('Sort Order', 'bdn-sort-' + nodeId, node.sort_order, 'number')
    + bdInput('Effective Start', 'bdn-effstart-' + nodeId, node.effective_start, 'date')
    + bdInput('Effective End', 'bdn-effend-' + nodeId, node.effective_end, 'date')
    + bdSelect('Status', 'bdn-status-' + nodeId, [{value:'active',label:'Active'},{value:'closed',label:'Closed'},{value:'on_hold',label:'On Hold'}], node.status)
    + '</div>'
    + bdCheckboxRow('Leaf node', 'bdn-isleaf-' + nodeId, node.is_leaf)
    + '<div class="tk-grid-actions">'
    + '<button class="btn-edit" onclick="bdShowAddNodeForm(\'' + nodeId + '\')">+ Add Child Node</button>'
    + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSaveNode(\'' + nodeId + '\')">Save</button>'
    + '</div>'
    + '<div id="bd-add-node-form-wrap-' + nodeId + '"></div>'
    + '<div class="login-error" id="bdn-error-' + nodeId + '"></div>'
    + '</div>';

  panel.innerHTML = html;

  if(node.node_type === 'SLIN'){
    var slinWrap = document.createElement('div');
    slinWrap.id = 'bd-slin-detail-' + nodeId;
    slinWrap.innerHTML = '<div class="tk-empty">Loading SLIN details...</div>';
    panel.appendChild(slinWrap);
    bdRenderSlinDetail(nodeId);
  }
}

async function bdSaveNode(nodeId){
  var errorEl = document.getElementById('bdn-error-' + nodeId);
  var label = bdVal('bdn-label-' + nodeId);
  if(!label){ errorEl.textContent = 'Label is required.'; return; }
  try{
    var { error } = await supabaseClient.from('billing_nodes').update({
      label: label,
      code: bdVal('bdn-code-' + nodeId) || null,
      sort_order: bdVal('bdn-sort-' + nodeId) ? parseInt(bdVal('bdn-sort-' + nodeId), 10) : 0,
      effective_start: bdVal('bdn-effstart-' + nodeId) || null,
      effective_end: bdVal('bdn-effend-' + nodeId) || null,
      status: bdVal('bdn-status-' + nodeId),
      is_leaf: bdChecked('bdn-isleaf-' + nodeId)
    }).eq('node_id', nodeId);
    if(error){ throw error; }
    await bdLoadTree(burndown.treeSelectedContractId);
    bdRenderNodeDetail(nodeId);
  }catch(e){
    errorEl.textContent = 'Could not save — try again.';
    console.error(e);
  }
}

// ---- SLIN detail: slins fields + funding history ----

async function bdRenderSlinDetail(nodeId){
  var wrap = document.getElementById('bd-slin-detail-' + nodeId);
  if(!wrap){ return; }
  try{
    var { data: rows, error } = await supabaseClient.from('slins').select('*').eq('billing_node_id', nodeId);
    if(error){ throw error; }
    if(!rows.length){ wrap.innerHTML = '<div class="tk-empty">No SLIN record found for this node.</div>'; return; }
    burndown.currentSlin = rows[0];
    var s = burndown.currentSlin;

    wrap.innerHTML = '<div class="tk-entry-card">'
      + '<div class="tk-section-title">SLIN Details</div>'
      + '<div class="asset-form-grid">'
      + bdInput('SLIN Code', 'bds-code-' + s.slin_id, s.slin_code)
      + bdSelect('SLIN Category', 'bds-cat-' + s.slin_id, bdSlinCategories.map(function(t){ return { value: t, label: t }; }), s.slin_category)
      + bdInput('Option Year', 'bds-optionyear-' + s.slin_id, s.option_year, 'text')
      + bdInput('Period of Performance — Start', 'bds-popstart-' + s.slin_id, s.pop_start, 'date')
      + bdInput('Period of Performance — End', 'bds-popend-' + s.slin_id, s.pop_end, 'date')
      + bdInput('Fee % (override)', 'bds-fee-' + s.slin_id, s.fee_percentage, 'number')
      + bdSelect('Status', 'bds-status-' + s.slin_id, [{value:'active',label:'Active'},{value:'closed',label:'Closed'},{value:'on_hold',label:'On Hold'}], s.status)
      + '</div>'
      + '<div><label class="field-label">Description</label><input type="text" id="bds-desc-' + s.slin_id + '" class="field-input" value="' + escAttr(s.slin_description) + '"></div>'
      + '<div class="tk-grid-actions"><button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSaveSlin(\'' + s.slin_id + '\',\'' + nodeId + '\')">Save</button></div>'
      + '<div class="login-error" id="bds-error-' + s.slin_id + '"></div>'
      + '</div>'
      + '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Funding History <span class="bd-inline-hint">(append-only ledger — current funded amount is the sum of all rows below)</span></div>'
      + '<div id="bd-funding-list-' + s.slin_id + '"><div class="tk-empty">Loading...</div></div>'
      + '<button class="btn-edit" style="margin-top:10px;" onclick="bdShowAddFundingForm(\'' + s.slin_id + '\')">+ Add Funding Mod</button>'
      + '<div id="bd-add-funding-form-wrap-' + s.slin_id + '"></div>'
      + '</div>';

    bdLoadFundingHistory(s.slin_id);
  }catch(e){
    wrap.innerHTML = '<div class="tk-empty">Couldn\'t load SLIN details.</div>';
    console.error(e);
  }
}

async function bdSaveSlin(slinId, nodeId){
  var errorEl = document.getElementById('bds-error-' + slinId);
  try{
    var { error } = await supabaseClient.from('slins').update({
      slin_code: bdVal('bds-code-' + slinId),
      slin_category: bdVal('bds-cat-' + slinId),
      option_year: bdVal('bds-optionyear-' + slinId) || null,
      pop_start: bdVal('bds-popstart-' + slinId) || null,
      pop_end: bdVal('bds-popend-' + slinId) || null,
      fee_percentage: bdVal('bds-fee-' + slinId) ? parseFloat(bdVal('bds-fee-' + slinId)) : null,
      status: bdVal('bds-status-' + slinId),
      slin_description: bdVal('bds-desc-' + slinId) || null
    }).eq('slin_id', slinId);
    if(error){ throw error; }
    bdRenderSlinDetail(nodeId);
  }catch(e){
    errorEl.textContent = 'Could not save — try again.';
    console.error(e);
  }
}

// ---- Funding history (append-only) ----

async function bdLoadFundingHistory(slinId){
  var container = document.getElementById('bd-funding-list-' + slinId);
  try{
    var { data: rows, error } = await supabaseClient.from('slin_funding_history').select('*').eq('slin_id', slinId).order('mod_date', { ascending: false });
    if(error){ throw error; }
    if(!rows.length){
      container.innerHTML = '<div class="tk-empty">No funding mods recorded yet.</div>';
      return;
    }
    container.innerHTML = '<div class="bd-ledger">' + rows.map(function(r){
      return '<div class="bd-ledger-row">'
        + '<div><div class="bd-row-title">Mod ' + escAttr(r.mod_number || '—') + ' — ' + formatDate(r.mod_date) + '</div>'
        + '<div class="bd-row-sub">Award ' + bdMoney(r.award_total) + ' · Cumulative ' + bdMoney(r.cumulative_total) + '</div></div>'
        + '</div>';
    }).join('') + '</div>';
  }catch(e){
    container.innerHTML = '<div class="tk-empty">Couldn\'t load funding history.</div>';
    console.error(e);
  }
}

async function bdShowAddFundingForm(slinId){
  var wrap = document.getElementById('bd-add-funding-form-wrap-' + slinId);
  var latestCumulative = 0;
  try{
    var { data: rows } = await supabaseClient.from('slin_funding_history').select('cumulative_total').eq('slin_id', slinId).order('mod_date', { ascending: false }).limit(1);
    if(rows && rows.length){ latestCumulative = rows[0].cumulative_total; }
  }catch(e){ console.error(e); }

  wrap.innerHTML = '<div class="bd-add-form">'
    + '<div class="asset-form-grid">'
    + bdInput('Mod Number', 'bdf-new-modnum-' + slinId, '')
    + bdInput('Mod Date', 'bdf-new-moddate-' + slinId, '', 'date')
    + bdInput('Previous Funding', 'bdf-new-prev-' + slinId, latestCumulative, 'number')
    + bdInput('Award Total (this mod)', 'bdf-new-award-' + slinId, '', 'number')
    + bdInput('Cumulative Total', 'bdf-new-cum-' + slinId, latestCumulative, 'number')
    + bdInput('Source Document (URL)', 'bdf-new-doc-' + slinId, '')
    + '</div>'
    + '<div class="tk-grid-actions">'
    + '<button class="btn-cancel" onclick="document.getElementById(\'bd-add-funding-form-wrap-' + slinId + '\').innerHTML=\'\'">Cancel</button>'
    + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddFunding(\'' + slinId + '\')">Add Mod</button>'
    + '</div>'
    + '<div class="login-error" id="bdf-new-error-' + slinId + '"></div>'
    + '</div>';

  document.getElementById('bdf-new-award-' + slinId).addEventListener('input', function(){
    var prev = parseFloat(bdVal('bdf-new-prev-' + slinId)) || 0;
    var award = parseFloat(bdVal('bdf-new-award-' + slinId)) || 0;
    document.getElementById('bdf-new-cum-' + slinId).value = (prev + award).toFixed(2);
  });
}

async function bdSubmitAddFunding(slinId){
  var errorEl = document.getElementById('bdf-new-error-' + slinId);
  if(!bdVal('bdf-new-moddate-' + slinId)){ errorEl.textContent = 'Mod Date is required.'; return; }
  if(!bdVal('bdf-new-award-' + slinId)){ errorEl.textContent = 'Award Total is required.'; return; }
  try{
    var { error } = await supabaseClient.from('slin_funding_history').insert({
      slin_id: slinId,
      mod_number: bdVal('bdf-new-modnum-' + slinId) || null,
      mod_date: bdVal('bdf-new-moddate-' + slinId),
      previous_funding: parseFloat(bdVal('bdf-new-prev-' + slinId)) || 0,
      award_total: parseFloat(bdVal('bdf-new-award-' + slinId)),
      cumulative_total: parseFloat(bdVal('bdf-new-cum-' + slinId)),
      source_document: bdVal('bdf-new-doc-' + slinId) || null
    });
    if(error){ throw error; }
    document.getElementById('bd-add-funding-form-wrap-' + slinId).innerHTML = '';
    bdLoadFundingHistory(slinId);
  }catch(e){
    errorEl.textContent = 'Could not add funding mod — try again.';
    console.error(e);
  }
}

// =============================================================
// BULK SLIN ENTRY WIDGET (reusable — mounted standalone in the SLIN Table
// subtab, and embedded inside Add Customer's "also add first contract"
// flow). One "batch" = one billing_nodes/slins/slin_funding_history
// insert per row, all sharing one mod_number/mod_date/source_document —
// matches how a real Task Order Mod document lists many SLINs under one
// mod. Keyed by an arbitrary instanceKey so two mounts never collide.
// =============================================================

function bdBulkBlankRow(){
  return { slinCode: '', slinDesc: '', category: bdSlinCategories[0], optionYear: '', popStart: '', popEnd: '', prevFunding: '0', awardTotal: '', cumTotal: '0' };
}

// embedded=true (Add Customer flow) hides this widget's own Save button —
// the outer form's submit collects burndown.bulk[instanceKey].rows itself
// so the customer/contract/contacts/SLINs all commit from one Add
// Customer click.
async function bdBulkInit(instanceKey, containerId, contractId, customerId, onSaved, embedded){
  var parentOptions = [{ value: '', label: '(Top level — no parent)' }];
  try{
    var { data: nodes, error } = await supabaseClient.from('billing_nodes').select('node_id,label,node_type').eq('contract_id', contractId).order('sort_order');
    if(error){ throw error; }
    (nodes || []).forEach(function(n){
      if(n.node_type !== 'SLIN'){ parentOptions.push({ value: n.node_id, label: n.node_type + ': ' + n.label }); }
    });
  }catch(e){ console.error(e); }

  burndown.bulk[instanceKey] = {
    containerId: containerId,
    contractId: contractId,
    customerId: customerId,
    parentNodeId: '',
    modNumber: '',
    modDate: '',
    sourceDocument: '',
    rows: [bdBulkBlankRow()],
    reviewing: false,
    onSaved: onSaved,
    embedded: !!embedded,
    parentOptions: parentOptions
  };
  bdBulkRender(instanceKey);
}

function bdBulkSyncFromDom(instanceKey){
  var state = burndown.bulk[instanceKey];
  if(!state || state.reviewing){ return; }
  state.parentNodeId = bdVal('bdbulk-' + instanceKey + '-parent');
  state.modNumber = bdVal('bdbulk-' + instanceKey + '-modnum');
  state.modDate = bdVal('bdbulk-' + instanceKey + '-moddate');
  state.sourceDocument = bdVal('bdbulk-' + instanceKey + '-doc');
  state.rows.forEach(function(row, i){
    var p = 'bdbulk-' + instanceKey + '-' + i + '-';
    row.slinCode = bdVal(p + 'code');
    row.category = bdVal(p + 'cat');
    row.optionYear = bdVal(p + 'oy');
    row.popStart = bdVal(p + 'popstart');
    row.popEnd = bdVal(p + 'popend');
    row.prevFunding = bdVal(p + 'prev');
    row.awardTotal = bdVal(p + 'award');
    row.cumTotal = bdVal(p + 'cum');
    row.slinDesc = bdVal(p + 'desc');
  });
}

function bdBulkAddRow(instanceKey){
  bdBulkSyncFromDom(instanceKey);
  burndown.bulk[instanceKey].rows.push(bdBulkBlankRow());
  bdBulkRender(instanceKey);
}

function bdBulkRemoveRow(instanceKey, index){
  bdBulkSyncFromDom(instanceKey);
  burndown.bulk[instanceKey].rows.splice(index, 1);
  bdBulkRender(instanceKey);
}

function bdBulkRowHtml(instanceKey, row, i){
  var p = 'bdbulk-' + instanceKey + '-' + i + '-';
  return '<div class="bd-add-form" style="margin-bottom:12px;">'
    + '<div class="tk-grid-actions" style="justify-content:space-between;margin-bottom:6px;">'
    + '<div class="tk-section-title" style="margin:0;">Row ' + (i + 1) + '</div>'
    + '<button class="btn-cancel" onclick="bdBulkRemoveRow(\'' + instanceKey + '\',' + i + ')">Remove</button>'
    + '</div>'
    + '<div class="asset-form-grid">'
    + bdInput('SLIN Code', p + 'code', row.slinCode)
    + bdSelect('Category', p + 'cat', bdSlinCategories.map(function(t){ return { value: t, label: t }; }), row.category)
    + bdInput('Option Year', p + 'oy', row.optionYear)
    + bdInput('PoP Start', p + 'popstart', row.popStart, 'date')
    + bdInput('PoP End', p + 'popend', row.popEnd, 'date')
    + bdInput('Previous Funding', p + 'prev', row.prevFunding, 'number')
    + bdInput('Award Total', p + 'award', row.awardTotal, 'number')
    + bdInput('Cumulative Total', p + 'cum', row.cumTotal, 'number')
    + '</div>'
    + '<div><label class="field-label">Description</label><input type="text" id="' + p + 'desc" class="field-input" value="' + escAttr(row.slinDesc) + '"></div>'
    + '</div>';
}

function bdBulkRender(instanceKey){
  var state = burndown.bulk[instanceKey];
  var container = document.getElementById(state.containerId);
  if(!container){ return; }
  if(state.reviewing){ bdBulkRenderReview(instanceKey); return; }

  var header = '<div class="asset-form-grid">'
    + bdSelect('Attach Under', 'bdbulk-' + instanceKey + '-parent', state.parentOptions, state.parentNodeId)
    + bdInput('Mod Number', 'bdbulk-' + instanceKey + '-modnum', state.modNumber)
    + bdInput('Mod Date', 'bdbulk-' + instanceKey + '-moddate', state.modDate, 'date')
    + bdInput('Source Document (URL, optional)', 'bdbulk-' + instanceKey + '-doc', state.sourceDocument)
    + '</div>';

  var rowsHtml = state.rows.map(function(row, i){ return bdBulkRowHtml(instanceKey, row, i); }).join('');
  var addRowHtml = '<div class="tk-grid-actions" style="justify-content:flex-start;"><button class="btn-edit" onclick="bdBulkAddRow(\'' + instanceKey + '\')">+ Add Row</button></div>';
  var saveHtml = state.embedded
    ? ''
    : '<div class="tk-grid-actions"><button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdBulkShowReview(\'' + instanceKey + '\')">Review &amp; Save All</button></div>';

  container.innerHTML = header
    + '<div id="bdbulk-' + instanceKey + '-rows">' + rowsHtml + '</div>'
    + addRowHtml + saveHtml
    + '<div class="login-error" id="bdbulk-' + instanceKey + '-error"></div>';

  state.rows.forEach(function(row, i){
    var p = 'bdbulk-' + instanceKey + '-' + i + '-';
    var awardEl = document.getElementById(p + 'award');
    if(awardEl){
      awardEl.addEventListener('input', function(){
        var prev = parseFloat(bdVal(p + 'prev')) || 0;
        var award = parseFloat(bdVal(p + 'award')) || 0;
        document.getElementById(p + 'cum').value = (prev + award).toFixed(2);
      });
    }
  });
}

function bdBulkShowReview(instanceKey){
  bdBulkSyncFromDom(instanceKey);
  var state = burndown.bulk[instanceKey];
  var rowsWithCode = state.rows.filter(function(r){ return r.slinCode; });
  if(!rowsWithCode.length){
    bdBulkRender(instanceKey);
    document.getElementById('bdbulk-' + instanceKey + '-error').textContent = 'Add at least one row with a SLIN Code.';
    return;
  }
  state.reviewing = true;
  bdBulkRender(instanceKey);
}

function bdBulkRenderReview(instanceKey){
  var state = burndown.bulk[instanceKey];
  var container = document.getElementById(state.containerId);
  var rowsWithCode = state.rows.filter(function(r){ return r.slinCode; });
  var parentLabel = (state.parentOptions.find(function(o){ return o.value === state.parentNodeId; }) || {}).label || '(Top level)';
  var rowsHtml = rowsWithCode.map(function(r){
    return '<div class="bd-ledger-row"><div><div class="bd-row-title">' + escAttr(r.slinCode) + ' — ' + escAttr(r.slinDesc || '') + '</div>'
      + '<div class="bd-row-sub">' + escAttr(r.category) + ' · ' + (r.optionYear ? escAttr(r.optionYear) : '—') + ' · ' + (r.popStart || '—') + ' to ' + (r.popEnd || '—') + '</div></div>'
      + '<div class="bd-row-title">' + bdMoney(r.cumTotal) + '</div></div>';
  }).join('');

  container.innerHTML = '<div class="tk-section-title">Review — ' + rowsWithCode.length + ' SLIN' + (rowsWithCode.length === 1 ? '' : 's') + ', attaching under ' + escAttr(parentLabel) + '</div>'
    + '<div class="bd-row-sub" style="margin-bottom:10px;">Mod ' + escAttr(state.modNumber || '—') + ' · ' + (state.modDate || '—') + (state.sourceDocument ? ' · ' + escAttr(state.sourceDocument) : '') + '</div>'
    + '<div class="bd-ledger">' + rowsHtml + '</div>'
    + '<div class="tk-grid-actions">'
    + '<button class="btn-cancel" onclick="bdBulkBackToEdit(\'' + instanceKey + '\')">Back to Edit</button>'
    + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdBulkConfirmSave(\'' + instanceKey + '\')">Confirm &amp; Save All</button>'
    + '</div>'
    + '<div class="login-error" id="bdbulk-' + instanceKey + '-error"></div>';
}

function bdBulkBackToEdit(instanceKey){
  burndown.bulk[instanceKey].reviewing = false;
  bdBulkRender(instanceKey);
}

// Used by the standalone SLIN Table "Confirm & Save All". One atomic RPC
// call (bd_bulk_add_slins) instead of a billing_nodes/slins/
// slin_funding_history insert sequence per row — a failure on row 12 of 19
// no longer leaves rows 1-11 committed. See migration 0010. (The embedded
// Add Customer flow doesn't call this — it stages the same row shape via
// bdBulkRowsPayload() into the single bd_add_customer_with_contract call.)
async function bdBulkSaveRows(instanceKey){
  var state = burndown.bulk[instanceKey];
  var rows = bdBulkRowsPayload(instanceKey);
  if(!rows.length){ return; }
  var { error } = await supabaseClient.rpc('bd_bulk_add_slins', {
    payload: {
      contract_id: state.contractId,
      customer_id: state.customerId || null,
      parent_node_id: state.parentNodeId || null,
      mod_number: state.modNumber || null,
      mod_date: state.modDate || null,
      source_document: state.sourceDocument || null,
      rows: rows
    }
  });
  if(error){ throw error; }
}

async function bdBulkConfirmSave(instanceKey){
  var state = burndown.bulk[instanceKey];
  var errorEl = document.getElementById('bdbulk-' + instanceKey + '-error');
  try{
    await bdBulkSaveRows(instanceKey);
    var onSaved = state.onSaved;
    var containerId = state.containerId;
    var contractId = state.contractId;
    var customerId = state.customerId;
    var embedded = state.embedded;
    if(typeof onSaved === 'function'){ onSaved(); }
    await bdBulkInit(instanceKey, containerId, contractId, customerId, onSaved, embedded);
  }catch(e){
    errorEl.textContent = 'Something went wrong saving — some rows may already be saved. Check the SLIN Table before retrying.';
    console.error(e);
  }
}

// =============================================================
// SLIN TABLE (filterable existing-SLIN view + standalone bulk entry)
// =============================================================

async function bdLoadSlinTableContractPicker(){
  var wrap = document.getElementById('bd-st-contract-picker');
  try{
    var { data, error } = await supabaseClient.from('contracts').select('contract_id,customer_id,prime_contract_number,subcontract_number,customers(name)').order('prime_contract_number');
    if(error){ throw error; }
    burndown.stContracts = data || [];
    var options = '<option value="">Select a contract...</option>' + burndown.stContracts.map(function(k){
      var custName = k.customers && k.customers.name ? k.customers.name : 'Unknown Customer';
      var label = custName + ' — ' + (k.prime_contract_number || k.subcontract_number || '(unnumbered)');
      return '<option value="' + k.contract_id + '">' + escAttr(label) + '</option>';
    }).join('');
    wrap.innerHTML = '<select class="field-input" id="bd-st-contract-select" style="max-width:480px;" onchange="bdOnStContractChange()">' + options + '</select>';
  }catch(e){
    wrap.innerHTML = '<div class="tk-empty">Couldn\'t load contracts.</div>';
    console.error(e);
  }
}

function bdOnStContractChange(){
  var contractId = bdVal('bd-st-contract-select');
  burndown.stSelectedContractId = contractId || null;
  var row = burndown.stContracts.find(function(k){ return k.contract_id === contractId; });
  burndown.stSelectedCustomerId = row ? row.customer_id : null;
  burndown.stOptionYearFilter = '';
  if(!contractId){
    burndown.stExistingSlins = [];
    burndown.stLatestFundingBySlin = {};
    document.getElementById('bd-st-existing-wrap').innerHTML = '';
    document.getElementById('bd-st-bulk-wrap').innerHTML = '';
    return;
  }
  bdLoadStExisting(contractId);
  bdBulkInit('slintable', 'bd-st-bulk-wrap', contractId, burndown.stSelectedCustomerId, function(){ bdLoadStExisting(contractId); }, false);
}

async function bdLoadStExisting(contractId){
  var wrap = document.getElementById('bd-st-existing-wrap');
  wrap.innerHTML = '<div class="tk-empty">Loading...</div>';
  try{
    var { data: slinRows, error } = await supabaseClient.from('slins').select('*').eq('contract_id', contractId).order('slin_code');
    if(error){ throw error; }
    var fundingRows = [];
    if(slinRows.length){
      var { data: fRows, error: fErr } = await supabaseClient.from('slin_funding_history').select('slin_id,cumulative_total,mod_date').in('slin_id', slinRows.map(function(s){ return s.slin_id; })).order('mod_date', { ascending: false });
      if(fErr){ throw fErr; }
      fundingRows = fRows || [];
    }
    var latestBySlin = {};
    fundingRows.forEach(function(f){ if(!latestBySlin[f.slin_id]){ latestBySlin[f.slin_id] = f; } });
    burndown.stExistingSlins = slinRows;
    burndown.stLatestFundingBySlin = latestBySlin;
    bdRenderStExistingTable();
  }catch(e){
    wrap.innerHTML = '<div class="tk-empty">Couldn\'t load SLIN data.</div>';
    console.error(e);
  }
}

function bdRenderStExistingTable(){
  var wrap = document.getElementById('bd-st-existing-wrap');
  var years = {};
  burndown.stExistingSlins.forEach(function(s){ if(s.option_year){ years[s.option_year] = true; } });
  var yearOptions = '<option value="">All Option Years</option>' + Object.keys(years).sort().map(function(y){
    return '<option value="' + escAttr(y) + '"' + (y === burndown.stOptionYearFilter ? ' selected' : '') + '>' + escAttr(y) + '</option>';
  }).join('');

  var filtered = burndown.stExistingSlins.filter(function(s){ return !burndown.stOptionYearFilter || s.option_year === burndown.stOptionYearFilter; });

  var rowsHtml = filtered.length
    ? filtered.map(function(s){
        var funding = burndown.stLatestFundingBySlin[s.slin_id];
        return '<div class="bd-ledger-row"><div><div class="bd-row-title">' + escAttr(s.slin_code) + ' — ' + escAttr(s.slin_description || '') + '</div>'
          + '<div class="bd-row-sub">' + escAttr(s.slin_category) + ' · ' + (s.option_year ? escAttr(s.option_year) : '—') + ' · ' + formatDate(s.pop_start) + ' – ' + formatDate(s.pop_end) + '</div></div>'
          + '<div class="bd-row-title">' + bdMoney(funding ? funding.cumulative_total : null) + '</div></div>';
      }).join('')
    : '<div class="tk-empty">No SLINs match this filter.</div>';

  wrap.innerHTML = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Existing SLINs</div>'
    + (Object.keys(years).length ? '<select class="field-input" style="max-width:260px;" onchange="burndown.stOptionYearFilter=this.value;bdRenderStExistingTable();">' + yearOptions + '</select>' : '')
    + '<div class="bd-ledger" style="margin-top:14px;">' + rowsHtml + '</div>'
    + '</div>';
}

// =============================================================
// RATES (labor_categories + employee_rates) — feeds the Burndown funding
// calculation: bill rate per employee, per labor category, optionally
// overridden per SLIN. Add-only, no edit/delete — a new rate is a new
// effective-dated row.
// =============================================================

async function bdLoadRatesTab(){
  await bdLoadLaborCategories();
  await bdLoadRateEmployeePicker();
}

// ---- Labor Categories ----

async function bdLoadLaborCategories(){
  var container = document.getElementById('bd-laborcat-list');
  try{
    var { data, error } = await supabaseClient.from('labor_categories').select('*').order('title');
    if(error){ throw error; }
    burndown.laborCategories = data || [];
    bdRenderLaborCategoryList();
  }catch(e){
    container.innerHTML = '<div class="tk-empty">Couldn\'t load labor categories.</div>';
    console.error(e);
  }
}

function bdRenderLaborCategoryList(){
  var container = document.getElementById('bd-laborcat-list');
  var addBtnHtml = '<div class="tk-grid-actions" style="justify-content:flex-start;margin-bottom:16px;"><button class="btn-edit" onclick="bdShowAddLaborCategoryForm()">+ Add Labor Category</button></div>'
    + '<div id="bd-laborcat-add-wrap"></div>';
  var listHtml = burndown.laborCategories.length
    ? burndown.laborCategories.map(function(lc){
        return '<div class="bd-row-card">'
          + '<div class="bd-row-summary" style="cursor:default;">'
          + '<div><div class="bd-row-title">' + escAttr(lc.title) + '</div></div>'
          + '<div class="bd-status-pill' + (lc.status === 'active' ? ' bd-pill-active' : ' bd-pill-muted') + '">' + (lc.status === 'active' ? 'Active' : 'Inactive') + '</div>'
          + '</div></div>';
      }).join('')
    : '<div class="tk-empty">No labor categories yet.</div>';
  container.innerHTML = addBtnHtml + listHtml;
}

function bdShowAddLaborCategoryForm(){
  var wrap = document.getElementById('bd-laborcat-add-wrap');
  wrap.innerHTML = '<div class="bd-add-form">'
    + '<div class="asset-form-grid">'
    + bdInput('Title', 'bdlc-new-title', '')
    + bdSelect('Status', 'bdlc-new-status', [{value:'active',label:'Active'},{value:'inactive',label:'Inactive'}], 'active')
    + '</div>'
    + '<div class="tk-grid-actions">'
    + '<button class="btn-cancel" onclick="document.getElementById(\'bd-laborcat-add-wrap\').innerHTML=\'\'">Cancel</button>'
    + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddLaborCategory()">Add</button>'
    + '</div>'
    + '<div class="login-error" id="bdlc-new-error"></div>'
    + '</div>';
}

async function bdSubmitAddLaborCategory(){
  var errorEl = document.getElementById('bdlc-new-error');
  var title = bdVal('bdlc-new-title');
  if(!title){ errorEl.textContent = 'Title is required.'; return; }
  try{
    var { error } = await supabaseClient.from('labor_categories').insert({
      title: title,
      status: bdVal('bdlc-new-status')
    });
    if(error){ throw error; }
    document.getElementById('bd-laborcat-add-wrap').innerHTML = '';
    await bdLoadLaborCategories();
  }catch(e){
    errorEl.textContent = 'Could not add — try again.';
    console.error(e);
  }
}

// ---- Employee Rates ----

async function bdFetchAllSlinsForRates(){
  if(burndown.ratesAllSlins){ return burndown.ratesAllSlins; }
  var { data, error } = await supabaseClient.from('slins').select('slin_id,slin_code,slin_description,contract_id,contracts(prime_contract_number,subcontract_number,customers(name))').order('slin_code');
  if(error){ throw error; }
  burndown.ratesAllSlins = data || [];
  return burndown.ratesAllSlins;
}

async function bdLoadRateEmployeePicker(){
  var wrap = document.getElementById('bd-rates-employee-picker');
  try{
    var employees = await bdFetchEmployees();
    var options = '<option value="">Select an employee...</option>' + employees.map(function(p){
      return '<option value="' + p.id + '">' + escAttr(p.full_name) + '</option>';
    }).join('');
    wrap.innerHTML = '<select class="field-input" id="bd-rates-employee-select" style="max-width:420px;" onchange="bdOnRatesEmployeeChange()">' + options + '</select>';
  }catch(e){
    wrap.innerHTML = '<div class="tk-empty">Couldn\'t load employees.</div>';
    console.error(e);
  }
}

function bdOnRatesEmployeeChange(){
  var employeeId = bdVal('bd-rates-employee-select');
  burndown.ratesSelectedEmployeeId = employeeId || null;
  var listEl = document.getElementById('bd-rates-list');
  if(!employeeId){
    listEl.innerHTML = '';
    return;
  }
  bdLoadEmployeeRates(employeeId);
}

async function bdLoadEmployeeRates(employeeId){
  var container = document.getElementById('bd-rates-list');
  container.innerHTML = '<div class="tk-empty">Loading...</div>';
  try{
    var { data, error } = await supabaseClient.from('employee_rates').select('*,labor_categories(title),slins(slin_code)').eq('employee_id', employeeId).order('effective_start', { ascending: false });
    if(error){ throw error; }
    bdRenderEmployeeRateList(data || []);
  }catch(e){
    container.innerHTML = '<div class="tk-empty">Couldn\'t load rates.</div>';
    console.error(e);
  }
}

function bdRenderEmployeeRateList(rows){
  var container = document.getElementById('bd-rates-list');
  var addBtn = '<button class="btn-edit" style="margin-bottom:12px;" onclick="bdShowAddRateForm()">+ Add Rate</button><div id="bd-rates-add-wrap"></div>';
  var listHtml = rows.length
    ? '<div class="bd-ledger">' + rows.map(function(r){
        var scope = r.slins ? ('SLIN ' + escAttr(r.slins.slin_code)) : 'Default (all SLINs)';
        return '<div class="bd-ledger-row"><div><div class="bd-row-title">' + escAttr(r.labor_categories ? r.labor_categories.title : 'Unknown') + ' — ' + scope + '</div>'
          + '<div class="bd-row-sub">Bill ' + bdMoney(r.bill_rate) + ' · Bill w/ Fee ' + bdMoney(r.bill_rate_with_fee) + ' · Effective ' + formatDate(r.effective_start) + (r.effective_end ? ' – ' + formatDate(r.effective_end) : ' – open') + '</div></div></div>';
      }).join('') + '</div>'
    : '<div class="tk-empty">No rates entered for this employee yet.</div>';
  container.innerHTML = addBtn + listHtml;
}

async function bdShowAddRateForm(){
  var wrap = document.getElementById('bd-rates-add-wrap');
  var slins = await bdFetchAllSlinsForRates();
  var slinOptions = [{ value: '', label: '(Default — applies to all SLINs unless overridden)' }].concat(slins.map(function(s){
    var custName = s.contracts && s.contracts.customers && s.contracts.customers.name ? s.contracts.customers.name : 'Unknown';
    return { value: s.slin_id, label: custName + ' — ' + s.slin_code };
  }));
  wrap.innerHTML = '<div class="bd-add-form">'
    + '<div class="asset-form-grid">'
    + bdSelect('Labor Category', 'bdr-new-laborcat', burndown.laborCategories.filter(function(lc){ return lc.status === 'active'; }).map(function(lc){ return { value: lc.labor_category_id, label: lc.title }; }), '')
    + bdSelect('SLIN (optional override)', 'bdr-new-slin', slinOptions, '')
    + bdInput('Bill Rate', 'bdr-new-billrate', '', 'number')
    + bdInput('Bill Rate w/ Fee', 'bdr-new-billfee', '', 'number')
    + bdInput('Effective Start', 'bdr-new-effstart', new Date().toISOString().slice(0,10), 'date')
    + bdInput('Effective End (optional)', 'bdr-new-effend', '', 'date')
    + '</div>'
    + '<div class="tk-grid-actions">'
    + '<button class="btn-cancel" onclick="document.getElementById(\'bd-rates-add-wrap\').innerHTML=\'\'">Cancel</button>'
    + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddRate()">Add Rate</button>'
    + '</div>'
    + '<div class="login-error" id="bdr-new-error"></div>'
    + '</div>';
}

async function bdSubmitAddRate(){
  var errorEl = document.getElementById('bdr-new-error');
  var laborCatId = bdVal('bdr-new-laborcat');
  var effStart = bdVal('bdr-new-effstart');
  if(!laborCatId){ errorEl.textContent = 'Labor Category is required.'; return; }
  if(!effStart){ errorEl.textContent = 'Effective Start is required.'; return; }
  try{
    var { error } = await supabaseClient.from('employee_rates').insert({
      employee_id: burndown.ratesSelectedEmployeeId,
      labor_category_id: laborCatId,
      slin_id: bdVal('bdr-new-slin') || null,
      bill_rate: bdVal('bdr-new-billrate') ? parseFloat(bdVal('bdr-new-billrate')) : null,
      bill_rate_with_fee: bdVal('bdr-new-billfee') ? parseFloat(bdVal('bdr-new-billfee')) : null,
      effective_start: effStart,
      effective_end: bdVal('bdr-new-effend') || null
    });
    if(error){ throw error; }
    document.getElementById('bd-rates-add-wrap').innerHTML = '';
    await bdLoadEmployeeRates(burndown.ratesSelectedEmployeeId);
  }catch(e){
    errorEl.textContent = 'Could not add rate — try again.';
    console.error(e);
  }
}
