// COA Customer Demo — odc.js
// ODC Procurements screen ("ODC Procurements" nav item) — a new build, no
// pilot-portal source to port. Lists odc_commitments (filterable by
// contract/SLIN/status), lets Supervisor/Customer Admin add new open
// commitments, and closes them via the shared modal-based
// closeOdcCommitment()/confirmCloseOdcCommitment() defined in dashboard.js
// (single source of truth — also used by the Dashboard's Open ODC
// Commitments table). Gated to Supervisor/Customer Admin, same as
// js/burndown.js — see app.js updateNavVisibility().

var odcProc = {
  loaded: false,
  commitments: [],
  slins: [],
  contracts: [],
  filterContractId: '',
  filterSlinId: '',
  filterStatus: '',
  focusId: null
};

// Entry point — called by app.js's switchScreen('odc') and by the
// Dashboard's openOdcDetail() (dashboard.js) for a deep link that scrolls
// to / highlights one commitment's row.
async function loadOdcScreen(focusId){
  odcProc.focusId = focusId || null;
  var content = document.getElementById('odc-content');
  if(!odcProc.loaded){
    content.innerHTML = '<div class="tk-empty">Loading...</div>';
    try{
      var [{ data: contracts, error: ce }, { data: slins, error: se }] = await Promise.all([
        supabaseClient.from('contracts').select('contract_id,prime_contract_number,subcontract_number,customer_id,customers(name)').order('prime_contract_number'),
        supabaseClient.from('slins').select('slin_id,slin_code,slin_description,contract_id').order('slin_code')
      ]);
      if(ce){ throw ce; }
      if(se){ throw se; }
      odcProc.contracts = contracts || [];
      odcProc.slins = slins || [];
      await odcLoadCommitments();
      odcProc.loaded = true;
    }catch(e){
      content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load ODC Procurements</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
      return;
    }
  }else{
    try{ await odcLoadCommitments(); }catch(e){ console.error(e); }
  }
  odcRenderAll();
}

async function odcLoadCommitments(){
  var { data, error } = await supabaseClient.from('odc_commitments').select('*').order('created_at', { ascending: false });
  if(error){ throw error; }
  odcProc.commitments = data || [];
}

function odcOnFilterContractChange(){
  odcProc.filterContractId = document.getElementById('odc-filter-contract').value;
  odcProc.filterSlinId = '';
  odcRenderAll();
}
function odcOnFilterChange(){
  odcProc.filterSlinId = document.getElementById('odc-filter-slin').value;
  odcProc.filterStatus = document.getElementById('odc-filter-status').value;
  odcRenderAll();
}

function odcFilteredCommitments(){
  return odcProc.commitments.filter(function(o){
    var slin = odcProc.slins.find(function(s){ return s.slin_id === o.slin_id; });
    if(odcProc.filterContractId && (!slin || slin.contract_id !== odcProc.filterContractId)){ return false; }
    if(odcProc.filterSlinId && o.slin_id !== odcProc.filterSlinId){ return false; }
    if(odcProc.filterStatus && o.status !== odcProc.filterStatus){ return false; }
    return true;
  });
}

function odcMoney(v){
  return '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function odcRenderAll(){
  var content = document.getElementById('odc-content');
  var canEdit = isCustomerAdmin() || isSupervisor();

  var contractOptions = '<option value="">All Contracts</option>' + odcProc.contracts.map(function(c){
    var custName = c.customers && c.customers.name ? c.customers.name : '';
    var label = (custName ? custName + ' — ' : '') + (c.prime_contract_number || c.subcontract_number || '(unnumbered)');
    return '<option value="' + c.contract_id + '"' + (c.contract_id === odcProc.filterContractId ? ' selected' : '') + '>' + escAttr(label) + '</option>';
  }).join('');

  var slinsInScope = odcProc.slins.filter(function(s){ return !odcProc.filterContractId || s.contract_id === odcProc.filterContractId; });
  var slinOptions = '<option value="">All SLINs</option>' + slinsInScope.map(function(s){
    return '<option value="' + s.slin_id + '"' + (s.slin_id === odcProc.filterSlinId ? ' selected' : '') + '>' + escAttr(s.slin_code) + ' — ' + escAttr(s.slin_description || '') + '</option>';
  }).join('');

  var statusOptions = ['', 'open', 'closed', 'cancelled'].map(function(v){
    var label = v === '' ? 'All Statuses' : (v.charAt(0).toUpperCase() + v.slice(1));
    return '<option value="' + v + '"' + (v === odcProc.filterStatus ? ' selected' : '') + '>' + label + '</option>';
  }).join('');

  var filterBar = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Filter</div>'
    + '<div class="asset-form-grid">'
    + '<div><label class="field-label">Contract</label><select class="field-input" id="odc-filter-contract" onchange="odcOnFilterContractChange()">' + contractOptions + '</select></div>'
    + '<div><label class="field-label">SLIN</label><select class="field-input" id="odc-filter-slin" onchange="odcOnFilterChange()">' + slinOptions + '</select></div>'
    + '<div><label class="field-label">Status</label><select class="field-input" id="odc-filter-status" onchange="odcOnFilterChange()">' + statusOptions + '</select></div>'
    + '</div></div>';

  var formHtml = canEdit ? odcAddFormHtml() : '';

  content.innerHTML = filterBar + formHtml + odcTableHtml(canEdit);

  if(odcProc.focusId){
    var row = document.getElementById('odc-row-' + odcProc.focusId);
    if(row){
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('odc-row-highlight');
      setTimeout(function(){ row.classList.remove('odc-row-highlight'); }, 2000);
    }
    odcProc.focusId = null;
  }
}

function odcTableHtml(canEdit){
  var rows = odcFilteredCommitments();
  if(!rows.length){ return '<div class="tk-entry-card"><div class="tk-empty">No ODC commitments match this filter.</div></div>'; }
  return '<div class="tk-entry-card"><div class="tk-grid-table-wrap"><table class="tk-grid-table"><thead><tr>'
    + '<th>Description</th><th>SLIN</th><th>Contract</th><th>Reference</th><th>Committed</th><th>Status</th><th>Expected</th><th>Actual</th>' + (canEdit ? '<th></th>' : '')
    + '</tr></thead><tbody>'
    + rows.map(function(o){
        var slin = odcProc.slins.find(function(s){ return s.slin_id === o.slin_id; });
        var contract = slin ? odcProc.contracts.find(function(c){ return c.contract_id === slin.contract_id; }) : null;
        var contractLabel = contract ? (contract.prime_contract_number || contract.subcontract_number || '(unnumbered)') : '—';
        return '<tr id="odc-row-' + o.id + '">'
          + '<td>' + escAttr(o.description) + '</td>'
          + '<td>' + escAttr(slin ? slin.slin_code : '—') + '</td>'
          + '<td>' + escAttr(contractLabel) + '</td>'
          + '<td>' + escAttr(o.reference_number || '—') + '</td>'
          + '<td>' + odcMoney(o.committed_amount) + '</td>'
          + '<td><span class="tk-status-pill ' + o.status + '">' + o.status.charAt(0).toUpperCase() + o.status.slice(1) + '</span></td>'
          + '<td>' + formatDate(o.expected_date) + '</td>'
          + '<td>' + (o.actual_amount != null ? odcMoney(o.actual_amount) : '—') + '</td>'
          + (canEdit ? ('<td>' + (o.status === 'open' ? '<button class="btn-edit" style="padding:4px 10px;font-size:11px;" onclick="closeOdcCommitment(\'' + o.id + '\')">Close</button>' : '') + '</td>') : '')
          + '</tr>';
      }).join('')
    + '</tbody></table></div></div>';
}

function odcAddFormHtml(){
  var slinOptions = odcProc.slins.map(function(s){
    return '<option value="' + s.slin_id + '">' + escAttr(s.slin_code) + ' — ' + escAttr(s.slin_description || '') + '</option>';
  }).join('');
  return '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Add ODC Commitment</div>'
    + '<div class="asset-form-grid">'
    + '<div><label class="field-label">SLIN</label><select class="field-input" id="odc-new-slin">' + slinOptions + '</select></div>'
    + '<div><label class="field-label">Description</label><input class="field-input" id="odc-new-desc"></div>'
    + '<div><label class="field-label">Reference #</label><input class="field-input" id="odc-new-ref"></div>'
    + '<div><label class="field-label">Committed Amount</label><input type="number" step="0.01" class="field-input" id="odc-new-amount"></div>'
    + '<div><label class="field-label">Expected Date</label><input type="date" class="field-input" id="odc-new-expected"></div>'
    + '</div>'
    + '<button class="btn-edit" onclick="odcSubmitAdd()">Save ODC Commitment</button>'
    + '<div class="login-error" id="odc-new-error"></div>'
    + '</div>';
}

// Actor resolution (Supervisor -> demo_employees clone, Customer Admin ->
// customer_users row) via app.js's resolveOdcActor() — same helper the
// Dashboard's submitAddOdc() (dashboard.js) uses, so both entry points
// stamp created_by_employee_id/created_by_customer_user_id consistently.
async function odcSubmitAdd(){
  var errorEl = document.getElementById('odc-new-error');
  var slinId = document.getElementById('odc-new-slin').value;
  var description = document.getElementById('odc-new-desc').value;
  var amount = Number(document.getElementById('odc-new-amount').value || 0);
  if(!slinId || !description || !amount){ errorEl.textContent = 'SLIN, description, and committed amount are required.'; return; }
  try{
    var actor = await resolveOdcActor();
    if(!actor){ errorEl.textContent = 'Select the Supervisor or Prime role to add ODC commitments.'; return; }
    var { error } = await supabaseClient.from('odc_commitments').insert({
      slin_id: slinId,
      description: description,
      reference_number: document.getElementById('odc-new-ref').value || null,
      committed_amount: amount,
      status: 'open',
      expected_date: document.getElementById('odc-new-expected').value || null,
      created_by_employee_id: actor.employee_id,
      created_by_customer_user_id: actor.customer_user_id
    });
    if(error){ throw error; }
    await odcLoadCommitments();
    odcRenderAll();
  }catch(e){
    errorEl.textContent = 'Could not save — try again.';
    console.error(e);
  }
}
