// COA Customer Demo — dashboard.js
// Contract Financial Dashboard, restyled to match the approved reference
// mockup: navy filter bar (Task Order / Period / Data As Of), a 6-tile KPI
// strip, Labor CLIN cards with a progress bar + gauge, an Open ODC
// Commitments table, ODC CLIN gauge cards, a multi-line burn trend chart,
// and a Forecast Summary (EAC/Variance/Confidence) bar.
//
// Burn-calc simplification (schema explicitly leaves this to the app
// layer — see docs/HANDOFF.md "Schema" and "Explicitly parked" sections):
//   - actual labor burn = hours x employee_rates.bill_rate_with_fee (fee
//     already embedded in the seeded rate)
//   - ODC actual = closed odc_commitments.actual_amount + travel_expenses.actual_total_odc
//   - ODC committed = open odc_commitments.committed_amount
//   - Available Balance = funded - actual - committed (uncommitted balance)
//   - EAC = actual-to-date + (trailing 90-day burn rate x remaining months
//     to pop_end) + open commitments — the formula HANDOFF proposed but
//     flagged as "not signed off"; Confidence is a simple variance-%
//     heuristic (<=0% High, 0-10% Medium, >10% Low), also not a vetted
//     model. Both are clearly placeholders pending the real Indirect Rate
//     Monitoring conversation.

var dash = {
  loaded: false,
  customers: [],
  contracts: [],
  customer: null,
  nodes: [],
  slins: [],
  funding: [],
  timeEntries: [],
  rates: [],
  travelExpenses: [],
  odc: [],
  nodeChildren: {},
  slinsByNode: {},
  selectedContractId: '',  // '' = all contracts for this customer
  selectedTaskOrderId: '',  // '' = all task orders (within the selected contract, if any)
  selectedSlinIds: null      // null = all SLINs in scope; array = explicit subset
};

async function loadDashboard(){
  var laborWrap = document.getElementById('cfd-labor-clins');
  if(!dash.loaded){
    laborWrap.innerHTML = '<div class="tk-empty">Loading...</div>';
    try{
      var { data: customers, error: custErr } = await supabaseClient.from('customers').select('*').order('name');
      if(custErr){ throw custErr; }
      dash.customers = customers;
      dash.customer = customers.find(function(c){ return c.is_default_demo_company; }) || customers[0];

      await loadCustomerData(dash.customer.customer_id);
      dash.loaded = true;

      document.getElementById('cfd-filter-customer').addEventListener('change', async function(){
        var selectedId = this.value;
        dash.customer = dash.customers.find(function(c){ return c.customer_id === selectedId; });
        dash.selectedContractId = ''; dash.selectedTaskOrderId = ''; dash.selectedSlinIds = null;
        await loadCustomerData(dash.customer.customer_id);
        renderAll();
      });
      document.getElementById('cfd-filter-contract').addEventListener('change', function(){
        dash.selectedContractId = this.value;
        dash.selectedTaskOrderId = '';
        dash.selectedSlinIds = null;
        populateTaskOrderOptions();
        updateSlinPickerButtonLabel();
        renderAll();
      });
      document.getElementById('cfd-filter-taskorder').addEventListener('change', function(){
        dash.selectedTaskOrderId = this.value;
        dash.selectedSlinIds = null;
        updateSlinPickerButtonLabel();
        renderAll();
      });
      document.getElementById('cfd-filter-start').addEventListener('change', renderAll);
      document.getElementById('cfd-filter-end').addEventListener('change', renderAll);
      document.addEventListener('click', function(e){
        var panel = document.getElementById('cfd-slin-picker-panel');
        var btn = document.getElementById('cfd-slin-picker-btn');
        if(panel.style.display !== 'none' && !panel.contains(e.target) && e.target !== btn){ panel.style.display = 'none'; }
      });
    }catch(e){
      laborWrap.innerHTML = '<div class="tk-empty">Couldn\'t load the dashboard — try refreshing.</div>';
      console.error(e);
      return;
    }
  }
  renderAll();
}

// Fetches everything scoped to one customer — used on initial load and
// whenever the Customer filter changes.
async function loadCustomerData(customerId){
  var [{ data: contracts, error: ec }, { data: nodes, error: e1 }, { data: slins, error: e2 }] = await Promise.all([
    supabaseClient.from('contracts').select('*').eq('customer_id', customerId),
    supabaseClient.from('billing_nodes').select('*').eq('customer_id', customerId).order('sort_order'),
    supabaseClient.from('slins').select('*').order('slin_code')
  ]);
  if(ec){ throw ec; }
  if(e1){ throw e1; }
  if(e2){ throw e2; }
  dash.contracts = contracts;
  dash.nodes = nodes;
  var contractIds = contracts.map(function(c){ return c.contract_id; });
  dash.slins = slins.filter(function(s){ return contractIds.indexOf(s.contract_id) !== -1; });

  var slinIds = dash.slins.map(function(s){ return s.slin_id; });
  var [{ data: funding, error: e3 }, { data: timeEntries, error: e4 }, { data: rates, error: e5 }, { data: travelExpenses, error: e6 }, { data: odc, error: e7 }] = await Promise.all([
    supabaseClient.from('slin_funding_history').select('*').in('slin_id', slinIds),
    supabaseClient.from('time_entries').select('*').in('slin_id', slinIds),
    supabaseClient.from('employee_rates').select('*'),
    supabaseClient.from('travel_expenses').select('*').in('slin_id', slinIds),
    supabaseClient.from('odc_commitments').select('*').in('slin_id', slinIds)
  ]);
  if(e3){ throw e3; }
  if(e4){ throw e4; }
  if(e5){ throw e5; }
  if(e6){ throw e6; }
  if(e7){ throw e7; }
  dash.funding = funding;
  dash.timeEntries = timeEntries;
  dash.rates = rates;
  dash.travelExpenses = travelExpenses;
  dash.odc = odc;

  buildTree();
  populateFilters();
}

function buildTree(){
  dash.nodeChildren = {};
  dash.slinsByNode = {};
  dash.nodes.forEach(function(n){
    var key = n.parent_node_id || '__root__';
    if(!dash.nodeChildren[key]){ dash.nodeChildren[key] = []; }
    dash.nodeChildren[key].push(n);
  });
  dash.slins.forEach(function(s){ dash.slinsByNode[s.billing_node_id] = s; });
}

function populateFilters(){
  var custSelect = document.getElementById('cfd-filter-customer');
  custSelect.innerHTML = dash.customers.map(function(c){
    return '<option value="' + c.customer_id + '"' + (c.customer_id === dash.customer.customer_id ? ' selected' : '') + '>' + escAttr(c.name) + '</option>';
  }).join('');

  var contractSelect = document.getElementById('cfd-filter-contract');
  contractSelect.innerHTML = '<option value="">All Contracts</option>' + dash.contracts.map(function(c){
    var label = (c.issuing_organization ? (c.issuing_organization + ' — ') : '') + (c.prime_contract_number || c.contract_id);
    return '<option value="' + c.contract_id + '">' + escAttr(label) + '</option>';
  }).join('');

  populateTaskOrderOptions();

  var earliestMod = dash.funding.map(function(f){ return f.mod_date; }).sort()[0];
  document.getElementById('cfd-filter-start').value = earliestMod || new Date().toISOString().slice(0, 10);
  document.getElementById('cfd-filter-end').value = new Date().toISOString().slice(0, 10);

  updateSlinPickerButtonLabel();
}

// Task Order dropdown is scoped to the currently selected Contract (or
// every Task Order for this customer if no Contract is selected).
function populateTaskOrderOptions(){
  var taskOrders = dash.nodes.filter(function(n){
    return n.node_type === 'Task Order' && (!dash.selectedContractId || n.contract_id === dash.selectedContractId);
  });
  var toSelect = document.getElementById('cfd-filter-taskorder');
  toSelect.innerHTML = '<option value="">All Task Orders</option>' + taskOrders.map(function(n){
    return '<option value="' + n.node_id + '">' + escAttr(n.label) + '</option>';
  }).join('');
  toSelect.value = dash.selectedTaskOrderId || '';
}

// All SLINs under a given billing_node (or every SLIN if none given).
function descendantSlinIds(nodeId){
  if(!nodeId){ return dash.slins.map(function(s){ return s.slin_id; }); }
  var ids = [];
  (function walk(id){
    var slin = dash.slinsByNode[id];
    if(slin){ ids.push(slin.slin_id); }
    (dash.nodeChildren[id] || []).forEach(function(child){ walk(child.node_id); });
  })(nodeId);
  return ids;
}

// Resolves the most specific scope node currently selected: a Task
// Order if one's chosen, else the selected Contract's node, else null
// (every SLIN for this customer).
function currentTaskOrderScope(){
  if(dash.selectedTaskOrderId){ return descendantSlinIds(dash.selectedTaskOrderId); }
  if(dash.selectedContractId){
    var contractNode = dash.nodes.find(function(n){ return n.node_type === 'Contract' && n.contract_id === dash.selectedContractId; });
    return descendantSlinIds(contractNode ? contractNode.node_id : null);
  }
  return descendantSlinIds(null);
}

// Task Order/Contract scope, further narrowed by an explicit SLIN multi-select if one is active.
function scopedSlinIds(){
  var inScope = currentTaskOrderScope();
  if(!dash.selectedSlinIds){ return inScope; }
  var picked = {}; dash.selectedSlinIds.forEach(function(id){ picked[id] = true; });
  return inScope.filter(function(id){ return picked[id]; });
}

function updateSlinPickerButtonLabel(){
  var btn = document.getElementById('cfd-slin-picker-btn');
  var total = currentTaskOrderScope().length;
  if(!dash.selectedSlinIds || dash.selectedSlinIds.length === total){
    btn.textContent = 'All SLINs (' + total + ')';
  }else{
    btn.textContent = dash.selectedSlinIds.length + ' of ' + total + ' selected';
  }
}

function toggleSlinPicker(){
  var panel = document.getElementById('cfd-slin-picker-panel');
  if(panel.style.display !== 'none'){ panel.style.display = 'none'; return; }
  renderSlinPicker();
  panel.style.display = 'block';
}

function renderSlinPicker(){
  var panel = document.getElementById('cfd-slin-picker-panel');
  var inScope = currentTaskOrderScope();
  var selected = dash.selectedSlinIds || inScope;
  panel.innerHTML = '<div class="cfd-slin-picker-actions"><button type="button" onclick="selectAllSlins(true)">Select All</button><button type="button" onclick="selectAllSlins(false)">Clear</button></div>'
    + inScope.map(function(id){
      var s = dash.slins.find(function(x){ return x.slin_id === id; });
      var checked = selected.indexOf(id) !== -1;
      return '<label class="cfd-slin-picker-row"><input type="checkbox" data-slin-id="' + id + '"' + (checked ? ' checked' : '') + ' onchange="applySlinPicker()"> <span>' + escAttr(s.slin_code) + ' — ' + escAttr(s.slin_description || s.slin_category) + '</span></label>';
    }).join('');
}

function applySlinPicker(){
  var checked = Array.prototype.slice.call(document.querySelectorAll('#cfd-slin-picker-panel input[type=checkbox]:checked'));
  dash.selectedSlinIds = checked.map(function(c){ return c.dataset.slinId; });
  updateSlinPickerButtonLabel();
  renderAll();
}

function selectAllSlins(all){
  dash.selectedSlinIds = all ? null : [];
  renderSlinPicker();
  updateSlinPickerButtonLabel();
  renderAll();
}

// ---------- Metric primitives ----------

function latestFunding(slinId, asOfDate){
  var rows = dash.funding.filter(function(f){ return f.slin_id === slinId && (!asOfDate || f.mod_date <= asOfDate); });
  if(!rows.length){ return 0; }
  rows.sort(function(a, b){ return a.mod_date < b.mod_date ? -1 : 1; });
  return Number(rows[rows.length - 1].cumulative_total);
}

function rateFor(employeeId){
  var r = dash.rates.find(function(x){ return x.employee_id === employeeId; });
  return r ? Number(r.bill_rate_with_fee) : 0;
}

function laborBurn(slinIds, fromDate, toDate){
  var idSet = {}; slinIds.forEach(function(id){ idSet[id] = true; });
  var total = 0;
  dash.timeEntries.forEach(function(te){
    if(!idSet[te.slin_id]){ return; }
    if(fromDate && te.work_date < fromDate){ return; }
    if(toDate && te.work_date > toDate){ return; }
    total += Number(te.hours) * rateFor(te.employee_id);
  });
  return total;
}

function computeMetrics(slinIds, asOfDate){
  var idSet = {}; slinIds.forEach(function(id){ idSet[id] = true; });
  var funded = 0;
  slinIds.forEach(function(id){ funded += latestFunding(id, asOfDate); });

  var actualLabor = laborBurn(slinIds, null, asOfDate);
  var actualOdc = 0, committedOdc = 0;

  dash.travelExpenses.forEach(function(tx){ if(idSet[tx.slin_id]){ actualOdc += Number(tx.actual_total_odc || 0); } });
  dash.odc.forEach(function(o){
    if(!idSet[o.slin_id]){ return; }
    if(o.status === 'closed'){
      if(!asOfDate || (o.actual_date && o.actual_date <= asOfDate)){ actualOdc += Number(o.actual_amount || 0); }
    }else if(o.status === 'open'){
      committedOdc += Number(o.committed_amount || 0);
    }
  });

  var actual = actualLabor + actualOdc;
  var available = funded - actual - committedOdc;
  return { funded: funded, actual: actual, actualLabor: actualLabor, actualOdc: actualOdc, committedOdc: committedOdc, available: available };
}

function latestPopEnd(slinIds){
  return dash.slins.filter(function(s){ return slinIds.indexOf(s.slin_id) !== -1; })
    .map(function(s){ return s.pop_end; }).filter(Boolean).sort().pop();
}

function monthsBetween(a, b){
  var da = new Date(a), db = new Date(b);
  return Math.max(0, (db - da) / (1000 * 60 * 60 * 24 * 30.44));
}

// Trailing 90-day burn rate, projected to pop_end, plus committed ODC —
// the formula HANDOFF proposed but never signed off (see file header).
function computeForecast(slinIds, asOfDate, metrics){
  var d90 = new Date(asOfDate); d90.setDate(d90.getDate() - 90);
  var trailing = laborBurn(slinIds, d90.toISOString().slice(0, 10), asOfDate);
  var monthlyRate = trailing / 3;
  var popEnd = latestPopEnd(slinIds);
  var remainingMonths = popEnd ? monthsBetween(asOfDate, popEnd) : 0;
  var etc = monthlyRate * remainingMonths;
  var eac = metrics.actual + etc + metrics.committedOdc;
  var variance = eac - metrics.funded;
  var variancePct = metrics.funded ? (variance / metrics.funded) * 100 : 0;
  var confidence = variancePct <= 0 ? 'high' : (variancePct <= 10 ? 'medium' : 'low');

  var runoutDate = null;
  if(monthlyRate > 0 && metrics.available > 0){
    var monthsLeft = metrics.available / monthlyRate;
    var rd = new Date(asOfDate); rd.setDate(rd.getDate() + Math.round(monthsLeft * 30.44));
    runoutDate = rd.toISOString().slice(0, 10);
  }else if(metrics.available <= 0){
    runoutDate = asOfDate;
  }

  return { monthlyRate: monthlyRate, popEnd: popEnd, remainingMonths: remainingMonths, etc: etc, eac: eac, variance: variance, variancePct: variancePct, confidence: confidence, runoutDate: runoutDate };
}

// ---------- Rendering ----------

function money(v, compact){
  var n = Number(v || 0);
  if(compact && Math.abs(n) >= 1000000){ return '$' + (n / 1000000).toFixed(2) + 'M'; }
  if(compact && Math.abs(n) >= 1000){ return '$' + (n / 1000).toFixed(0) + 'K'; }
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function pct(v){ return Math.round(v) + '%'; }

function renderAll(){
  var startDate = document.getElementById('cfd-filter-start').value || null;
  var asOfDate = document.getElementById('cfd-filter-end').value || new Date().toISOString().slice(0, 10);
  var slinIds = scopedSlinIds();
  var metrics = computeMetrics(slinIds, asOfDate);
  var forecast = computeForecast(slinIds, asOfDate, metrics);
  dash.lastSlinIds = slinIds; dash.lastAsOfDate = asOfDate; dash.lastMetrics = metrics; dash.lastForecast = forecast;

  renderKpis(metrics, forecast);
  renderLaborClins(slinIds, asOfDate);
  renderOdcTable(slinIds);
  renderOdcClins(slinIds, asOfDate);
  renderChart(slinIds, asOfDate, metrics, forecast, startDate);
  renderForecastBar(forecast);
  renderEditPanel(slinIds);
}

function renderKpis(metrics, forecast){
  document.getElementById('cfd-kpi-funded').textContent = money(metrics.funded, true);
  document.getElementById('cfd-kpi-funded-sub').textContent = 'Labor ' + money(metrics.funded - metrics.committedOdc - metrics.actualOdc, true) + ' incl. ODC';

  document.getElementById('cfd-kpi-actual').textContent = money(metrics.actual, true);
  document.getElementById('cfd-kpi-actual-sub').textContent = metrics.funded ? (pct(metrics.actual / metrics.funded * 100) + ' of Funded Value') : '—';

  document.getElementById('cfd-kpi-odc').textContent = money(metrics.committedOdc, true);
  document.getElementById('cfd-kpi-odc-sub').textContent = metrics.funded ? (pct(metrics.committedOdc / metrics.funded * 100) + ' of Funded Value') : '—';

  document.getElementById('cfd-kpi-balance').textContent = money(metrics.available, true);
  document.getElementById('cfd-kpi-balance-sub').textContent = metrics.funded ? (pct(metrics.available / metrics.funded * 100) + ' of Funded Value') : '—';

  document.getElementById('cfd-kpi-eac').textContent = money(forecast.eac, true);
  document.getElementById('cfd-kpi-eac-sub').textContent = metrics.funded ? (pct(forecast.eac / metrics.funded * 100) + ' of Funded Value') : '—';

  document.getElementById('cfd-kpi-exhaustion').textContent = forecast.runoutDate ? new Date(forecast.runoutDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : 'N/A';
  document.getElementById('cfd-kpi-exhaustion-sub').textContent = forecast.popEnd ? (Math.round(forecast.remainingMonths) + ' months to PoP end') : '';
}

function renderLaborClins(slinIds, asOfDate){
  var wrap = document.getElementById('cfd-labor-clins');
  var laborSlins = dash.slins.filter(function(s){ return slinIds.indexOf(s.slin_id) !== -1 && s.slin_category === 'Labor/Fee'; });
  if(!laborSlins.length){ wrap.innerHTML = '<div class="tk-empty">No labor CLINs in this scope.</div>'; return; }

  wrap.innerHTML = laborSlins.map(function(s){
    var m = computeMetrics([s.slin_id], asOfDate);
    var f = computeForecast([s.slin_id], asOfDate, m);
    var pctFunded = m.funded ? Math.min(100, (m.actual / m.funded) * 100) : 0;
    var timeElapsed = s.pop_start ? monthsBetween(s.pop_start, asOfDate) : 0;
    var timeTotal = (s.pop_start && s.pop_end) ? monthsBetween(s.pop_start, s.pop_end) : 0;
    var timePct = timeTotal ? Math.min(100, (timeElapsed / timeTotal) * 100) : 0;
    var barColor = pctFunded > 90 ? 'var(--cfd-red)' : (pctFunded > 70 ? 'var(--cfd-orange)' : 'var(--cfd-blue)');

    return '<div class="cfd-labor-card" onclick="openClinDetail(\'' + s.slin_id + '\')">'
      + '<div class="cfd-labor-main">'
      + '<div class="cfd-labor-title">' + escAttr(s.slin_code) + (s.option_year ? (' · ' + escAttr(s.option_year)) : '') + '</div>'
      + '<div class="cfd-labor-sub">' + escAttr(s.slin_description || '') + ' · ' + escAttr(s.contract_type || '') + '</div>'
      + '<div class="cfd-progress-track"><div class="cfd-progress-fill" style="width:' + pctFunded.toFixed(0) + '%;background:' + barColor + ';"></div></div>'
      + '<div class="cfd-labor-figures">'
      + '<div>Funded<strong>' + money(m.funded, true) + '</strong></div>'
      + '<div>Actual<strong>' + money(m.actual, true) + '</strong></div>'
      + '<div>Available<strong>' + money(m.available, true) + '</strong></div>'
      + '<div>Burn Rate (90d)<strong>' + money(f.monthlyRate, true) + '/mo</strong></div>'
      + '<div>ETC<strong>' + money(f.etc, true) + '</strong></div>'
      + '<div>EAC<strong>' + money(f.eac, true) + '</strong></div>'
      + '</div>'
      + '</div>'
      + '<div class="cfd-gauge-wrap">'
      + gaugeHtml(timePct, 'var(--cfd-orange)', pct(timePct))
      + '<div class="cfd-gauge-label">Time: ' + Math.round(timeElapsed) + '/' + Math.round(timeTotal) + ' mo</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function gaugeHtml(pctValue, color, centerText){
  var deg = Math.max(0, Math.min(100, pctValue)) * 3.6;
  return '<div class="cfd-gauge" style="background:conic-gradient(' + color + ' 0deg ' + deg + 'deg, var(--raised) ' + deg + 'deg 360deg);">'
    + '<div class="cfd-gauge-inner">' + centerText + '</div></div>';
}

function renderOdcTable(slinIds){
  var wrap = document.getElementById('cfd-odc-table-wrap');
  var idSet = {}; slinIds.forEach(function(id){ idSet[id] = true; });
  var open = dash.odc.filter(function(o){ return idSet[o.slin_id] && o.status === 'open'; });
  var canEdit = isCustomerAdmin();

  if(!open.length){ wrap.innerHTML = '<div class="tk-empty">No open ODC commitments in this scope.</div>'; return; }

  var total = open.reduce(function(sum, o){ return sum + Number(o.committed_amount || 0); }, 0);
  wrap.innerHTML = '<table class="cfd-odc-table"><thead><tr><th>Description</th><th>SLIN</th><th>Reference</th><th>Amount</th><th>Status</th><th>Expected</th>' + (canEdit ? '<th></th>' : '') + '</tr></thead><tbody>'
    + open.map(function(o){
        var slin = dash.slins.find(function(s){ return s.slin_id === o.slin_id; });
        return '<tr onclick="openOdcDetail(\'' + o.id + '\')">'
          + '<td>' + escAttr(o.description) + '</td><td>' + escAttr(slin ? slin.slin_code : '') + '</td><td>' + escAttr(o.reference_number || '—') + '</td>'
          + '<td>' + money(o.committed_amount) + '</td><td><span class="tk-status-pill open">Open</span></td><td>' + (o.expected_date || '—') + '</td>'
          + (canEdit ? ('<td><button class="btn-edit" style="padding:4px 10px;font-size:11px;" onclick="event.stopPropagation();closeOdcCommitment(\'' + o.id + '\')">Close</button></td>') : '')
          + '</tr>';
      }).join('')
    + '</tbody><tfoot><tr><td colspan="3">Total Open Commitments</td><td>' + money(total) + '</td><td colspan="' + (canEdit ? 3 : 2) + '"></td></tr></tfoot></table>';
}

function renderOdcClins(slinIds, asOfDate){
  var wrap = document.getElementById('cfd-odc-clins');
  var odcSlins = dash.slins.filter(function(s){ return slinIds.indexOf(s.slin_id) !== -1 && s.slin_category !== 'Labor/Fee'; });
  if(!odcSlins.length){ wrap.innerHTML = '<div class="tk-empty">No ODC CLINs in this scope.</div>'; return; }

  wrap.innerHTML = odcSlins.map(function(s){
    var m = computeMetrics([s.slin_id], asOfDate);
    var actualPct = m.funded ? (m.actual / m.funded) * 100 : 0;
    var committedPct = m.funded ? (m.committedOdc / m.funded) * 100 : 0;
    var combinedPct = Math.min(100, actualPct + committedPct);
    var deg1 = actualPct * 3.6;
    var deg2 = Math.min(360, (actualPct + committedPct) * 3.6);
    var gauge = '<div class="cfd-gauge" style="width:64px;height:64px;background:conic-gradient(var(--cfd-green) 0deg ' + deg1 + 'deg, var(--cfd-purple) ' + deg1 + 'deg ' + deg2 + 'deg, var(--raised) ' + deg2 + 'deg 360deg);">'
      + '<div class="cfd-gauge-inner" style="width:47px;height:47px;flex-direction:column;">'
      + '<div style="font-size:13px;font-weight:700;">' + pct(combinedPct) + '</div>'
      + '<div style="font-size:7px;color:var(--muted);text-transform:uppercase;">Actual+Cmt</div>'
      + '</div></div>';

    return '<div class="cfd-odc-clin-card" onclick="openClinDetail(\'' + s.slin_id + '\')">'
      + gauge
      + '<div class="cfd-odc-clin-info">'
      + '<div class="cfd-odc-clin-title">' + escAttr(s.slin_code) + ' — ' + escAttr(s.slin_description || s.slin_category) + '</div>'
      + '<div class="cfd-odc-clin-sub">Funded: ' + money(m.funded, true) + '</div>'
      + '<div class="cfd-odc-legend">'
      + '<span><span class="cfd-dot" style="background:var(--cfd-green);"></span>Actual ' + money(m.actual, true) + '</span>'
      + '<span><span class="cfd-dot" style="background:var(--cfd-purple);"></span>Committed ' + money(m.committedOdc, true) + '</span>'
      + '<span><span class="cfd-dot" style="background:var(--raised);border:1px solid var(--border);"></span>Available ' + money(m.available, true) + '</span>'
      + '</div></div></div>';
  }).join('');
}

function renderForecastBar(forecast){
  var el = document.getElementById('cfd-forecast-bar');
  var confClass = 'cfd-confidence-' + forecast.confidence;
  var confLabel = forecast.confidence.charAt(0).toUpperCase() + forecast.confidence.slice(1);
  el.innerHTML = '<div style="flex:1;min-width:240px;"><div class="tk-section-title" style="margin-bottom:2px;">Forecast Summary</div>'
    + '<div class="placeholder-sub">Based on trailing 90-day labor burn plus outstanding ODC commitments. Not a signed-off estimating methodology — placeholder pending Indirect Rate Monitoring review.</div></div>'
    + '<div class="cfd-forecast-item">EAC (Estimate at Completion)<strong>' + money(forecast.eac, true) + '</strong></div>'
    + '<div class="cfd-forecast-item">Variance to Funded<strong>' + (forecast.variance >= 0 ? '(' + money(Math.abs(forecast.variance), true) + ')' : money(forecast.variance, true)) + '</strong></div>'
    + '<div class="cfd-forecast-item">Variance %<strong>' + forecast.variancePct.toFixed(1) + '%</strong></div>'
    + '<div class="cfd-forecast-item">Confidence<div style="margin-top:4px;"><span class="cfd-confidence-pill ' + confClass + '">' + confLabel + '</span></div></div>'
    + '<div class="cfd-forecast-item"><button type="button" class="btn-edit" onclick="emailReport()">Email Me This Report</button><div class="placeholder-sub" id="email-report-status" style="margin-top:4px;"></div></div>';
}

// ---------- Email Report (Resend, via the send-report Edge Function) ----------

function buildReportHtml(){
  var slinIds = dash.lastSlinIds, asOfDate = dash.lastAsOfDate, metrics = dash.lastMetrics, forecast = dash.lastForecast;
  var scopeLabel = document.getElementById('cfd-filter-taskorder').selectedOptions[0].textContent
    + ' · ' + document.getElementById('cfd-filter-contract').selectedOptions[0].textContent;

  var laborRows = dash.slins.filter(function(s){ return slinIds.indexOf(s.slin_id) !== -1 && s.slin_category === 'Labor/Fee'; })
    .map(function(s){
      var m = computeMetrics([s.slin_id], asOfDate);
      return '<tr><td>' + escAttr(s.slin_code) + '</td><td>' + escAttr(s.slin_description || '') + '</td><td>' + money(m.funded) + '</td><td>' + money(m.actual) + '</td><td>' + money(m.available) + '</td></tr>';
    }).join('');

  var idSet = {}; slinIds.forEach(function(id){ idSet[id] = true; });
  var openOdc = dash.odc.filter(function(o){ return idSet[o.slin_id] && o.status === 'open'; })
    .map(function(o){
      var s = dash.slins.find(function(x){ return x.slin_id === o.slin_id; });
      return '<tr><td>' + escAttr(o.description) + '</td><td>' + escAttr(s ? s.slin_code : '') + '</td><td>' + money(o.committed_amount) + '</td><td>' + (o.expected_date || '—') + '</td></tr>';
    }).join('');

  var tableStyle = 'width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;';
  var thStyle = 'text-align:left;padding:6px 8px;border-bottom:2px solid #2E3440;color:#5C607E;font-size:11px;text-transform:uppercase;';
  var tdStyle = 'padding:6px 8px;border-bottom:1px solid #E5E7EB;';

  return '<div style="font-family:Arial,sans-serif;color:#1B1D22;max-width:640px;">'
    + '<h2 style="font-family:Arial,sans-serif;">Contract Financial Dashboard — Sample Report</h2>'
    + '<p style="color:#5C6472;font-size:13px;">Scope: ' + escAttr(scopeLabel) + ' &middot; Data as of ' + escAttr(asOfDate) + '</p>'
    + '<table style="' + tableStyle + '"><tr>'
    + '<td style="' + tdStyle + '"><strong>Funded</strong><br>' + money(metrics.funded) + '</td>'
    + '<td style="' + tdStyle + '"><strong>Actual</strong><br>' + money(metrics.actual) + '</td>'
    + '<td style="' + tdStyle + '"><strong>Available</strong><br>' + money(metrics.available) + '</td>'
    + '<td style="' + tdStyle + '"><strong>EAC</strong><br>' + money(forecast.eac) + '</td>'
    + '</tr></table>'
    + '<h3>Labor CLINs</h3>'
    + '<table style="' + tableStyle + '"><tr><th style="' + thStyle + '">SLIN</th><th style="' + thStyle + '">Description</th><th style="' + thStyle + '">Funded</th><th style="' + thStyle + '">Actual</th><th style="' + thStyle + '">Available</th></tr>'
    + (laborRows || '<tr><td style="' + tdStyle + '" colspan="5">None in scope.</td></tr>') + '</table>'
    + '<h3>Open ODC Commitments</h3>'
    + '<table style="' + tableStyle + '"><tr><th style="' + thStyle + '">Description</th><th style="' + thStyle + '">SLIN</th><th style="' + thStyle + '">Amount</th><th style="' + thStyle + '">Expected</th></tr>'
    + (openOdc || '<tr><td style="' + tdStyle + '" colspan="4">None in scope.</td></tr>') + '</table>'
    + '<p style="color:#767C8A;font-size:11px;">This is a sample report generated from the Axiom Forward Consulting demo. Forecast figures are a placeholder methodology, not signed off.</p>'
    + '</div>';
}

async function emailReport(){
  var statusEl = document.getElementById('email-report-status');
  statusEl.textContent = 'Sending...';
  try{
    var { data, error } = await supabaseClient.functions.invoke('send-report', {
      body: { subject: 'Axiom Forward Consulting — Sample Contract Financial Report', html: buildReportHtml() }
    });
    if(error){ throw error; }
    if(data && data.error){ throw new Error(data.error); }
    statusEl.textContent = 'Sent — check your inbox.';
  }catch(e){
    statusEl.textContent = 'Could not send — try again.';
    console.error(e);
  }
}

// ---------- Chart: Funded (flat) / Actuals (cumulative) / EAC (dashed
// projection) / Exhaustion (vertical marker) ----------

function renderChart(slinIds, asOfDate, metrics, forecast, startDate){
  var wrap = document.getElementById('cfd-chart-wrap');
  var bannerWrap = document.getElementById('cfd-exhaustion-banner-wrap');
  var idSet = {}; slinIds.forEach(function(id){ idSet[id] = true; });

  var entries = dash.timeEntries.filter(function(te){ return idSet[te.slin_id]; });
  if(!entries.length){ wrap.innerHTML = '<div class="dash-card-empty">No burn history in this scope.</div>'; bannerWrap.innerHTML = ''; return; }

  var byMonth = {};
  entries.forEach(function(te){
    var m = te.work_date.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + Number(te.hours) * rateFor(te.employee_id);
  });
  var months = Object.keys(byMonth).sort();
  var cumulative = 0;
  // Cumulative is computed over the FULL history so values stay correct;
  // startDate only trims which points are plotted (chart zoom), per the
  // decision that Start Date zooms the trend chart while End Date drives
  // the KPI cutoffs.
  var allActualPoints = months.map(function(m){ cumulative += byMonth[m]; return { month: m, value: cumulative }; });
  var startMonth = startDate ? startDate.slice(0, 7) : null;
  var actualPoints = startMonth ? allActualPoints.filter(function(p){ return p.month >= startMonth; }) : allActualPoints;
  if(!actualPoints.length){ actualPoints = allActualPoints.slice(-1); }

  // Project EAC forward monthly from the last actual point to pop_end.
  var eacPoints = [];
  if(forecast.popEnd && forecast.monthlyRate > 0 && allActualPoints.length){
    var last = allActualPoints[allActualPoints.length - 1];
    var cursor = new Date(last.month + '-01');
    var v = last.value;
    var monthsOut = Math.ceil(forecast.remainingMonths);
    for(var i = 1; i <= monthsOut; i++){
      cursor.setMonth(cursor.getMonth() + 1);
      v += forecast.monthlyRate;
      eacPoints.push({ month: cursor.toISOString().slice(0, 7), value: v });
    }
  }

  var allPoints = actualPoints.concat(eacPoints);
  var w = 900, h = 75, pad = 16;
  var maxV = Math.max(metrics.funded, Math.max.apply(null, allPoints.map(function(p){ return p.value; })) || 1);
  var n = allPoints.length;
  var stepX = n > 1 ? (w - pad * 2) / (n - 1) : 0;

  function xFor(i){ return pad + i * stepX; }
  function yFor(v){ return h - pad - (v / maxV) * (h - pad * 2); }

  var actualCoords = actualPoints.map(function(p, i){ return { x: xFor(i), y: yFor(p.value) }; });
  var eacCoords = eacPoints.map(function(p, i){ return { x: xFor(actualPoints.length - 1 + i + 1), y: yFor(p.value) }; });
  var eacPath = eacCoords.length ? ('M' + actualCoords[actualCoords.length - 1].x.toFixed(1) + ',' + actualCoords[actualCoords.length - 1].y.toFixed(1) + ' ' + eacCoords.map(function(c){ return 'L' + c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' ')) : '';
  var actualPath = actualCoords.map(function(c, i){ return (i === 0 ? 'M' : 'L') + c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' ');
  var fundedY = yFor(metrics.funded);

  var exhaustionX = null;
  if(forecast.runoutDate){
    var exMonth = forecast.runoutDate.slice(0, 7);
    var idx = allPoints.findIndex(function(p){ return p.month >= exMonth; });
    if(idx !== -1){ exhaustionX = xFor(idx); }
  }

  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:75px;" preserveAspectRatio="none">'
    + '<line x1="' + pad + '" y1="' + fundedY.toFixed(1) + '" x2="' + (w - pad) + '" y2="' + fundedY.toFixed(1) + '" stroke="var(--cfd-green)" stroke-width="2" stroke-dasharray="6,4"></line>'
    + '<path d="' + actualPath + '" fill="none" stroke="var(--cfd-blue)" stroke-width="2.5"></path>'
    + (eacPath ? '<path d="' + eacPath + '" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4,4"></path>' : '')
    + (exhaustionX !== null ? '<line x1="' + exhaustionX.toFixed(1) + '" y1="' + pad + '" x2="' + exhaustionX.toFixed(1) + '" y2="' + (h - pad) + '" stroke="var(--cfd-red)" stroke-width="2" stroke-dasharray="3,3"></line>' : '')
    + actualCoords.map(function(c){ return '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="2.5" fill="var(--cfd-blue)"></circle>'; }).join('')
    + '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) + '" stroke="var(--border)" stroke-width="1"></line>'
    + '</svg>';

  var legend = '<div class="cfd-odc-legend" style="justify-content:flex-start;margin-top:6px;">'
    + '<span><span class="cfd-dot" style="background:var(--cfd-green);"></span>Funded Value</span>'
    + '<span><span class="cfd-dot" style="background:var(--cfd-blue);"></span>Actuals (Incurred)</span>'
    + '<span><span class="cfd-dot" style="background:var(--muted);"></span>EAC (Projected)</span>'
    + '<span><span class="cfd-dot" style="background:var(--cfd-red);"></span>Projected Exhaustion</span>'
    + '</div>';
  var axis = '<div style="display:flex;justify-content:space-between;font-size:10px;font-family:\'DM Mono\',monospace;color:var(--muted);">'
    + '<span>' + (allPoints[0] ? allPoints[0].month : '') + '</span><span>' + (allPoints[allPoints.length - 1] ? allPoints[allPoints.length - 1].month : '') + '</span></div>';

  wrap.innerHTML = svg + axis + legend;
  bannerWrap.innerHTML = forecast.runoutDate
    ? '<div class="cfd-exhaustion-banner">Projected Funding Exhaustion: ' + new Date(forecast.runoutDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + '</div>'
    : '';
}

// ---------- Edit actions (Customer Admin / platform admin only) ----------

function renderEditPanel(slinIds){
  var wrap = document.getElementById('cfd-edit-wrap');
  if(!isCustomerAdmin()){ wrap.innerHTML = ''; return; }
  var laborSlins = dash.slins.filter(function(s){ return slinIds.indexOf(s.slin_id) !== -1 && s.slin_category === 'Labor/Fee'; });
  var odcSlins = dash.slins.filter(function(s){ return slinIds.indexOf(s.slin_id) !== -1 && s.slin_category !== 'Labor/Fee'; });

  wrap.innerHTML = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Add Funding Mod</div>'
    + '<div class="asset-form-grid">'
    + '<div><label class="field-label">SLIN</label><select id="edit-mod-slin" class="field-input">' + laborSlins.concat(odcSlins).map(function(s){ return '<option value="' + s.slin_id + '">' + escAttr(s.slin_code) + '</option>'; }).join('') + '</select></div>'
    + '<div><label class="field-label">Mod Number</label><input id="edit-mod-number" class="field-input" placeholder="Mod 20"></div>'
    + '<div><label class="field-label">Mod Date</label><input id="edit-mod-date" type="date" class="field-input"></div>'
    + '<div><label class="field-label">Award Amount</label><input id="edit-mod-award" type="number" class="field-input"></div>'
    + '</div>'
    + '<button class="btn-edit" onclick="submitAddFundingMod()">Save Funding Mod</button>'
    + '<div class="login-error" id="edit-mod-error"></div>'
    + '</div>'
    + (odcSlins.length ? (
      '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Add ODC Commitment</div>'
      + '<div class="asset-form-grid">'
      + '<div><label class="field-label">SLIN</label><select id="edit-odc-slin" class="field-input">' + odcSlins.map(function(s){ return '<option value="' + s.slin_id + '">' + escAttr(s.slin_code) + '</option>'; }).join('') + '</select></div>'
      + '<div><label class="field-label">Description</label><input id="edit-odc-desc" class="field-input"></div>'
      + '<div><label class="field-label">Reference #</label><input id="edit-odc-ref" class="field-input"></div>'
      + '<div><label class="field-label">Committed Amount</label><input id="edit-odc-amount" type="number" class="field-input"></div>'
      + '</div>'
      + '<button class="btn-edit" onclick="submitAddOdc()">Save ODC Commitment</button>'
      + '<div class="login-error" id="edit-odc-error"></div>'
      + '</div>'
    ) : '');
}

async function submitAddFundingMod(){
  var errorEl = document.getElementById('edit-mod-error');
  var slinId = document.getElementById('edit-mod-slin').value;
  var modNumber = document.getElementById('edit-mod-number').value;
  var modDate = document.getElementById('edit-mod-date').value;
  var award = Number(document.getElementById('edit-mod-award').value || 0);
  if(!modDate || !award){ errorEl.textContent = 'Mod date and award amount are required.'; return; }
  var previous = latestFunding(slinId, null);
  try{
    var { error } = await supabaseClient.from('slin_funding_history').insert({
      slin_id: slinId, mod_number: modNumber || null, mod_date: modDate,
      previous_funding: previous, award_total: award, cumulative_total: previous + award
    });
    if(error){ throw error; }
    dash.loaded = false;
    await loadDashboard();
  }catch(e){
    errorEl.textContent = 'Could not save — try again.';
    console.error(e);
  }
}

// Actor (Supervisor -> demo_employees clone, Customer Admin -> customer_users
// row) resolved via app.js's resolveOdcActor() — odc_commitments requires
// exactly one of created_by_employee_id/created_by_customer_user_id set.
async function submitAddOdc(){
  var errorEl = document.getElementById('edit-odc-error');
  var slinId = document.getElementById('edit-odc-slin').value;
  var description = document.getElementById('edit-odc-desc').value;
  var amount = Number(document.getElementById('edit-odc-amount').value || 0);
  if(!description || !amount){ errorEl.textContent = 'Description and amount are required.'; return; }
  try{
    var actor = await resolveOdcActor();
    if(!actor){ errorEl.textContent = 'Select the Supervisor or Customer Admin role to add ODC commitments.'; return; }
    var { error } = await supabaseClient.from('odc_commitments').insert({
      slin_id: slinId, description: description,
      reference_number: document.getElementById('edit-odc-ref').value || null,
      committed_amount: amount, status: 'open',
      created_by_employee_id: actor.employee_id,
      created_by_customer_user_id: actor.customer_user_id
    });
    if(error){ throw error; }
    dash.loaded = false;
    await loadDashboard();
  }catch(e){
    errorEl.textContent = 'Could not save — try again.';
    console.error(e);
  }
}

// Single source of truth for closing an ODC commitment — called from both
// the Dashboard's Open ODC Commitments table and the ODC Procurements
// screen (js/odc.js). Uses the shared modal (app.js) instead of
// window.prompt.
function closeOdcCommitment(id){
  var todayStr = new Date().toISOString().slice(0, 10);
  var bodyHtml = '<div><label class="field-label">Actual Amount</label><input type="number" step="0.01" class="field-input" id="modal-odc-actual-amount"></div>'
    + '<div><label class="field-label">Actual Date</label><input type="date" class="field-input" id="modal-odc-actual-date" value="' + todayStr + '"></div>'
    + '<div class="login-error" id="modal-odc-close-error"></div>';
  var footerHtml = '<button class="btn-cancel" onclick="closeModal()">Cancel</button>'
    + '<button class="btn-save" onclick="confirmCloseOdcCommitment(\'' + id + '\')">Close Commitment</button>';
  openModal('Close ODC Commitment', bodyHtml, footerHtml);
}

async function confirmCloseOdcCommitment(id){
  var errorEl = document.getElementById('modal-odc-close-error');
  var actual = document.getElementById('modal-odc-actual-amount').value;
  var actualDate = document.getElementById('modal-odc-actual-date').value;
  if(!actual){ errorEl.textContent = 'Actual amount is required.'; return; }
  try{
    var actor = await resolveOdcActor();
    if(!actor){ errorEl.textContent = 'Select the Supervisor or Customer Admin role to close commitments.'; return; }
    var { error } = await supabaseClient.from('odc_commitments').update({
      status: 'closed', actual_amount: Number(actual), actual_date: actualDate || new Date().toISOString().slice(0, 10),
      closed_by_employee_id: actor.employee_id,
      closed_by_customer_user_id: actor.customer_user_id
    }).eq('id', id);
    if(error){ throw error; }
    closeModal();
    if(document.getElementById('screen-home').classList.contains('active')){ dash.loaded = false; await loadDashboard(); }
    if(typeof odcProc !== 'undefined' && document.getElementById('screen-odc').classList.contains('active')){ odcProc.loaded = false; await loadOdcScreen(); }
  }catch(e){
    errorEl.textContent = 'Could not close the commitment — try again.';
    console.error(e);
  }
}

// ---------- Drill-down popups (dashboard cards -> Contract Data / ODC
// Procurements deep links) ----------

function openClinDetail(slinId){
  var s = dash.slins.find(function(x){ return x.slin_id === slinId; });
  if(!s){ return; }
  var node = dash.nodes.find(function(n){ return n.node_id === s.billing_node_id; });
  var taskOrderNode = node && node.parent_node_id ? dash.nodes.find(function(n){ return n.node_id === node.parent_node_id; }) : null;
  var latest = dash.funding.filter(function(f){ return f.slin_id === slinId; }).sort(function(a, b){ return a.mod_date < b.mod_date ? -1 : 1; }).pop();
  var m = computeMetrics([slinId], dash.lastAsOfDate || new Date().toISOString().slice(0, 10));

  var bodyHtml = '<div class="profile-grid">'
    + travelReadOnlyField('SLIN', s.slin_code)
    + travelReadOnlyField('Category', s.slin_category)
    + travelReadOnlyField('Description', s.slin_description)
    + travelReadOnlyField('Option Year', s.option_year)
    + travelReadOnlyField('Period of Performance', formatDate(s.pop_start) + ' – ' + formatDate(s.pop_end))
    + travelReadOnlyField('Status', s.status)
    + travelReadOnlyField('Funded (latest mod)', money(m.funded))
    + travelReadOnlyField('Actual', money(m.actual))
    + travelReadOnlyField('Available', money(m.available))
    + travelReadOnlyField('Last Funding Mod', latest ? (latest.mod_number || '—') + ' — ' + formatDate(latest.mod_date) : '—')
    + '</div>';
  var footerHtml = '<button class="btn-cancel" onclick="closeModal()">Close</button>'
    + '<button class="btn-save" onclick="closeModal();switchScreen(\'burndown\');loadBurndownScreen(\'' + s.contract_id + '\',\'' + s.billing_node_id + '\');">Open in Contract Data &rarr;</button>';
  openModal(escAttr(s.slin_code) + (taskOrderNode ? (' — ' + escAttr(taskOrderNode.label)) : ''), bodyHtml, footerHtml);
}

function openOdcDetail(id){
  var o = dash.odc.find(function(x){ return x.id === id; });
  if(!o){ return; }
  var s = dash.slins.find(function(x){ return x.slin_id === o.slin_id; });

  var bodyHtml = '<div class="profile-grid">'
    + travelReadOnlyField('Description', o.description)
    + travelReadOnlyField('SLIN', s ? s.slin_code : '—')
    + travelReadOnlyField('Reference #', o.reference_number)
    + travelReadOnlyField('Committed Amount', money(o.committed_amount))
    + travelReadOnlyField('Status', o.status)
    + travelReadOnlyField('Expected Date', formatDate(o.expected_date))
    + travelReadOnlyField('Actual Amount', o.actual_amount != null ? money(o.actual_amount) : '—')
    + travelReadOnlyField('Actual Date', formatDate(o.actual_date))
    + '</div>';
  var footerHtml = '<button class="btn-cancel" onclick="closeModal()">Close</button>'
    + '<button class="btn-save" onclick="closeModal();switchScreen(\'odc\');loadOdcScreen(\'' + id + '\');">Open in ODC Procurements &rarr;</button>';
  openModal(escAttr(o.description), bodyHtml, footerHtml);
}
