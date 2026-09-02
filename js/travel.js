// COA Customer Demo — travel.js
// Travel Estimate / Expense Report module, ported from the COA Employee
// Portal's screen-travel-estimate.js / screen-travel-expense.js (formulas
// and structure only — no real company data). Adapted for this app's
// persona model and Supabase-JS data access.
//
// Workflow (confirmed 2026-08-31):
//   Estimate: draft -> submitted -> supervisor_approved -> approved
//             (approved = Customer Admin/Prime has authorized travel)
//             -> expensed -> paid.  returned/denied are terminal.
//   Expense:  draft -> submitted -> approved (single-stage, Supervisor
//             only — Customer Admin has no role in reimbursement).
//
// Per-diem/EWW/fee-multiplier math (teCalc/texCalc) is verbatim from the
// source app: travel days = 1.5x M&IE once, full days = 1x M&IE each,
// per-traveler bucket (x trainers) vs. trip-level bucket (not multiplied).

var travel = {
  persona: null,       // 'employee' | 'supervisor' | 'customer_admin'
  employeeId: null,     // this guest's own demo_employees clone id (employee/supervisor)
  customerUserId: null,  // this guest's customer_users id (customer_admin)
  feeMultiplier: 1.10,
  odcSlins: [],
  subtab: ''
};

// 50 states + DC — feeds the State field's <datalist> (type-to-filter,
// stores the 2-letter abbreviation the GSA lookup expects).
var teUsStates = [
  {abbr:'AL',name:'Alabama'},{abbr:'AK',name:'Alaska'},{abbr:'AZ',name:'Arizona'},{abbr:'AR',name:'Arkansas'},
  {abbr:'CA',name:'California'},{abbr:'CO',name:'Colorado'},{abbr:'CT',name:'Connecticut'},{abbr:'DE',name:'Delaware'},
  {abbr:'DC',name:'District of Columbia'},{abbr:'FL',name:'Florida'},{abbr:'GA',name:'Georgia'},{abbr:'HI',name:'Hawaii'},
  {abbr:'ID',name:'Idaho'},{abbr:'IL',name:'Illinois'},{abbr:'IN',name:'Indiana'},{abbr:'IA',name:'Iowa'},
  {abbr:'KS',name:'Kansas'},{abbr:'KY',name:'Kentucky'},{abbr:'LA',name:'Louisiana'},{abbr:'ME',name:'Maine'},
  {abbr:'MD',name:'Maryland'},{abbr:'MA',name:'Massachusetts'},{abbr:'MI',name:'Michigan'},{abbr:'MN',name:'Minnesota'},
  {abbr:'MS',name:'Mississippi'},{abbr:'MO',name:'Missouri'},{abbr:'MT',name:'Montana'},{abbr:'NE',name:'Nebraska'},
  {abbr:'NV',name:'Nevada'},{abbr:'NH',name:'New Hampshire'},{abbr:'NJ',name:'New Jersey'},{abbr:'NM',name:'New Mexico'},
  {abbr:'NY',name:'New York'},{abbr:'NC',name:'North Carolina'},{abbr:'ND',name:'North Dakota'},{abbr:'OH',name:'Ohio'},
  {abbr:'OK',name:'Oklahoma'},{abbr:'OR',name:'Oregon'},{abbr:'PA',name:'Pennsylvania'},{abbr:'RI',name:'Rhode Island'},
  {abbr:'SC',name:'South Carolina'},{abbr:'SD',name:'South Dakota'},{abbr:'TN',name:'Tennessee'},{abbr:'TX',name:'Texas'},
  {abbr:'UT',name:'Utah'},{abbr:'VT',name:'Vermont'},{abbr:'VA',name:'Virginia'},{abbr:'WA',name:'Washington'},
  {abbr:'WV',name:'West Virginia'},{abbr:'WI',name:'Wisconsin'},{abbr:'WY',name:'Wyoming'}
];

async function loadTravelScreen(){
  var newPersona = currentPersonaSlug();
  if(newPersona !== travel.persona){
    // Persona changed (e.g. via Switch Role) — cached employee/customer-user
    // ids belonged to the PREVIOUS persona and must not be reused.
    travel.employeeId = null;
    travel.customerUserId = null;
  }
  travel.persona = newPersona;
  var bar = document.getElementById('travel-subtab-bar');
  var content = document.getElementById('travel-content');

  if(!travel.odcSlins.length){
    var { data: slins } = await supabaseClient.from('slins').select('slin_id,slin_code,slin_description,contract_id').eq('slin_category', 'ODC/Cost').order('slin_code');
    travel.odcSlins = slins || [];
    var { data: settings } = await supabaseClient.from('travel_settings').select('fee_multiplier').limit(1);
    if(settings && settings.length){ travel.feeMultiplier = parseFloat(settings[0].fee_multiplier) || 1.10; }
  }

  if(travel.persona === 'employee' || travel.persona === 'supervisor'){
    if(!travel.employeeId){
      var { data: emp, error: empErr } = await supabaseClient.from('demo_employees').select('id').eq('owner_profile_id', currentProfile.id).eq('persona_id', currentProfile.active_persona_id).limit(1);
      if(empErr){ console.error('Could not look up your employee clone:', empErr); }
      travel.employeeId = emp && emp.length ? emp[0].id : null;
      if(!travel.employeeId){
        console.error('No demo_employees clone found for owner_profile_id=' + currentProfile.id + ' persona_id=' + currentProfile.active_persona_id);
      }
    }
    var tabs = [{ id: 'estimates', label: 'My Estimates' }, { id: 'expenses', label: 'My Expenses' }];
    if(travel.persona === 'supervisor'){ tabs.push({ id: 'approvals', label: 'Approvals' }); }
    renderTravelSubtabBar(tabs, travel.subtab || 'estimates');
  }else if(travel.persona === 'customer_admin'){
    if(!travel.customerUserId){
      var { data: cu } = await supabaseClient.from('customer_users').select('id').eq('profile_id', currentProfile.id).limit(1);
      travel.customerUserId = cu && cu.length ? cu[0].id : null;
    }
    renderTravelSubtabBar([{ id: 'authorizations', label: 'Travel Authorizations' }], 'authorizations');
  }else{
    bar.innerHTML = '';
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Travel</div><div class="placeholder-sub">Not applicable to this role.</div></div>';
  }
}

function renderTravelSubtabBar(tabs, active){
  travel.subtab = active;
  document.getElementById('travel-subtab-bar').innerHTML = tabs.map(function(t){
    return '<button class="subtab-btn' + (t.id === active ? ' active' : '') + '" onclick="switchTravelSubtab(\'' + t.id + '\')">' + t.label + '</button>';
  }).join('');
  switchTravelSubtab(active, true);
}

function switchTravelSubtab(name, skipBarUpdate){
  travel.subtab = name;
  if(!skipBarUpdate){
    document.querySelectorAll('#travel-subtab-bar .subtab-btn').forEach(function(b, i){ b.classList.toggle('active', b.textContent.toLowerCase().indexOf(name.slice(0, 4)) !== -1); });
  }
  if(name === 'estimates'){ loadMyEstimates(); }
  if(name === 'expenses'){ loadMyExpenses(); }
  if(name === 'approvals'){ loadApprovalsQueue(); }
  if(name === 'authorizations'){ loadAuthorizationsQueue(); }
}

function travelReadOnlyField(label, value){
  return '<div class="info-box"><div class="info-label">' + escAttr(label) + '</div><div class="info-val">' + (value == null || value === '' ? '—' : escAttr(value)) + '</div></div>';
}

function slinOptionsHtml(selected){
  return '<option value=""' + (selected ? '' : ' selected') + '>— Select SLIN —</option>' + travel.odcSlins.map(function(s){
    return '<option value="' + s.slin_id + '"' + (s.slin_id === selected ? ' selected' : '') + '>' + escAttr(s.slin_code) + ' — ' + escAttr(s.slin_description || '') + '</option>';
  }).join('');
}

// =====================================================================
// TRAVEL ESTIMATE
// =====================================================================

var teEditingId = null;
var teEditingRow = null;
var teLodgingQuotes = [];

// Up to 4 travelers per estimate (travel_estimate_travelers), each linked to
// a real demo_employees record with its own EWW rate/hours. Slot 1 is always
// the submitter (travel.employeeId) and can't be removed; slots 2-4 are
// added/removed as the Trainers count changes.
var teTravelers = [];
var teEmployeeRoster = null;

// Set true by any edit to the open New/Edit Travel Estimate form (delegated
// listener below, scoped to #te-estimate-form), cleared on a fresh form load
// or a successful save — app.js's navigation guards (switchScreen/Switch
// Role/Sign Out) and the beforeunload handler below check this before
// letting the user leave the Travel screen with unsaved edits.
var teFormDirty = false;

function travelFormIsDirty(){
  return teFormDirty === true;
}

document.addEventListener('input', function(e){
  if(e.target.closest && e.target.closest('#te-estimate-form')){ teFormDirty = true; }
});
document.addEventListener('change', function(e){
  if(e.target.closest && e.target.closest('#te-estimate-form')){ teFormDirty = true; }
});
window.addEventListener('beforeunload', function(e){
  if(travelFormIsDirty()){ e.preventDefault(); e.returnValue = ''; }
});

async function loadMyEstimates(editId){
  var content = document.getElementById('travel-content');
  teEditingId = editId || null;
  teEditingRow = null;
  teFormDirty = false;

  if(!travel.employeeId){
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">No employee record found</div><div class="placeholder-sub">Try switching roles and back, or refreshing the page.</div></div>';
    return;
  }

  try{
    if(teEditingId){
      var { data: rows } = await supabaseClient.from('travel_estimates').select('*').eq('id', teEditingId).limit(1);
      if(rows && rows.length){ teEditingRow = rows[0]; }
    }

    var readOnlyStatuses = ['approved', 'expensed', 'paid', 'supervisor_approved'];
    if(teEditingRow && readOnlyStatuses.indexOf(teEditingRow.status) !== -1){
      var lists1 = await teRenderMyEstimatesLists();
      content.innerHTML = lists1.pendingHtml + '<div id="te-detail-wrap"></div>' + lists1.paidHtml;
      renderTeReadOnlyDetail(teEditingRow);
      return;
    }

    var teRejectionNote = null;
    if(teEditingRow && (teEditingRow.status === 'returned' || teEditingRow.status === 'denied')){
      try{
        var { data: noteRows } = await supabaseClient.from('travel_estimate_audit_log').select('*').eq('estimate_id', teEditingId).in('new_status', ['returned', 'denied']).order('changed_at', { ascending: false }).limit(1);
        if(noteRows && noteRows.length && noteRows[0].field_changes && noteRows[0].field_changes.note){
          teRejectionNote = noteRows[0].field_changes.note;
        }
      }catch(e){
        console.error(e);
      }
    }

    await teLoadTravelers();
    var lists2 = await teRenderMyEstimatesLists();
    content.innerHTML = lists2.pendingHtml + teFormHtml(teEditingRow, teRejectionNote) + lists2.paidHtml;
    if(teEditingRow){ tePrefillForm(teEditingRow); }
    await teLoadLodgingQuotes();
    teRecalc();
    teFormDirty = false;
  }catch(e){
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load travel estimates</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
    console.error(e);
  }
}

// ---------- Per-traveler EWW roster (up to 4 travelers per estimate) ----------

async function teFetchEmployeeRoster(){
  if(teEmployeeRoster){ return teEmployeeRoster; }
  var { data, error } = await supabaseClient.from('demo_employees').select('id,full_name').is('owner_profile_id', null).order('full_name');
  if(error){ throw error; }
  teEmployeeRoster = data || [];
  return teEmployeeRoster;
}

async function teLoadTravelers(){
  teTravelers = [];
  try{
    await teFetchEmployeeRoster();
    if(teEditingId){
      var { data: rows } = await supabaseClient.from('travel_estimate_travelers').select('*, demo_employees(full_name)').eq('estimate_id', teEditingId).order('traveler_number');
      if(rows && rows.length){
        teTravelers = rows.map(function(r){
          return {
            slot: r.traveler_number, employeeId: r.employee_id,
            employeeName: r.demo_employees ? r.demo_employees.full_name : null,
            ewwRate: parseFloat(r.eww_rate) || 0, ewwHours: parseFloat(r.eww_hours) || 0
          };
        });
      }
    }
  }catch(e){
    console.error(e);
  }
  if(!teTravelers.length){
    var names = await employeeNamesById([travel.employeeId]);
    teTravelers = [{ slot: 1, employeeId: travel.employeeId, employeeName: names[travel.employeeId] || null, ewwRate: 0, ewwHours: 0 }];
  }
}

function teRenderTravelerRows(){
  var roster = teEmployeeRoster || [];
  var chosenIds = teTravelers.map(function(t){ return t.employeeId; }).filter(Boolean);
  return teTravelers.map(function(t){
    var nameHtml;
    if(t.slot === 1){
      // Read-only, but rendered as a disabled field-input (not
      // travelReadOnlyField's info-box) so its height/padding matches the
      // <select> used for slots 2-4 and every row lines up.
      nameHtml = '<div><label class="field-label">Traveler 1 (You)</label><input class="field-input" value="' + escAttr(t.employeeName || '') + '" disabled></div>';
    }else{
      var options = '<option value="">— Select employee —</option>' + roster.filter(function(e){
        return e.id === t.employeeId || chosenIds.indexOf(e.id) === -1;
      }).map(function(e){
        return '<option value="' + e.id + '"' + (e.id === t.employeeId ? ' selected' : '') + '>' + escAttr(e.full_name) + '</option>';
      }).join('');
      nameHtml = '<div><label class="field-label">Traveler ' + t.slot + '</label><select class="field-input" onchange="teSelectTravelerEmployee(' + t.slot + ', this.value)">' + options + '</select></div>';
    }
    var ewwCost = (parseFloat(t.ewwRate) || 0) * (parseFloat(t.ewwHours) || 0);
    var removeBtn = t.slot === 1 ? '' : '<button type="button" class="btn-remove-row" style="font-size:40px;line-height:1;font-weight:700;" title="Remove traveler" onclick="teRemoveTraveler(' + t.slot + ')">&times;</button>';
    return '<div class="tk-pto-form-grid" style="grid-template-columns:1.4fr 1fr 1fr 1fr 32px;align-items:end;">'
      + nameHtml
      + '<div><label class="field-label">EWW Rate (per hour)</label><input type="number" step="0.01" class="field-input" value="' + t.ewwRate + '" onchange="teUpdateTravelerEww(' + t.slot + ',\'ewwRate\',this.value)"></div>'
      + '<div><label class="field-label">EWW Hours</label><input type="number" step="0.01" class="field-input" value="' + t.ewwHours + '" onchange="teUpdateTravelerEww(' + t.slot + ',\'ewwHours\',this.value)"></div>'
      + '<div class="info-box"><div class="info-label">EWW Cost</div><div class="info-val">$' + ewwCost.toFixed(2) + '</div></div>'
      + '<div style="align-self:stretch;display:flex;align-items:center;justify-content:center;">' + removeBtn + '</div>'
      + '</div>';
  }).join('');
}

function teRefreshTravelerRows(){
  var wrap = document.getElementById('te-traveler-rows');
  if(wrap){ wrap.innerHTML = teRenderTravelerRows(); }
  teRecalc();
}

function teSetTrainerCount(n){
  n = parseInt(n, 10) || 1;
  if(n < 1){ n = 1; }
  if(n > 4){ n = 4; }
  while(teTravelers.length < n){
    teTravelers.push({ slot: teTravelers.length + 1, employeeId: null, employeeName: null, ewwRate: 0, ewwHours: 0 });
  }
  if(teTravelers.length > n){ teTravelers.length = n; }
  var trainersInput = document.getElementById('te-trainers');
  if(trainersInput){ trainersInput.value = n; }
  teRefreshTravelerRows();
}

function teRemoveTraveler(slot){
  if(slot === 1){ return; }
  teTravelers = teTravelers.filter(function(t){ return t.slot !== slot; });
  teTravelers.forEach(function(t, i){ t.slot = i + 1; });
  var trainersInput = document.getElementById('te-trainers');
  if(trainersInput){ trainersInput.value = teTravelers.length; }
  teRefreshTravelerRows();
}

function teSelectTravelerEmployee(slot, employeeId){
  var t = teTravelers[slot - 1];
  if(!t){ return; }
  var emp = (teEmployeeRoster || []).find(function(e){ return e.id === employeeId; });
  t.employeeId = employeeId || null;
  t.employeeName = emp ? emp.full_name : null;
  teRefreshTravelerRows();
}

function teUpdateTravelerEww(slot, field, value){
  var t = teTravelers[slot - 1];
  if(!t){ return; }
  t[field] = parseFloat(value) || 0;
  teRecalc();
}

// Persists the current teTravelers array for an estimate: delete-then-insert
// avoids tracking which slots changed. Slots with no employee chosen yet
// (blank slots added by bumping Trainers, not yet assigned) are skipped —
// employee_id is NOT NULL on travel_estimate_travelers, and blank slots are
// only allowed to exist transiently on an unsubmitted draft.
async function teSaveTravelers(estimateId){
  var { error: delErr } = await supabaseClient.from('travel_estimate_travelers').delete().eq('estimate_id', estimateId);
  if(delErr){ throw delErr; }
  var rows = teTravelers.filter(function(t){ return t.employeeId; }).map(function(t){
    return { estimate_id: estimateId, employee_id: t.employeeId, traveler_number: t.slot, eww_rate: t.ewwRate, eww_hours: t.ewwHours };
  });
  if(!rows.length){ return; }
  var { error: insErr } = await supabaseClient.from('travel_estimate_travelers').insert(rows);
  if(insErr){ throw insErr; }
}

function teFormHtml(row, rejectionNote){
  var formTitle = row ? ((row.status === 'returned' || row.status === 'denied') ? 'Edit & Resubmit Travel Estimate' : 'Edit Draft Travel Estimate') : 'New Travel Estimate';
  var rejectionBannerHtml = '';
  if(row && (row.status === 'returned' || row.status === 'denied') && rejectionNote){
    rejectionBannerHtml = '<div class="warning-box">'
      + '<div><div class="warning-box-title">' + (row.status === 'denied' ? 'This request was denied' : 'This request was returned') + '</div>'
      + '<div class="warning-box-text">' + escAttr(rejectionNote) + '</div></div>'
      + '</div>';
  }
  return '<div class="tk-entry-card" id="te-estimate-form">'
    + '<div class="tk-section-title">' + formTitle + '</div>'
    + rejectionBannerHtml
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 90px 343px;">'
    + '<div><label class="field-label" for="te-event-name">Event Name</label><input class="field-input" id="te-event-name" placeholder="Event name"></div>'
    + '<div><label class="field-label" for="te-city">City</label><input class="field-input" id="te-city" placeholder="City" onchange="teMaybeAutoLookupGsa()"></div>'
    + '<div><label class="field-label" for="te-state">State</label><input class="field-input" id="te-state" list="te-state-list" placeholder="ST" autocomplete="off" onchange="teMaybeAutoLookupGsa()"><datalist id="te-state-list">'
    + teUsStates.map(function(s){ return '<option value="' + s.abbr + '">' + s.name + '</option>'; }).join('')
    + '</datalist></div>'
    + '<div><label class="field-label" for="te-slin">SLIN</label><select class="field-input" id="te-slin">' + slinOptionsHtml() + '</select></div>'
    + '</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:140px 140px 100px;">'
    + '<div><label class="field-label" for="te-leave-date">Leave Date</label><input type="date" class="field-input" id="te-leave-date" oninput="teRecalc();teMaybeAutoLookupGsa();"></div>'
    + '<div><label class="field-label" for="te-return-date">Return Date</label><input type="date" class="field-input" id="te-return-date" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-trainers">Trainers</label><select class="field-input" id="te-trainers" onchange="teSetTrainerCount(this.value);teRecalc();">'
    + [1, 2, 3, 4].map(function(n){ return '<option value="' + n + '"' + (n === teTravelers.length ? ' selected' : '') + '>' + n + '</option>'; }).join('')
    + '</select></div>'
    + '</div>'
    + '<div id="te-traveler-rows">' + teRenderTravelerRows() + '</div>'
    + '<div class="cfd-two-col">'
    + '<div class="resume-section"><div class="resume-section-title">Lodging</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
    + '<div><label class="field-label" for="te-gsa-lodging-rate">GSA Lodging Rate (per night)</label>' + currencyInputHtml('te-gsa-lodging-rate', 0, 'teRecalc') + '</div>'
    + '<div><label class="field-label" for="te-meals-rate">Meals (M&amp;IE) Rate (per day)</label>' + currencyInputHtml('te-meals-rate', 0, 'teRecalc') + '</div>'
    + '</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:auto 1fr 1fr 1fr;gap:16px;margin:4px 0 8px;align-items:end;">'
    + '<div><button type="button" class="btn-cancel" id="te-gsa-lookup-btn" onclick="teMaybeAutoLookupGsa()">Refresh GSA Rates</button></div>'
    + '<div class="info-box"><div class="info-label">Nights</div><div class="info-val" id="te-calc-nights">0</div></div>'
    + '<div class="info-box"><div class="info-label">Full Days (1x)</div><div class="info-val" id="te-calc-fulldays">0</div></div>'
    + '<div class="info-box"><div class="info-label">Per Diem Meals Total</div><div class="info-val" id="te-calc-perdiem">$0.00</div></div>'
    + '</div>'
    + '<div class="login-error" id="te-gsa-lookup-error" style="text-align:left;margin-top:-4px;"></div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 1fr;">'
    + '<div><label class="field-label" for="te-lodging-cost">Lodging Cost (per night, requested)</label>' + currencyInputHtml('te-lodging-cost', 0, 'teRecalc') + '</div>'
    + '<div><label class="field-label" for="te-lodging-fees">Lodging Fees</label>' + currencyInputHtml('te-lodging-fees', 0, 'teRecalc') + '</div>'
    + '<div><label class="field-label" for="te-lodging-taxes">Lodging Taxes</label>' + currencyInputHtml('te-lodging-taxes', 0, 'teRecalc') + '</div>'
    + '</div>'
    + '<div class="warning-box" id="te-lodging-warning" style="display:none;">'
    + '<div><div class="warning-box-title">Lodging cost exceeds GSA rate</div><div class="warning-box-text" id="te-lodging-warning-text"></div>'
    + '<button type="button" class="btn-edit" style="margin-top:8px;" id="te-lodging-quotes-btn" onclick="teOpenLodgingQuotesModal()">Upload Comparison Quotes</button></div>'
    + '</div></div>'
    + '<div class="resume-section"><div class="resume-section-title">Flight</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
    + '<div><label class="field-label" for="te-airfare">Airfare (avg)</label>' + currencyInputHtml('te-airfare', 0, 'teRecalc') + '</div>'
    + '<div><label class="field-label" for="te-baggage">Baggage</label>' + currencyInputHtml('te-baggage', 0, 'teRecalc') + '</div>'
    + '</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
    + '<div><label class="field-label" for="te-parking-transport">Airport Parking</label>' + currencyInputHtml('te-parking-transport', 0, 'teRecalc') + '</div>'
    + '<div></div>'
    + '</div></div>'
    + '</div>'
    + '<div class="cfd-two-col">'
    + '<div class="resume-section"><div class="resume-section-title">Other ODC Costs</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
    + '<div><label class="field-label" for="te-shipping-to">Shipping (to)</label>' + currencyInputHtml('te-shipping-to', 0, 'teRecalc') + '</div>'
    + '<div><label class="field-label" for="te-shipping-back">Shipping (back)</label>' + currencyInputHtml('te-shipping-back', 0, 'teRecalc') + '</div>'
    + '</div></div>'
    + '<div class="resume-section"><div class="resume-section-title">Transportation</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 1fr;">'
    + '<div><label class="field-label" for="te-rental-car">Rental Car</label>' + currencyInputHtml('te-rental-car', 0, 'teRecalc') + '</div>'
    + '<div><label class="field-label" for="te-fuel-gas">Gas</label>' + currencyInputHtml('te-fuel-gas', 0, 'teRecalc') + '</div>'
    + '<div><label class="field-label" for="te-parking">Parking</label>' + currencyInputHtml('te-parking', 0, 'teRecalc') + '</div>'
    + '<div><label class="field-label" for="te-tolls">Tolls</label>' + currencyInputHtml('te-tolls', 0, 'teRecalc') + '</div>'
    + '<div><label class="field-label" for="te-rideshare">Rideshare Estimate</label>' + currencyInputHtml('te-rideshare', 0, 'teRecalc') + '</div>'
    + '<div><label class="field-label" for="te-mileage">Mileage (Personal Vehicle)</label>' + currencyInputHtml('te-mileage', 0, 'teRecalc') + '</div>'
    + '</div></div>'
    + '</div>'
    + '<div class="tk-entry-card" style="margin-top:14px;margin-bottom:0;">'
    + '<div class="tk-pto-summary-row">'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Per Traveler Subtotal</div><div class="tk-pto-stat-val" id="te-total-per-traveler">$0.00</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Trip Lead Total</div><div class="tk-pto-stat-val" id="te-total-trip-lead">$0.00</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">EWW Total</div><div class="tk-pto-stat-val" id="te-total-eww">$0.00</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Grand Total (ODC + EWW)</div><div class="tk-pto-stat-val" id="te-total-grand">$0.00</div></div>'
    + '</div>'
    // Fee-multiplier/Prime-billable figures are Supervisor-facing (the
    // internal approval/pricing view) — Employees filling out their own
    // request don't see the markup, only their actual costs.
    + (currentPersonaSlug() === 'supervisor'
      ? '<div class="tk-pto-summary-row" style="grid-template-columns:repeat(2,1fr);margin-top:16px;">'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Billable to Prime (ODC)</div><div class="tk-pto-stat-val" id="te-total-billable-trip-lead">$0.00</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Grand Total to Prime</div><div class="tk-pto-stat-val" id="te-total-billable-grand">$0.00</div></div>'
        + '</div>'
      : '')
    + '</div>'
    + '<div class="profile-actions">'
    + '<button class="btn-save" onclick="submitTravelEstimate(\'submitted\')">Submit Estimate</button>'
    + '<button class="btn-cancel" onclick="submitTravelEstimate(\'draft\')">Save as Draft</button>'
    + '<button class="btn-cancel" onclick="loadMyEstimates()">Cancel</button>'
    + '</div>'
    + '<div class="login-error" id="te-form-error"></div>'
    + '</div>';
}

function tePrefillForm(row){
  document.getElementById('te-city').value = row.city || '';
  document.getElementById('te-state').value = row.state || '';
  document.getElementById('te-event-name').value = row.event_name || '';
  document.getElementById('te-slin').value = row.slin_id || '';
  document.getElementById('te-trainers').value = teTravelers.length;
  document.getElementById('te-leave-date').value = row.leave_date || '';
  document.getElementById('te-return-date').value = row.return_date || '';
  var teMoneyFieldMap = {
    'te-gsa-lodging-rate': row.per_diem_lodging_rate, 'te-lodging-cost': row.lodging_cost_per_night,
    'te-lodging-fees': row.lodging_fees, 'te-lodging-taxes': row.lodging_taxes,
    'te-meals-rate': row.per_diem_meals_rate, 'te-airfare': row.airfare_avg,
    'te-parking-transport': row.airport_parking_transport, 'te-baggage': row.baggage,
    'te-rental-car': row.rental_car, 'te-fuel-gas': row.fuel_gas, 'te-parking': row.parking,
    'te-tolls': row.tolls, 'te-rideshare': row.rideshare_estimate, 'te-mileage': row.mileage,
    'te-shipping-to': row.shipping_to, 'te-shipping-back': row.shipping_back
  };
  Object.keys(teMoneyFieldMap).forEach(function(id){
    document.getElementById(id).value = '$' + (parseFloat(teMoneyFieldMap[id]) || 0).toFixed(2);
  });
}

// Travel days = 1.5x M&IE ONCE; full days (nights-1) = 1x M&IE each.
// Per-traveler bucket (x trainers): airfare/parking/baggage/per diem/hotel.
// Trip-level bucket (not multiplied): rental car/mileage/shipping.
function teCalc(inputs){
  var leave = inputs.leaveDate ? new Date(inputs.leaveDate) : null;
  var ret = inputs.returnDate ? new Date(inputs.returnDate) : null;
  var nights = (leave && ret) ? Math.round((ret - leave) / 86400000) : 0;
  if(nights < 0){ nights = 0; }

  var travelDaysCost = 1.5 * inputs.mealsRate;
  var fullDays = Math.max(nights - 1, 0);
  var fullDaysCost = fullDays * inputs.mealsRate;
  var perDiemMealsTotal = travelDaysCost + fullDaysCost;
  var hotelTotal = (nights * inputs.lodgingCost) + inputs.lodgingFees + inputs.lodgingTaxes;

  var perTravelerMarkupBucket = hotelTotal + inputs.airfare + inputs.parkingTransport + inputs.baggage;
  var tripLevelBucket = inputs.rentalCar + inputs.fuelGas + inputs.parking + inputs.tolls + inputs.rideshare + inputs.mileage + inputs.shippingTo + inputs.shippingBack;

  var perTravelerInternal = perDiemMealsTotal + perTravelerMarkupBucket;
  var tripLeadInternal = (perTravelerInternal * inputs.trainers) + tripLevelBucket;
  // Per-traveler EWW: sum of each traveler's own rate*hours (matches the
  // reference spreadsheet), not one shared rate/hours times headcount.
  var ewwTotal = teTravelers.reduce(function(sum, t){ return sum + (t.ewwRate * t.ewwHours); }, 0);

  // "To Prime" billable totals: every ODC line except per-diem meals and EWW
  // is marked up by travel.feeMultiplier.
  var billableMarkupBucket = (perTravelerMarkupBucket * inputs.trainers + tripLevelBucket) * travel.feeMultiplier;
  var billableTripLead = (perDiemMealsTotal * inputs.trainers) + billableMarkupBucket;
  var billableGrandTotal = billableTripLead + ewwTotal;

  return {
    nights: nights, fullDays: fullDays, perDiemMealsTotal: perDiemMealsTotal, hotelTotal: hotelTotal,
    ewwTotal: ewwTotal, perTravelerInternal: perTravelerInternal, tripLeadInternal: tripLeadInternal,
    billableMarkupBucket: billableMarkupBucket, billableTripLead: billableTripLead, billableGrandTotal: billableGrandTotal
  };
}

function teReadFormInputs(){
  return {
    leaveDate: document.getElementById('te-leave-date').value,
    returnDate: document.getElementById('te-return-date').value,
    trainers: teTravelers.length,
    lodgingRate: parseMoneyValue(document.getElementById('te-gsa-lodging-rate').value),
    lodgingCost: parseMoneyValue(document.getElementById('te-lodging-cost').value),
    lodgingFees: parseMoneyValue(document.getElementById('te-lodging-fees').value),
    lodgingTaxes: parseMoneyValue(document.getElementById('te-lodging-taxes').value),
    mealsRate: parseMoneyValue(document.getElementById('te-meals-rate').value),
    airfare: parseMoneyValue(document.getElementById('te-airfare').value),
    parkingTransport: parseMoneyValue(document.getElementById('te-parking-transport').value),
    baggage: parseMoneyValue(document.getElementById('te-baggage').value),
    rentalCar: parseMoneyValue(document.getElementById('te-rental-car').value),
    fuelGas: parseMoneyValue(document.getElementById('te-fuel-gas').value),
    parking: parseMoneyValue(document.getElementById('te-parking').value),
    tolls: parseMoneyValue(document.getElementById('te-tolls').value),
    rideshare: parseMoneyValue(document.getElementById('te-rideshare').value),
    mileage: parseMoneyValue(document.getElementById('te-mileage').value),
    shippingTo: parseMoneyValue(document.getElementById('te-shipping-to').value),
    shippingBack: parseMoneyValue(document.getElementById('te-shipping-back').value)
  };
}

function teLodgingOverRate(inputs){
  return inputs.lodgingCost > inputs.lodgingRate && inputs.lodgingRate > 0;
}

function teRecalc(){
  var inputs = teReadFormInputs();
  var calc = teCalc(inputs);
  document.getElementById('te-calc-nights').textContent = calc.nights;
  document.getElementById('te-calc-fulldays').textContent = calc.fullDays;
  document.getElementById('te-calc-perdiem').textContent = '$' + calc.perDiemMealsTotal.toFixed(2);
  document.getElementById('te-total-per-traveler').textContent = '$' + calc.perTravelerInternal.toFixed(2);
  document.getElementById('te-total-trip-lead').textContent = '$' + calc.tripLeadInternal.toFixed(2);
  document.getElementById('te-total-eww').textContent = '$' + calc.ewwTotal.toFixed(2);
  document.getElementById('te-total-grand').textContent = '$' + (calc.tripLeadInternal + calc.ewwTotal).toFixed(2);
  var billableTripLeadEl = document.getElementById('te-total-billable-trip-lead');
  if(billableTripLeadEl){ billableTripLeadEl.textContent = '$' + calc.billableTripLead.toFixed(2); }
  var billableGrandEl = document.getElementById('te-total-billable-grand');
  if(billableGrandEl){ billableGrandEl.textContent = '$' + calc.billableGrandTotal.toFixed(2); }

  var warningEl = document.getElementById('te-lodging-warning');
  if(warningEl){
    if(teLodgingOverRate(inputs)){
      warningEl.style.display = '';
      document.getElementById('te-lodging-warning-text').textContent =
        'Lodging cost ($' + inputs.lodgingCost.toFixed(2) + ') exceeds the GSA rate ($' + inputs.lodgingRate.toFixed(2) + ') — 3 comparison quotes are required to submit.';
      document.getElementById('te-lodging-quotes-btn').textContent = 'Upload Comparison Quotes (' + teLodgingQuotes.length + ' of 3)';
    }else{
      warningEl.style.display = 'none';
    }
  }
  return calc;
}

function teEstimatesTableRowsHtml(rows){
  return rows.map(function(r){
    var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
    var actionLabel = r.status === 'draft' ? 'Edit Draft' : (r.status === 'returned' || r.status === 'denied') ? 'Edit & Resubmit' : 'View';
    var action = '<button class="tk-now-btn" type="button" onclick="loadMyEstimates(\'' + r.id + '\')">' + actionLabel + '</button>';
    return '<tr><td>' + escAttr(r.destination_event || '—') + (r.event_name ? ' — ' + escAttr(r.event_name) : '') + '</td>'
      + '<td>' + formatDate(r.leave_date) + ' – ' + formatDate(r.return_date) + '</td>'
      + '<td><span class="tk-status-pill ' + r.status + '">' + r.status.replace('_', ' ') + '</span></td>'
      + '<td>$' + grand.toFixed(2) + '</td><td>' + action + '</td></tr>';
  }).join('');
}

function teEstimatesCardHtml(title, rows, emptyMessage){
  var body = rows.length
    ? '<div class="tk-grid-table-wrap"><table class="tk-grid-table"><thead><tr><th>Destination / Event</th><th>Dates</th><th>Status</th><th>Grand Total</th><th></th></tr></thead><tbody>'
      + teEstimatesTableRowsHtml(rows) + '</tbody></table></div>'
    : '<div class="tk-empty">' + escAttr(emptyMessage) + '</div>';
  return '<div class="tk-entry-card"><div class="tk-section-title">' + escAttr(title) + '</div>' + body + '</div>';
}

// Only a fully-paid estimate is "done" — everything else (draft, awaiting
// approval/authorization at any stage, expensed-but-not-yet-paid, or
// kicked back) is still something the employee needs to act on or watch,
// so it lives in the Pending card at the top instead of the archive below.
async function teRenderMyEstimatesLists(){
  var { data: rows } = await supabaseClient.from('travel_estimates').select('id,destination_event,event_name,leave_date,return_date,status,trip_lead_total,eww_total').eq('created_by', travel.employeeId).order('created_at', { ascending: false });
  rows = rows || [];
  var pendingRows = rows.filter(function(r){ return r.status !== 'paid'; });
  var paidRows = rows.filter(function(r){ return r.status === 'paid'; });
  return {
    pendingHtml: teEstimatesCardHtml('Pending / Returned / Denied Requests', pendingRows, 'Nothing pending.'),
    paidHtml: teEstimatesCardHtml('Paid Travel Estimates', paidRows, 'No paid estimates yet.')
  };
}

function renderTeReadOnlyDetail(r){
  var wrap = document.getElementById('te-detail-wrap');
  var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
  var slin = travel.odcSlins.find(function(s){ return s.slin_id === r.slin_id; });

  wrap.innerHTML = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Travel Estimate — ' + escAttr(r.destination_event || '—') + (r.event_name ? ' — ' + escAttr(r.event_name) : '') + ' <span class="tk-status-pill ' + r.status + '">' + r.status.replace('_', ' ') + '</span></div>'
    + '<div class="placeholder-sub" style="margin-bottom:14px;">This estimate is ' + r.status.replace('_', ' ') + ' and can no longer be edited here.</div>'
    + '<div class="profile-grid">'
    + travelReadOnlyField('Destination', r.destination_event)
    + travelReadOnlyField('Event Name', r.event_name)
    + travelReadOnlyField('SLIN', slin ? (slin.slin_code + ' — ' + slin.slin_description) : '—')
    + travelReadOnlyField('Dates', formatDate(r.leave_date) + ' – ' + formatDate(r.return_date))
    + travelReadOnlyField('Number of Trainers', r.number_of_trainers)
    + travelReadOnlyField('Per Traveler Subtotal', '$' + (parseFloat(r.per_traveler_subtotal) || 0).toFixed(2))
    + travelReadOnlyField('Trip Lead Total', '$' + (parseFloat(r.trip_lead_total) || 0).toFixed(2))
    + travelReadOnlyField('EWW Total', '$' + (parseFloat(r.eww_total) || 0).toFixed(2))
    + travelReadOnlyField('Grand Total', '$' + grand.toFixed(2))
    + '</div>'
    + '<div class="profile-actions"><button class="btn-cancel" onclick="loadMyEstimates()">Back</button></div>'
    + '</div>';
}

// Shared by submitTravelEstimate and teEnsureDraftId (silent auto-save when
// attaching lodging quotes before the user has explicitly saved) so both
// read the same fields the same way.
function teBuildBody(targetStatus, inputs){
  var city = document.getElementById('te-city').value.trim();
  var state = document.getElementById('te-state').value.trim();
  var eventName = document.getElementById('te-event-name').value.trim();
  var slinId = document.getElementById('te-slin').value;
  var calc = teCalc(inputs);
  var destinationEvent = (city && state) ? (city + ', ' + state) : (city || state || null);

  // Legacy-compat columns still read by the Travel Expense side's prefill
  // logic (texEstimateSelected), which has no per-traveler EWW concept —
  // write the average rate/hours across travelers into those two columns.
  var ewwRateSum = 0, ewwHoursSum = 0;
  teTravelers.forEach(function(t){ ewwRateSum += t.ewwRate; ewwHoursSum += t.ewwHours; });
  var avgEwwRate = teTravelers.length ? (ewwRateSum / teTravelers.length) : 0;
  var avgEwwHours = teTravelers.length ? (ewwHoursSum / teTravelers.length) : 0;

  var body = {
    destination_event: destinationEvent, city: city || null, state: state || null, event_name: eventName || null, slin_id: slinId || null,
    leave_date: inputs.leaveDate || null, return_date: inputs.returnDate || null,
    number_of_trainers: teTravelers.length, per_diem_lodging_rate: inputs.lodgingRate, lodging_cost_per_night: inputs.lodgingCost, per_diem_meals_rate: inputs.mealsRate,
    lodging_fees: inputs.lodgingFees, lodging_taxes: inputs.lodgingTaxes,
    airfare_avg: inputs.airfare, airport_parking_transport: inputs.parkingTransport, baggage: inputs.baggage,
    rental_car: inputs.rentalCar, fuel_gas: inputs.fuelGas, parking: inputs.parking, tolls: inputs.tolls, rideshare_estimate: inputs.rideshare, mileage: inputs.mileage,
    shipping_to: inputs.shippingTo, shipping_back: inputs.shippingBack,
    eww_rate: avgEwwRate, eww_hours_per_trainer: avgEwwHours,
    per_traveler_subtotal: calc.perTravelerInternal, trip_lead_total: calc.tripLeadInternal,
    estimated_total_odc: calc.tripLeadInternal, eww_total: calc.ewwTotal,
    billable_trip_lead_total: calc.billableTripLead, billable_grand_total: calc.billableGrandTotal,
    status: targetStatus
  };
  if(targetStatus === 'submitted'){ body.fee_multiplier_used = travel.feeMultiplier; }
  if(targetStatus === 'submitted' && teEditingRow && (teEditingRow.status === 'returned' || teEditingRow.status === 'denied')){
    body.approved_by = null;
    body.approved_at = null;
  }
  return { body: body, city: city, state: state, slinId: slinId };
}

// Silently creates a draft row from the form's current values, without
// resetting/reloading the form, so the user can attach lodging comparison
// quotes before explicitly clicking Save as Draft. No-op (returns the
// existing id) if the estimate is already saved.
async function teEnsureDraftId(){
  if(teEditingId){ return teEditingId; }
  var inputs = teReadFormInputs();
  var built = teBuildBody('draft', inputs);
  try{
    var body = built.body;
    body.created_by = travel.employeeId;
    var { data: inserted, error } = await supabaseClient.from('travel_estimates').insert(body).select('id').single();
    if(error){ throw error; }
    teEditingId = inserted.id;
    await teSaveTravelers(teEditingId);
    await supabaseClient.from('travel_estimate_audit_log').insert({
      estimate_id: teEditingId, changed_by: currentProfile.id, action: 'edit', previous_status: null, new_status: 'draft'
    });
    teFormDirty = false;
    return teEditingId;
  }catch(e){
    console.error(e);
    return null;
  }
}

async function submitTravelEstimate(targetStatus){
  var errorEl = document.getElementById('te-form-error');
  errorEl.textContent = '';
  var inputs = teReadFormInputs();
  var built = teBuildBody(targetStatus, inputs);

  if(targetStatus === 'submitted'){
    if(!built.city || !built.state || !built.slinId || !inputs.leaveDate || !inputs.returnDate){
      errorEl.textContent = 'City, State, SLIN, and both dates are required to submit.';
      return;
    }
    if(new Date(inputs.returnDate) < new Date(inputs.leaveDate)){
      errorEl.textContent = 'Return date must be on or after leave date.';
      return;
    }
    var missingTraveler = teTravelers.find(function(t){ return t.slot > 1 && !t.employeeId; });
    if(missingTraveler){
      errorEl.textContent = 'Select an employee for Traveler ' + missingTraveler.slot + ' (and any other added travelers) before submitting.';
      return;
    }
    if(teLodgingOverRate(inputs)){
      var quotesOk = teLodgingQuotes.length === 3 && teLodgingQuotes.every(function(q){ return q.average_daily_rate != null; });
      if(!quotesOk){
        errorEl.textContent = 'Lodging cost exceeds the GSA rate — upload 3 comparison quotes with rates entered before submitting.';
        return;
      }
    }
  }

  var body = built.body;

  try{
    var previousStatus = teEditingRow ? teEditingRow.status : null;
    var newId = teEditingId;
    if(teEditingId){
      var { error } = await supabaseClient.from('travel_estimates').update(body).eq('id', teEditingId);
      if(error){ throw error; }
    }else{
      body.created_by = travel.employeeId;
      var { data: inserted, error: insErr } = await supabaseClient.from('travel_estimates').insert(body).select('id').single();
      if(insErr){ throw insErr; }
      newId = inserted.id;
    }

    await teSaveTravelers(newId);

    await supabaseClient.from('travel_estimate_audit_log').insert({
      estimate_id: newId, changed_by: currentProfile.id,
      action: (previousStatus && previousStatus !== targetStatus) ? 'status_change' : 'edit',
      previous_status: previousStatus, new_status: targetStatus
    });

    if(targetStatus === 'submitted'){
      notifySelf('Travel estimate submitted', '<p>Your travel estimate for <strong>' + escAttr(body.destination_event || body.event_name || 'your trip') + '</strong> has been submitted. Switch to your Supervisor view to review and approve it.</p><p><a href="' + window.location.origin + window.location.pathname + '">Open the app</a></p>');
    }

    teEditingId = null; teEditingRow = null; teFormDirty = false;
    await loadMyEstimates();
    var screenEl = document.getElementById('screen-travel');
    if(screenEl){ screenEl.scrollTo({ top: 0, behavior: 'smooth' }); }
    // Show the toast after the scroll finishes, not simultaneously — it's
    // pinned to the top of the screen, so popping it up before the scroll
    // completes means it briefly overlaps content moving up underneath it.
    setTimeout(function(){
      showToast(targetStatus === 'submitted' ? 'Travel estimate submitted.' : 'Draft saved.');
    }, 450);
  }catch(e){
    errorEl.textContent = 'Couldn\'t save travel estimate. Try again.';
    console.error(e);
  }
}

// ---------- GSA per-diem lookup ----------

function teMaybeAutoLookupGsa(){
  var city = document.getElementById('te-city').value.trim();
  var state = document.getElementById('te-state').value.trim();
  if(!city || !state){ return; }
  teFetchGsaRates(city, state);
}

async function teFetchGsaRates(city, state){
  var errorEl = document.getElementById('te-gsa-lookup-error');
  var btn = document.getElementById('te-gsa-lookup-btn');
  errorEl.textContent = '';

  var leaveDateVal = document.getElementById('te-leave-date').value;
  var leaveDate = leaveDateVal ? new Date(leaveDateVal) : new Date();
  var year = leaveDate.getFullYear();
  var month = leaveDate.getMonth() + 1;

  var originalLabel = btn.textContent;
  btn.textContent = 'Looking up...';
  btn.disabled = true;
  try{
    var { data, error } = await supabaseClient.functions.invoke('gsa-per-diem', { body: { city: city, state: state, year: year, month: month } });
    if(error || (data && data.error)){
      errorEl.textContent = (data && data.error) ? data.error : 'Couldn\'t look up GSA rates. Enter manually.';
      console.error(error || (data && data.error));
      return;
    }
    if(data.lodgingRate != null){ document.getElementById('te-gsa-lodging-rate').value = '$' + parseFloat(data.lodgingRate).toFixed(2); }
    if(data.mealsRate != null){ document.getElementById('te-meals-rate').value = '$' + parseFloat(data.mealsRate).toFixed(2); }
    teRecalc();
  }catch(e){
    errorEl.textContent = 'Couldn\'t look up GSA rates. Enter manually.';
    console.error(e);
  }finally{
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
}

// ---------- Lodging comparison quotes (required when cost > GSA rate) ----------

async function teLoadLodgingQuotes(){
  if(!teEditingId){ teLodgingQuotes = []; return; }
  try{
    var { data: rows } = await supabaseClient.from('travel_estimate_lodging_quotes').select('*').eq('estimate_id', teEditingId).order('uploaded_at');
    teLodgingQuotes = rows || [];
  }catch(e){
    teLodgingQuotes = [];
    console.error(e);
  }
}

function teLodgingQuotesModalBody(){
  var avgRates = teLodgingQuotes.filter(function(q){ return q.average_daily_rate != null; }).map(function(q){ return parseFloat(q.average_daily_rate); });
  var avgLine = avgRates.length
    ? '<div class="placeholder-sub" style="margin-top:10px;">Average of entered rates: $' + (avgRates.reduce(function(a, b){ return a + b; }, 0) / avgRates.length).toFixed(2) + '</div>'
    : '';
  var uploadHtml = teLodgingQuotes.length < 3
    ? '<input type="file" id="te-lodging-quote-input" multiple onchange="teUploadLodgingQuotes(this.files)">'
    : '<div class="placeholder-sub">3 quotes attached — remove none needed, this is the required maximum.</div>';
  var listHtml = teLodgingQuotes.length
    ? teLodgingQuotes.map(function(q){
        return '<div class="resume-cart-item"><a href="' + q.file_url + '" target="_blank">' + escAttr(q.file_name || 'Quote') + '</a>'
          + '<span><label class="field-label" style="display:inline;margin:0 6px 0 0;">Avg Daily Rate</label>'
          + '<input type="number" step="0.01" style="width:100px;display:inline-block;" class="field-input" value="' + (q.average_daily_rate == null ? '' : q.average_daily_rate) + '" onchange="teUpdateLodgingQuoteRate(\'' + q.id + '\', this.value)"></span></div>';
      }).join('')
    : '<div class="tk-empty">No comparison quotes attached yet.</div>';
  return '<div>' + listHtml + '</div>' + uploadHtml + '<div class="login-error" id="te-lodging-quote-error"></div>' + avgLine;
}

async function teOpenLodgingQuotesModal(){
  if(!teEditingId){
    // Silently save a draft from the form's current values so quotes can be
    // attached right away, without the user having to click Save as Draft
    // themselves first.
    openModal('Comparison Quotes', '<div class="placeholder-sub">Saving a draft so quotes can be attached...</div>', '');
    var id = await teEnsureDraftId();
    if(!id){
      openModal('Comparison Quotes', '<div class="login-error">Couldn\'t save a draft automatically — try clicking Save as Draft below, then Upload Comparison Quotes again.</div>', '<button class="btn-cancel" onclick="closeModal()">Close</button>');
      return;
    }
  }
  await teLoadLodgingQuotes();
  openModal('Lodging Comparison Quotes', teLodgingQuotesModalBody(), '<button class="btn-cancel" onclick="teCloseLodgingQuotesModal()">Close</button>');
  teRecalc();
}

function teCloseLodgingQuotesModal(){
  closeModal();
  teLoadLodgingQuotes().then(teRecalc);
}

async function teUploadLodgingQuotes(files){
  if(!teEditingId || !files || !files.length){ return; }
  var errorEl = document.getElementById('te-lodging-quote-error');
  var remaining = 3 - teLodgingQuotes.length;
  if(remaining <= 0){
    if(errorEl){ errorEl.textContent = 'Maximum of 3 comparison quotes reached.'; }
    return;
  }
  var toUpload = Array.prototype.slice.call(files, 0, remaining);
  if(files.length > toUpload.length && errorEl){
    errorEl.textContent = 'Only ' + toUpload.length + ' file(s) uploaded — maximum of 3 comparison quotes total.';
  }
  for(var i = 0; i < toUpload.length; i++){
    var file = toUpload[i];
    var path = teEditingId + '/' + Date.now() + '-' + file.name;
    try{
      var { error: upErr } = await supabaseClient.storage.from('travel-lodging-quotes').upload(path, file);
      if(upErr){ throw upErr; }
      var { data: pub } = supabaseClient.storage.from('travel-lodging-quotes').getPublicUrl(path);
      var { error: insErr } = await supabaseClient.from('travel_estimate_lodging_quotes').insert({
        estimate_id: teEditingId, file_url: pub.publicUrl, file_name: file.name, uploaded_by: travel.employeeId
      });
      if(insErr){ throw insErr; }
    }catch(e){
      if(errorEl){ errorEl.textContent = 'Couldn\'t upload ' + file.name + '. Try again.'; }
      console.error(e);
    }
  }
  await teLoadLodgingQuotes();
  openModal('Lodging Comparison Quotes', teLodgingQuotesModalBody(), '<button class="btn-cancel" onclick="teCloseLodgingQuotesModal()">Close</button>');
  teRecalc();
}

async function teUpdateLodgingQuoteRate(quoteId, value){
  try{
    var { error } = await supabaseClient.from('travel_estimate_lodging_quotes').update({ average_daily_rate: Number(value) }).eq('id', quoteId);
    if(error){ throw error; }
  }catch(e){
    console.error(e);
  }
  await teLoadLodgingQuotes();
  openModal('Lodging Comparison Quotes', teLodgingQuotesModalBody(), '<button class="btn-cancel" onclick="teCloseLodgingQuotesModal()">Close</button>');
  teRecalc();
}

// ---------- Supervisor approvals + Customer Admin authorizations ----------

async function loadApprovalsQueue(){
  var content = document.getElementById('travel-content');
  content.innerHTML = '<div class="tk-empty">Loading...</div>';
  try{
    var [{ data: pendingEst }, { data: pendingExp }] = await Promise.all([
      supabaseClient.from('travel_estimates').select('id,destination_event,event_name,leave_date,return_date,trip_lead_total,eww_total,created_by').eq('status', 'submitted').order('created_at'),
      supabaseClient.from('travel_expenses').select('id,estimate_id,current_status,supervisor_status,actual_trip_lead_total,actual_eww_total,variance_total,created_by').eq('current_status', 'submitted').eq('supervisor_status', 'pending').order('created_at')
    ]);
    pendingEst = pendingEst || []; pendingExp = pendingExp || [];

    var empIds = uniq(pendingEst.map(function(r){ return r.created_by; }).concat(pendingExp.map(function(r){ return r.created_by; })));
    var namesById = await employeeNamesById(empIds);

    var estHtml = '<div class="tk-entry-card"><div class="tk-section-title">Estimates Needing Approval (' + pendingEst.length + ')</div>'
      + (pendingEst.length
          ? '<div class="tk-grid-table-wrap"><table class="tk-grid-table"><thead><tr><th>Employee</th><th>Destination</th><th>Dates</th><th>Grand Total</th><th></th></tr></thead><tbody>'
            + pendingEst.map(function(r){
                var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
                return '<tr><td>' + escAttr(namesById[r.created_by] || '—') + '</td><td>' + escAttr(r.destination_event || '—') + (r.event_name ? ' — ' + escAttr(r.event_name) : '') + '</td>'
                  + '<td>' + formatDate(r.leave_date) + ' – ' + formatDate(r.return_date) + '</td><td>$' + grand.toFixed(2) + '</td>'
                  + '<td><button class="tk-now-btn" type="button" onclick="openEstimateApproval(\'' + r.id + '\')">Review</button></td></tr>';
              }).join('') + '</tbody></table></div>'
          : '<div class="tk-empty">Nothing pending.</div>') + '</div>';

    var expHtml = '<div class="tk-entry-card"><div class="tk-section-title">Expense Reports Needing Approval (' + pendingExp.length + ')</div>'
      + (pendingExp.length
          ? '<div class="tk-grid-table-wrap"><table class="tk-grid-table"><thead><tr><th>Employee</th><th>Actual Total</th><th>Variance</th><th></th></tr></thead><tbody>'
            + pendingExp.map(function(r){
                var grand = (parseFloat(r.actual_trip_lead_total) || 0) + (parseFloat(r.actual_eww_total) || 0);
                var variance = parseFloat(r.variance_total) || 0;
                return '<tr><td>' + escAttr(namesById[r.created_by] || '—') + '</td><td>$' + grand.toFixed(2) + '</td>'
                  + '<td>' + (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2) + '</td>'
                  + '<td><button class="tk-now-btn" type="button" onclick="openExpenseApproval(\'' + r.id + '\')">Review</button></td></tr>';
              }).join('') + '</tbody></table></div>'
          : '<div class="tk-empty">Nothing pending.</div>') + '</div>';

    content.innerHTML = estHtml + expHtml + '<div id="travel-approval-detail"></div>';
  }catch(e){
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load approvals</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
    console.error(e);
  }
}

async function employeeNamesById(ids){
  if(!ids.length){ return {}; }
  var { data: rows } = await supabaseClient.from('demo_employees').select('id,full_name').in('id', ids);
  var map = {};
  (rows || []).forEach(function(r){ map[r.id] = r.full_name; });
  return map;
}

function uniq(arr){
  var seen = {}; var out = [];
  arr.forEach(function(v){ if(v && !seen[v]){ seen[v] = true; out.push(v); } });
  return out;
}

// Renders a compact "Requested vs. Billable to Prime" table for a set of
// line items — the fee multiplier (stored on the estimate as
// fee_multiplier_used at submit time) applies to every ODC line except
// per-diem meals and EWW, matching the real reference spreadsheet's
// "To Prime" sheet. Zero-value rows are still shown (an approver needs to
// see what WASN'T filled in, not just what was).
function teApprovalMarkupTable(sectionLabel, items, multiplier){
  return '<div class="resume-section"><div class="resume-section-title">' + escAttr(sectionLabel) + '</div>'
    + '<div class="tk-grid-table-wrap"><table class="tk-grid-table"><thead><tr><th>Item</th><th>Requested</th><th>Billable to Prime</th></tr></thead><tbody>'
    + items.map(function(it){
        var billable = it.value * multiplier;
        return '<tr><td>' + escAttr(it.label) + '</td><td>$' + it.value.toFixed(2) + '</td><td>$' + billable.toFixed(2) + '</td></tr>';
      }).join('')
    + '</tbody></table></div></div>';
}

async function openEstimateApproval(estimateId){
  var detail = document.getElementById('travel-approval-detail');
  detail.innerHTML = '<div class="tk-entry-card"><div class="placeholder-sub">Loading...</div></div>';
  var { data: rows } = await supabaseClient.from('travel_estimates').select('*').eq('id', estimateId).limit(1);
  if(!rows || !rows.length){ detail.innerHTML = ''; return; }
  var r = rows[0];
  var names = await employeeNamesById([r.created_by]);
  var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
  var slin = travel.odcSlins.find(function(s){ return s.slin_id === r.slin_id; });
  var multiplier = parseFloat(r.fee_multiplier_used) || 1;

  var { data: travelerRows } = await supabaseClient.from('travel_estimate_travelers').select('*, demo_employees(full_name)').eq('estimate_id', estimateId).order('traveler_number');
  travelerRows = travelerRows || [];

  var nights = 0;
  if(r.leave_date && r.return_date){
    nights = Math.max(0, Math.round((new Date(r.return_date) - new Date(r.leave_date)) / 86400000));
  }

  var demographicsHtml = '<div class="resume-section"><div class="resume-section-title">Demographics</div>'
    + '<div class="profile-grid">'
    + travelReadOnlyField('Destination', r.destination_event)
    + travelReadOnlyField('Event Name', r.event_name)
    + travelReadOnlyField('Dates', formatDate(r.leave_date) + ' – ' + formatDate(r.return_date) + ' (' + nights + ' nights)')
    + travelReadOnlyField('SLIN', slin ? (slin.slin_code + ' — ' + slin.slin_description) : '—')
    + travelReadOnlyField('Number of Trainers', r.number_of_trainers)
    + travelReadOnlyField('Fee Multiplier Used', multiplier ? multiplier.toFixed(4) + 'x' : '—')
    + '</div></div>';

  var travelersHtml = '<div class="resume-section"><div class="resume-section-title">Travelers / EWW (not marked up)</div>'
    + '<div class="tk-grid-table-wrap"><table class="tk-grid-table"><thead><tr><th>Traveler</th><th>EWW Rate</th><th>EWW Hours</th><th>EWW Cost</th></tr></thead><tbody>'
    + (travelerRows.length
      ? travelerRows.map(function(t){
          var cost = (parseFloat(t.eww_rate) || 0) * (parseFloat(t.eww_hours) || 0);
          return '<tr><td>' + escAttr(t.demo_employees ? t.demo_employees.full_name : '—') + '</td><td>$' + (parseFloat(t.eww_rate) || 0).toFixed(2) + '</td><td>' + (parseFloat(t.eww_hours) || 0) + '</td><td>$' + cost.toFixed(2) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="4">No traveler records found.</td></tr>')
    + '</tbody></table></div></div>';

  var lodgingCostTotal = (parseFloat(r.lodging_cost_per_night) || 0) * nights;
  var lodgingHtml = teApprovalMarkupTable('Lodging', [
    { label: 'Lodging (' + nights + ' nights × $' + (parseFloat(r.lodging_cost_per_night) || 0).toFixed(2) + ')', value: lodgingCostTotal },
    { label: 'Lodging Fees', value: parseFloat(r.lodging_fees) || 0 },
    { label: 'Lodging Taxes', value: parseFloat(r.lodging_taxes) || 0 }
  ], multiplier)
    + '<div class="profile-grid" style="margin-top:-8px;">'
    + travelReadOnlyField('GSA Lodging Rate (reference, not marked up)', '$' + (parseFloat(r.per_diem_lodging_rate) || 0).toFixed(2))
    + travelReadOnlyField('Meals (M&IE) Rate (reference, not marked up)', '$' + (parseFloat(r.per_diem_meals_rate) || 0).toFixed(2))
    + '</div>';

  var flightHtml = teApprovalMarkupTable('Flight', [
    { label: 'Airfare (avg)', value: parseFloat(r.airfare_avg) || 0 },
    { label: 'Baggage', value: parseFloat(r.baggage) || 0 },
    { label: 'Airport Parking', value: parseFloat(r.airport_parking_transport) || 0 }
  ], multiplier);

  var transportationHtml = teApprovalMarkupTable('Transportation', [
    { label: 'Rental Car', value: parseFloat(r.rental_car) || 0 },
    { label: 'Gas', value: parseFloat(r.fuel_gas) || 0 },
    { label: 'Parking', value: parseFloat(r.parking) || 0 },
    { label: 'Tolls', value: parseFloat(r.tolls) || 0 },
    { label: 'Rideshare Estimate', value: parseFloat(r.rideshare_estimate) || 0 },
    { label: 'Mileage (Personal Vehicle)', value: parseFloat(r.mileage) || 0 }
  ], multiplier);

  var otherOdcHtml = teApprovalMarkupTable('Other ODC Costs', [
    { label: 'Shipping (to)', value: parseFloat(r.shipping_to) || 0 },
    { label: 'Shipping (back)', value: parseFloat(r.shipping_back) || 0 }
  ], multiplier);

  var totalsHtml = '<div class="tk-entry-card" style="margin-top:14px;">'
    + '<div class="tk-pto-summary-row">'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Trip Lead Total</div><div class="tk-pto-stat-val">$' + (parseFloat(r.trip_lead_total) || 0).toFixed(2) + '</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">EWW Total</div><div class="tk-pto-stat-val">$' + (parseFloat(r.eww_total) || 0).toFixed(2) + '</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Grand Total</div><div class="tk-pto-stat-val">$' + grand.toFixed(2) + '</div></div>'
    + '</div>'
    + '<div class="tk-pto-summary-row" style="grid-template-columns:repeat(2,1fr);margin-top:16px;">'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Billable to Prime (ODC)</div><div class="tk-pto-stat-val">$' + (parseFloat(r.billable_trip_lead_total) || 0).toFixed(2) + '</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Grand Total to Prime</div><div class="tk-pto-stat-val">$' + (parseFloat(r.billable_grand_total) || 0).toFixed(2) + '</div></div>'
    + '</div></div>';

  detail.innerHTML = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Travel Estimate — ' + escAttr(names[r.created_by] || '—') + '</div>'
    + demographicsHtml + travelersHtml + lodgingHtml + flightHtml + transportationHtml + otherOdcHtml + totalsHtml
    + '<div id="travel-approval-note-wrap" style="display:none;margin-top:10px;"><label class="field-label">Note (required for Return or Deny)</label><textarea class="info-edit-input" id="travel-approval-note" rows="2"></textarea></div>'
    + '<div class="login-error" id="travel-approval-error"></div>'
    + '<div class="profile-actions">'
    + '<button class="btn-save" onclick="estimateApprovalAction(\'' + r.id + '\',\'supervisor_approved\')">Approve (sends to Prime for authorization)</button>'
    + '<button class="btn-edit" onclick="estimateApprovalAction(\'' + r.id + '\',\'returned\')">Return</button>'
    + '<button class="btn-cancel" style="color:var(--red);border-color:var(--red);" onclick="estimateApprovalAction(\'' + r.id + '\',\'denied\')">Deny</button>'
    + '<button class="btn-cancel" onclick="document.getElementById(\'travel-approval-detail\').innerHTML=\'\'">Close</button>'
    + '</div></div>';
}

async function estimateApprovalAction(estimateId, decision){
  var noteWrap = document.getElementById('travel-approval-note-wrap');
  var noteField = document.getElementById('travel-approval-note');
  var errorEl = document.getElementById('travel-approval-error');
  errorEl.textContent = '';
  if(decision !== 'supervisor_approved' && !noteField.value.trim()){
    noteWrap.style.display = '';
    errorEl.textContent = 'A note is required to return or deny this estimate.';
    return;
  }
  try{
    var { data: existing } = await supabaseClient.from('travel_estimates').select('status').eq('id', estimateId).limit(1);
    var previousStatus = existing && existing.length ? existing[0].status : null;
    var body = { status: decision };
    if(decision === 'supervisor_approved'){ body.approved_by = travel.employeeId; body.approved_at = new Date().toISOString(); }

    var { error } = await supabaseClient.from('travel_estimates').update(body).eq('id', estimateId);
    if(error){ throw error; }

    await supabaseClient.from('travel_estimate_audit_log').insert({
      estimate_id: estimateId, changed_by: currentProfile.id, action: 'status_change',
      field_changes: { note: noteField ? noteField.value.trim() : null }, previous_status: previousStatus, new_status: decision
    });

    var approvalNote = noteField ? noteField.value.trim() : '';
    if(decision === 'supervisor_approved'){
      notifySelf('Travel estimate approved internally', '<p>Your travel estimate has been approved internally. Switch to your Prime view to give final authorization.</p><p><a href="' + window.location.origin + window.location.pathname + '">Open the app</a></p>');
    }else{
      notifySelf('Travel estimate ' + decision, '<p>You ' + decision + ' a travel estimate' + (approvalNote ? ': ' + escAttr(approvalNote) : '.') + ' Switch to your Employee view to see the note.</p><p><a href="' + window.location.origin + window.location.pathname + '">Open the app</a></p>');
    }

    document.getElementById('travel-approval-detail').innerHTML = '';
    loadApprovalsQueue();
  }catch(e){
    errorEl.textContent = 'Couldn\'t save decision. Try again.';
    console.error(e);
  }
}

async function loadAuthorizationsQueue(){
  var content = document.getElementById('travel-content');
  content.innerHTML = '<div class="tk-empty">Loading...</div>';
  try{
    var { data: rows } = await supabaseClient.from('travel_estimates').select('id,destination_event,event_name,leave_date,return_date,trip_lead_total,eww_total,created_by,slin_id').eq('status', 'supervisor_approved').order('created_at');
    rows = rows || [];
    var scoped = [];
    for(var i = 0; i < rows.length; i++){
      var slin = travel.odcSlins.find(function(s){ return s.slin_id === rows[i].slin_id; });
      if(slin){ scoped.push(rows[i]); }
    }
    var names = await employeeNamesById(uniq(scoped.map(function(r){ return r.created_by; })));

    content.innerHTML = '<div class="tk-entry-card"><div class="tk-section-title">Travel Authorizations Needed (' + scoped.length + ')</div>'
      + (scoped.length
          ? '<div class="tk-grid-table-wrap"><table class="tk-grid-table"><thead><tr><th>Employee</th><th>Destination</th><th>Dates</th><th>Grand Total</th><th></th></tr></thead><tbody>'
            + scoped.map(function(r){
                var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
                return '<tr><td>' + escAttr(names[r.created_by] || '—') + '</td><td>' + escAttr(r.destination_event || '—') + (r.event_name ? ' — ' + escAttr(r.event_name) : '') + '</td>'
                  + '<td>' + formatDate(r.leave_date) + ' – ' + formatDate(r.return_date) + '</td><td>$' + grand.toFixed(2) + '</td>'
                  + '<td><button class="tk-now-btn" type="button" onclick="openAuthorizationReview(\'' + r.id + '\')">Review</button></td></tr>';
              }).join('') + '</tbody></table></div>'
          : '<div class="tk-empty">Nothing awaiting authorization.</div>')
      + '</div><div id="travel-authorization-detail"></div>';
  }catch(e){
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load authorizations</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
    console.error(e);
  }
}

async function openAuthorizationReview(estimateId){
  var detail = document.getElementById('travel-authorization-detail');
  detail.innerHTML = '<div class="tk-entry-card"><div class="placeholder-sub">Loading...</div></div>';
  var { data: rows } = await supabaseClient.from('travel_estimates').select('*').eq('id', estimateId).limit(1);
  if(!rows || !rows.length){ detail.innerHTML = ''; return; }
  var r = rows[0];
  var names = await employeeNamesById([r.created_by]);
  var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);

  detail.innerHTML = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Authorize Travel — ' + escAttr(names[r.created_by] || '—') + '</div>'
    + '<div class="placeholder-sub" style="margin-bottom:14px;">Already approved internally by the Supervisor. Your authorization is required before this trip can proceed and be expensed.</div>'
    + '<div class="profile-grid">'
    + travelReadOnlyField('Destination', r.destination_event)
    + travelReadOnlyField('Event Name', r.event_name)
    + travelReadOnlyField('Dates', formatDate(r.leave_date) + ' – ' + formatDate(r.return_date))
    + travelReadOnlyField('Grand Total', '$' + grand.toFixed(2))
    + '</div>'
    + '<div id="travel-auth-note-wrap" style="display:none;margin-top:10px;"><label class="field-label">Note (required for Return or Deny)</label><textarea class="info-edit-input" id="travel-auth-note" rows="2"></textarea></div>'
    + '<div class="login-error" id="travel-auth-error"></div>'
    + '<div class="profile-actions">'
    + '<button class="btn-save" onclick="authorizationAction(\'' + r.id + '\',\'approved\')">Authorize Travel</button>'
    + '<button class="btn-edit" onclick="authorizationAction(\'' + r.id + '\',\'returned\')">Return</button>'
    + '<button class="btn-cancel" style="color:var(--red);border-color:var(--red);" onclick="authorizationAction(\'' + r.id + '\',\'denied\')">Deny</button>'
    + '<button class="btn-cancel" onclick="document.getElementById(\'travel-authorization-detail\').innerHTML=\'\'">Close</button>'
    + '</div></div>';
}

async function authorizationAction(estimateId, decision){
  var noteWrap = document.getElementById('travel-auth-note-wrap');
  var noteField = document.getElementById('travel-auth-note');
  var errorEl = document.getElementById('travel-auth-error');
  errorEl.textContent = '';
  if(decision !== 'approved' && !noteField.value.trim()){
    noteWrap.style.display = '';
    errorEl.textContent = 'A note is required to return or deny this authorization.';
    return;
  }
  try{
    var body = { status: decision };
    if(decision === 'approved'){ body.prime_approved_by_customer_user_id = travel.customerUserId; body.prime_approved_at = new Date().toISOString(); }

    var { error } = await supabaseClient.from('travel_estimates').update(body).eq('id', estimateId);
    if(error){ throw error; }

    await supabaseClient.from('travel_estimate_audit_log').insert({
      estimate_id: estimateId, changed_by: currentProfile.id, action: 'status_change',
      field_changes: { note: noteField ? noteField.value.trim() : null }, new_status: decision
    });

    var authNote = noteField ? noteField.value.trim() : '';
    if(decision === 'approved'){
      notifySelf('Travel authorized', '<p>A travel estimate has been authorized for the Prime. Switch to your Employee view once travel is complete to expense it.</p><p><a href="' + window.location.origin + window.location.pathname + '">Open the app</a></p>');
    }else{
      notifySelf('Travel authorization ' + decision, '<p>You ' + decision + ' a travel authorization' + (authNote ? ': ' + escAttr(authNote) : '.') + ' Switch to your Employee view to see the note.</p><p><a href="' + window.location.origin + window.location.pathname + '">Open the app</a></p>');
    }

    document.getElementById('travel-authorization-detail').innerHTML = '';
    loadAuthorizationsQueue();
  }catch(e){
    errorEl.textContent = 'Couldn\'t save decision. Try again.';
    console.error(e);
  }
}

// =====================================================================
// TRAVEL EXPENSE REPORT — 1:1 with an 'approved' (Prime-authorized)
// estimate. No fee-multiplier concept (internal-only document); lodging
// is an actual receipt total rather than rate x nights.
// =====================================================================

var texEditingId = null;
var texEditingRow = null;
var texAvailableEstimates = [];
var texLinkedEstimateTotals = { tripLead: 0, eww: 0 };

// Estimated-cost comparison figures (one per Actual Costs category), derived
// from the linked travel_estimates row via texComputeEstimatedCosts — see
// that function for the field mapping (direct 1:1s, the 5-field
// transportation sum, and the lodging nights*rate+fees+taxes calc).
var texEstimatedCosts = { airfare: 0, parkingTransport: 0, baggage: 0, lodgingTotal: 0, rentalCar: 0, fuelGas: 0, parking: 0, tolls: 0, rideshare: 0, mileage: 0, shippingTo: 0, shippingBack: 0 };

// Receipts for the currently-open expense, grouped by category (migration
// 0017 added travel_expense_receipts.category). Populated by
// texLoadReceiptsByCategory, read by texRenderCategoryReceipts.
var texReceiptsByCategory = {};

// Explanations for a category whose actual cost ran >10% over its estimate
// OR that was added via "Additional Expenses" below (a cost incurred that
// had no estimate at all) — both reuse the same jsonb column
// (travel_expenses.variance_notes, migration 0018) since both are "explain
// this cost category" notes tied to a category, just for different reasons.
// Required at submit time in both cases.
var texVarianceNotes = {};

// Categories the user has manually added via "Additional Expenses" — these
// are categories with nothing on the original estimate (texEstimatedCosts
// is 0), so they don't appear in the main Actual Costs grid at all unless
// added here. Populated from the saved row's non-zero, non-estimated
// columns when reopening a draft (see loadMyExpenses).
var texAdditionalCategories = [];

// One row per Actual Costs category — drives both texActualCostRow's
// repeated markup and texEstimatedCosts' key names.
// `column` = the travel_expenses column this category's actual-cost input
// saves to — drives texPrefillForm/texReadFormInputs/texBuildBody generically
// so adding/removing a category doesn't require touching those in 3 places.
var texCostCategories = [
  { label: 'Airfare', fieldId: 'tex-airfare', category: 'airfare', estimatedKey: 'airfare', column: 'actual_airfare' },
  { label: 'Airport Parking', fieldId: 'tex-parking-transport', category: 'airport_parking', estimatedKey: 'parkingTransport', column: 'actual_airport_parking_transport' },
  { label: 'Baggage', fieldId: 'tex-baggage', category: 'baggage', estimatedKey: 'baggage', column: 'actual_baggage' },
  { label: 'Lodging (actual total)', fieldId: 'tex-lodging-total', category: 'lodging', estimatedKey: 'lodgingTotal', column: 'actual_lodging_total' },
  { label: 'Rental Car', fieldId: 'tex-rental-car', category: 'rental_car', estimatedKey: 'rentalCar', column: 'actual_rental_car' },
  { label: 'Gas', fieldId: 'tex-fuel-gas', category: 'fuel_gas', estimatedKey: 'fuelGas', column: 'actual_fuel_gas' },
  { label: 'Parking', fieldId: 'tex-parking', category: 'parking', estimatedKey: 'parking', column: 'actual_parking' },
  { label: 'Tolls', fieldId: 'tex-tolls', category: 'tolls', estimatedKey: 'tolls', column: 'actual_tolls' },
  { label: 'Rideshare', fieldId: 'tex-rideshare', category: 'rideshare', estimatedKey: 'rideshare', column: 'actual_rideshare' },
  { label: 'Mileage', fieldId: 'tex-mileage', category: 'mileage', estimatedKey: 'mileage', column: 'actual_mileage' },
  { label: 'Shipping (to)', fieldId: 'tex-shipping-to', category: 'shipping_to', estimatedKey: 'shippingTo', column: 'actual_shipping_to' },
  { label: 'Shipping (back)', fieldId: 'tex-shipping-back', category: 'shipping_back', estimatedKey: 'shippingBack', column: 'actual_shipping_back' }
];

// Shared by loadMyExpenses (editing an existing report) and
// texEstimateSelected (picking an estimate for a new report) so both derive
// the "estimated" comparison values from a travel_estimates row the same
// way. Lodging is nights * cost-per-night + fees + taxes; the transportation
// bucket is now a direct 1:1 per category (migration 0019 split the actual
// side to match the estimate side's already-separate rental_car/fuel_gas/
// parking/tolls/rideshare_estimate fields).
function texComputeEstimatedCosts(est){
  if(!est){ return { airfare: 0, parkingTransport: 0, baggage: 0, lodgingTotal: 0, rentalCar: 0, fuelGas: 0, parking: 0, tolls: 0, rideshare: 0, mileage: 0, shippingTo: 0, shippingBack: 0 }; }
  var leave = est.leave_date ? new Date(est.leave_date) : null;
  var ret = est.return_date ? new Date(est.return_date) : null;
  var nights = (leave && ret) ? Math.round((ret - leave) / 86400000) : 0;
  if(nights < 0){ nights = 0; }
  var lodgingTotal = (nights * (parseFloat(est.lodging_cost_per_night) || 0)) + (parseFloat(est.lodging_fees) || 0) + (parseFloat(est.lodging_taxes) || 0);
  return {
    airfare: parseFloat(est.airfare_avg) || 0,
    parkingTransport: parseFloat(est.airport_parking_transport) || 0,
    baggage: parseFloat(est.baggage) || 0,
    lodgingTotal: lodgingTotal,
    rentalCar: parseFloat(est.rental_car) || 0,
    fuelGas: parseFloat(est.fuel_gas) || 0,
    parking: parseFloat(est.parking) || 0,
    tolls: parseFloat(est.tolls) || 0,
    rideshare: parseFloat(est.rideshare_estimate) || 0,
    mileage: parseFloat(est.mileage) || 0,
    shippingTo: parseFloat(est.shipping_to) || 0,
    shippingBack: parseFloat(est.shipping_back) || 0
  };
}


async function loadMyExpenses(editId){
  var content = document.getElementById('travel-content');
  texEditingId = editId || null;
  texEditingRow = null;

  if(!travel.employeeId){
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">No employee record found</div><div class="placeholder-sub">Try switching roles and back, or refreshing the page.</div></div>';
    return;
  }

  texEstimatedCosts = texComputeEstimatedCosts(null);
  texReceiptsByCategory = {};
  texVarianceNotes = {};
  texAdditionalCategories = [];

  try{
    if(texEditingId){
      var { data: rows } = await supabaseClient.from('travel_expenses').select('*, travel_estimates(destination_event,event_name,leave_date,return_date,trip_lead_total,eww_total,number_of_trainers,per_diem_meals_rate,eww_rate,eww_hours_per_trainer,airfare_avg,airport_parking_transport,baggage,mileage,shipping_to,shipping_back,rental_car,fuel_gas,parking,tolls,rideshare_estimate,lodging_cost_per_night,lodging_fees,lodging_taxes)').eq('id', texEditingId).limit(1);
      if(rows && rows.length){ texEditingRow = rows[0]; }
    }

    if(texEditingRow && texEditingRow.current_status !== 'draft'){
      content.innerHTML = '<div id="tex-detail-wrap"></div><div class="tk-entry-card"><div class="tk-section-title">My Expense Reports</div>' + (await texRenderMyReportsTable()) + '</div>';
      renderTexReadOnlyDetail(texEditingRow);
      return;
    }

    if(!texEditingRow){
      var { data: approved } = await supabaseClient.from('travel_estimates').select('id,destination_event,event_name,leave_date,return_date,trip_lead_total,eww_total,number_of_trainers,per_diem_meals_rate,eww_rate,eww_hours_per_trainer,airfare_avg,airport_parking_transport,baggage,mileage,shipping_to,shipping_back,rental_car,fuel_gas,parking,tolls,rideshare_estimate,lodging_cost_per_night,lodging_fees,lodging_taxes').eq('created_by', travel.employeeId).eq('status', 'approved');
      var { data: existing } = await supabaseClient.from('travel_expenses').select('estimate_id').eq('created_by', travel.employeeId);
      var takenIds = (existing || []).map(function(r){ return r.estimate_id; });
      texAvailableEstimates = (approved || []).filter(function(e){ return takenIds.indexOf(e.id) === -1; });
    }

    if(texEditingRow){
      texLinkedEstimateTotals = {
        tripLead: parseFloat(texEditingRow.travel_estimates && texEditingRow.travel_estimates.trip_lead_total) || 0,
        eww: parseFloat(texEditingRow.travel_estimates && texEditingRow.travel_estimates.eww_total) || 0
      };
      texEstimatedCosts = texComputeEstimatedCosts(texEditingRow.travel_estimates);
      texVarianceNotes = texEditingRow.variance_notes || {};
      // A category with nothing estimated but a saved non-zero actual cost
      // must have been added via Additional Expenses on a previous save —
      // bring it back so its row reappears instead of the value going
      // invisible (still saved, just no control showing it).
      texAdditionalCategories = texCostCategories.filter(function(c){
        return (parseFloat(texEstimatedCosts[c.estimatedKey]) || 0) === 0 && (parseFloat(texEditingRow[c.column]) || 0) > 0;
      }).map(function(c){ return c.category; });
      await texLoadReceiptsByCategory(texEditingRow.id);
    }

    content.innerHTML = texFormHtml(texEditingRow) + '<div class="tk-entry-card"><div class="tk-section-title">My Expense Reports</div>' + (await texRenderMyReportsTable()) + '</div>';

    if(texEditingRow){
      texPrefillForm(texEditingRow);
    }
    texRecalc();
  }catch(e){
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load expense reports</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
    console.error(e);
  }
}

// Builds the filtered, 2-column Actual Costs grid content — factored out so
// texEstimateSelected() can rebuild it once an estimate is picked (on a NEW
// report, texFormHtml renders this once before any estimate is selected, so
// every category would otherwise be filtered out as "nothing estimated").
function texActualCostsGridHtml(){
  return texCostCategories.filter(function(c){
    // Nothing was estimated for this category on the original request
    // (e.g. no tolls expected) — no control group needed for it here.
    return (parseFloat(texEstimatedCosts[c.estimatedKey]) || 0) > 0;
  }).map(function(c){
    return texActualCostRow(c.label, c.fieldId, c.category, 0, texEstimatedCosts[c.estimatedKey]);
  }).join('');
}

// ---------- Currency-formatted inputs (shared by both the Estimate and
// Expense forms — te*/tex* recalc functions are passed in by name) ----------
// type="number" can't display "$400.00" (browsers reject non-numeric
// characters in a number input), so these are plain text inputs with
// inputmode="decimal" — cleared to blank on focus (instead of leaving a
// stale "0" the user has to select and delete) and formatted as currency
// on blur. Every place that reads one of these fields' raw value uses
// parseMoneyValue instead of parseFloat so a "$400.00"-formatted value
// still parses correctly.
function parseMoneyValue(v){
  var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function currencyInputHtml(fieldId, value, recalcFnName){
  var n = parseMoneyValue(value);
  return '<input type="text" inputmode="decimal" class="field-input" id="' + fieldId + '" value="$' + n.toFixed(2) + '" onfocus="currencyFocus(this)" onblur="currencyBlur(this,\'' + recalcFnName + '\')" oninput="' + recalcFnName + '()">';
}
function currencyFocus(el){
  var n = parseMoneyValue(el.value);
  el.value = n === 0 ? '' : String(n);
}
function currencyBlur(el, recalcFnName){
  el.value = '$' + parseMoneyValue(el.value).toFixed(2);
  if(recalcFnName && typeof window[recalcFnName] === 'function'){ window[recalcFnName](); }
}

// One self-contained "cell" per Actual Costs category, meant to sit inside
// a 2-column grid (see texFormHtml) so a variance-explanation textarea, if
// shown, never spans past the half-page column it's rendered in. Actual
// input, read-only Estimated box (comparison against the linked estimate,
// see texComputeEstimatedCosts — half the width of the Actual input), and
// Receipts all sit in line on one row; the conditional variance warning
// pops up full-width beneath that row, still inside this cell.
function texActualCostRow(label, fieldId, category, actualValue, estimatedValue){
  var varianceOver = texIsVarianceOver10Pct(actualValue, estimatedValue);
  return '<div style="margin-bottom:18px;">'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 0.5fr 1fr;align-items:end;">'
    + '<div><label class="field-label" for="' + fieldId + '">' + escAttr(label) + '</label>' + currencyInputHtml(fieldId, actualValue, 'texRecalc') + '</div>'
    + '<div><label class="field-label">Estimated</label><div class="info-box" style="padding:12px 14px;"><div class="info-val" id="tex-estimated-' + category + '" style="margin:0;">$' + (parseFloat(estimatedValue) || 0).toFixed(2) + '</div></div></div>'
    + '<div><label class="field-label">Receipts</label><div id="tex-receipts-cell-' + category + '">' + texRenderCategoryReceipts(category) + '</div></div>'
    + '</div>'
    + '<div class="warning-box" id="tex-variance-wrap-' + category + '" style="' + (varianceOver ? '' : 'display:none;') + 'margin-top:10px;">'
    + '<div style="width:100%;"><div class="warning-box-title">' + escAttr(label) + ' is more than 10% over the estimate</div>'
    + '<textarea class="info-edit-input" id="tex-variance-note-' + category + '" rows="2" placeholder="Please explain the reason for this variance...">' + escAttr((texVarianceNotes && texVarianceNotes[category]) || '') + '</textarea></div>'
    + '</div>'
    + '</div>';
}

// Actual > estimated by more than 10% — guards against a divide-by-zero /
// false-positive flag when nothing was estimated for this category at all.
function texIsVarianceOver10Pct(actualValue, estimatedValue){
  var actual = parseMoneyValue(actualValue);
  var estimated = parseMoneyValue(estimatedValue);
  return estimated > 0 && actual > estimated * 1.1;
}

// Builds the receipt thumbnails + upload button for one Actual Costs
// category, from texReceiptsByCategory[category]. Image files (by
// file_name extension) get a small cropped thumbnail; anything else (PDFs,
// etc.) gets a generic file glyph — no icon library available here. Each
// thumbnail is a link to the file plus a small red "x" (btn-remove-row,
// sized down from the Estimate form's 40px traveler-row convention since
// this sits right next to a 32px thumbnail, not a full form row).
function texRenderCategoryReceipts(category){
  var list = texReceiptsByCategory[category] || [];
  var imgExt = /\.(jpe?g|png|gif|webp)$/i;
  var thumbsHtml = list.map(function(rec){
    var isImg = imgExt.test(rec.file_name || '');
    var thumb = isImg
      ? '<img src="' + escAttr(rec.file_url) + '" style="width:32px;height:32px;object-fit:cover;border-radius:4px;display:block;">'
      : '<div style="width:32px;height:32px;border-radius:4px;background:rgba(127,127,127,0.15);display:flex;align-items:center;justify-content:center;font-size:15px;">📄</div>';
    return '<span style="position:relative;display:inline-block;margin:0 10px 6px 0;">'
      + '<a href="' + escAttr(rec.file_url) + '" target="_blank" title="' + escAttr(rec.file_name || 'Receipt') + '">' + thumb + '</a>'
      + '<button type="button" class="btn-remove-row" style="position:absolute;top:-9px;right:-9px;font-size:16px;line-height:1;font-weight:700;padding:0;width:16px;height:16px;" title="Remove receipt" onclick="texRemoveReceiptForCategory(\'' + rec.id + '\')">&times;</button>'
      + '</span>';
  }).join('');
  return '<div style="display:flex;align-items:center;flex-wrap:wrap;">'
    + thumbsHtml
    + '<input type="file" accept="image/*,.pdf" style="display:none;" id="tex-receipt-input-' + category + '" onchange="texUploadReceiptForCategory(\'' + category + '\', this.files)">'
    + '<button type="button" class="btn-cancel" style="padding:3px 10px;font-size:12px;margin:0 0 6px;" onclick="document.getElementById(\'tex-receipt-input-' + category + '\').click()">Upload</button>'
    + '</div>';
}

// ---------- Additional Expenses (categories with nothing on the original
// estimate, added ad hoc — e.g. baggage fees that came up but weren't
// planned for). Reuses the same fieldId/category/column as the main
// Actual Costs grid (see texCostCategories) so texReadFormInputs/
// texBuildBody/texPrefillForm already pick these up generically — the only
// thing specific to this section is which categories are offered (the
// complement of what's already shown) and that the "why wasn't this
// estimated" note is always required, not just past the 10% threshold.

function texAdditionalExpensesSectionHtml(){
  var rowsHtml = '<div id="tex-additional-costs-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;">'
    + texAdditionalCategories.map(function(cat){
        var c = texCostCategories.find(function(x){ return x.category === cat; });
        return c ? texAdditionalExpenseRowHtml(c) : '';
      }).join('')
    + '</div>';
  var available = texCostCategories.filter(function(c){
    return (parseFloat(texEstimatedCosts[c.estimatedKey]) || 0) === 0 && texAdditionalCategories.indexOf(c.category) === -1;
  });
  var addControlHtml = available.length
    ? '<select class="field-input" id="tex-additional-category-select" style="max-width:280px;display:inline-block;" onchange="texAddAdditionalExpense(this.value)">'
      + '<option value="">+ Add an expense category...</option>'
      + available.map(function(c){ return '<option value="' + c.category + '">' + escAttr(c.label) + '</option>'; }).join('')
      + '</select>'
    : (texAdditionalCategories.length ? '' : '<div class="tk-empty">Every category is already on your estimate.</div>');
  return rowsHtml + addControlHtml;
}

// Same shape as texActualCostRow (Actual | Estimated | Receipts, then a
// note box beneath) so a category added here looks identical to one in the
// main Actual Costs grid — "Estimated" just shows "—" since there wasn't
// one, and the note uses the same always-visible warning-box styling as
// the main section's variance-explanation box (here it's always shown and
// always required, not conditional on the 10% threshold).
function texAdditionalExpenseRowHtml(c){
  return '<div style="margin-bottom:18px;position:relative;" id="tex-additional-row-' + c.category + '">'
    + '<button type="button" class="btn-remove-row" style="position:absolute;top:0;right:0;font-size:18px;line-height:1;font-weight:700;" title="Remove this expense" onclick="texRemoveAdditionalExpense(\'' + c.category + '\')">&times;</button>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 0.5fr 1fr;align-items:end;">'
    + '<div><label class="field-label" for="' + c.fieldId + '">' + escAttr(c.label) + '</label>' + currencyInputHtml(c.fieldId, 0, 'texRecalc') + '</div>'
    + '<div><label class="field-label">Estimated</label><div class="info-box" style="padding:12px 14px;"><div class="info-val" style="margin:0;">—</div></div></div>'
    + '<div><label class="field-label">Receipts</label><div id="tex-receipts-cell-' + c.category + '">' + texRenderCategoryReceipts(c.category) + '</div></div>'
    + '</div>'
    + '<div class="warning-box" style="margin-top:10px;">'
    + '<div style="width:100%;"><div class="warning-box-title">Why wasn\'t ' + escAttr(c.label) + ' on the original estimate?</div>'
    + '<textarea class="info-edit-input" id="tex-variance-note-' + c.category + '" rows="2" placeholder="Please explain why this wasn\'t included in the estimate...">' + escAttr((texVarianceNotes && texVarianceNotes[c.category]) || '') + '</textarea></div>'
    + '</div>'
    + '</div>';
}

function texAddAdditionalExpense(category){
  if(!category || texAdditionalCategories.indexOf(category) !== -1){ return; }
  texAdditionalCategories.push(category);
  var wrap = document.getElementById('tex-additional-expenses-wrap');
  if(wrap){ wrap.innerHTML = texAdditionalExpensesSectionHtml(); }
  texRecalc();
}

function texRemoveAdditionalExpense(category){
  texAdditionalCategories = texAdditionalCategories.filter(function(c){ return c !== category; });
  var wrap = document.getElementById('tex-additional-expenses-wrap');
  if(wrap){ wrap.innerHTML = texAdditionalExpensesSectionHtml(); }
  texRecalc();
}

function texFormHtml(row){
  var isNew = !row;
  var estimatePickerHtml = isNew
    ? (texAvailableEstimates.length
        ? '<div class="tk-pto-form-grid" style="grid-template-columns:1fr;"><div><label class="field-label" for="tex-estimate-select">Authorized Estimate</label>'
          + '<select class="field-input" id="tex-estimate-select" onchange="texEstimateSelected()"><option value="">— Select an authorized estimate —</option>'
          + texAvailableEstimates.map(function(e){ return '<option value="' + e.id + '">' + escAttr(e.destination_event || '—') + (e.event_name ? ' — ' + escAttr(e.event_name) : '') + ' (' + formatDate(e.leave_date) + ' – ' + formatDate(e.return_date) + ')</option>'; }).join('')
          + '</select></div></div>'
        : '<div class="placeholder-sub" style="margin-bottom:14px;">No authorized estimates available to expense yet — an estimate must be Supervisor-approved and Customer-authorized first.</div>')
    : '<div class="profile-grid">' + travelReadOnlyField('Destination', row.travel_estimates ? row.travel_estimates.destination_event : '—')
      + travelReadOnlyField('Event Name', row.travel_estimates ? row.travel_estimates.event_name : '—')
      + travelReadOnlyField('Estimated Grand Total', '$' + ((parseFloat(row.travel_estimates && row.travel_estimates.trip_lead_total) || 0) + (parseFloat(row.travel_estimates && row.travel_estimates.eww_total) || 0)).toFixed(2)) + '</div>';

  return '<div class="tk-entry-card">'
    + '<div class="tk-section-title">' + (row ? 'Edit Draft Expense Report' : 'New Travel Expense Report') + '</div>'
    + estimatePickerHtml
    + '<div id="tex-form-body" style="' + (isNew ? 'display:none;' : '') + '">'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 1fr;">'
    + '<div><label class="field-label" for="tex-actual-leave-date">Actual Leave Date</label><input type="date" class="field-input" id="tex-actual-leave-date" oninput="texRecalc()"></div>'
    + '<div><label class="field-label" for="tex-actual-return-date">Actual Return Date</label><input type="date" class="field-input" id="tex-actual-return-date" oninput="texRecalc()"></div>'
    + '<div><label class="field-label" for="tex-trainers">Number of Trainers</label><input type="number" min="1" step="1" class="field-input" id="tex-trainers" value="1" oninput="texRecalc()"></div>'
    + '</div>'
    + '<div class="resume-section"><div class="resume-section-title">Per Diem / EWW (formula-based)</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 1fr;">'
    + '<div><label class="field-label" for="tex-meals-rate">Meals (M&amp;IE) Rate (per day)</label><input type="number" step="0.01" class="field-input" id="tex-meals-rate" value="0" oninput="texRecalc()"></div>'
    + '<div><label class="field-label" for="tex-eww-rate">EWW Rate (per hour)</label><input type="number" step="0.01" class="field-input" id="tex-eww-rate" value="0" oninput="texRecalc()"></div>'
    + '<div><label class="field-label" for="tex-eww-hours">EWW Hours per Trainer</label><input type="number" step="0.01" class="field-input" id="tex-eww-hours" value="0" oninput="texRecalc()"></div>'
    + '</div>'
    + '<div class="profile-grid" style="margin-top:4px;">'
    + '<div class="info-box"><div class="info-label">Nights</div><div class="info-val" id="tex-calc-nights">0</div></div>'
    + '<div class="info-box"><div class="info-label">Per Diem Meals Total</div><div class="info-val" id="tex-calc-perdiem">$0.00</div></div>'
    + '</div></div>'
    + '<div class="resume-section"><div class="resume-section-title">Actual Costs (receipt-backed)</div>'
    + '<div id="tex-actual-costs-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;">' + texActualCostsGridHtml() + '</div></div>'
    + '<div class="resume-section"><div class="resume-section-title">Additional Expenses (Not on Original Estimate)</div>'
    + '<div class="placeholder-sub" style="margin-bottom:10px;">Paid for something that wasn\'t in your estimate — like baggage fees you didn\'t plan for? Add it here.</div>'
    + '<div id="tex-additional-expenses-wrap">' + texAdditionalExpensesSectionHtml() + '</div></div>'
    + '<div class="tk-entry-card" style="margin-top:14px;margin-bottom:0;">'
    + '<div class="tk-pto-summary-row" style="grid-template-columns:repeat(5,1fr);">'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Per Traveler Subtotal</div><div class="tk-pto-stat-val" id="tex-total-per-traveler">$0.00</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Trip Lead Total</div><div class="tk-pto-stat-val" id="tex-total-trip-lead">$0.00</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">EWW Total</div><div class="tk-pto-stat-val" id="tex-total-eww">$0.00</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Actual Grand Total</div><div class="tk-pto-stat-val" id="tex-total-grand">$0.00</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Variance vs. Estimate</div><div class="tk-pto-stat-val" id="tex-total-variance">$0.00</div></div>'
    + '</div></div>'
    + '<div class="profile-actions">'
    + '<button class="btn-save" onclick="submitTravelExpense(\'submitted\')">Submit Expense Report</button>'
    + '<button class="btn-cancel" onclick="submitTravelExpense(\'draft\')">Save as Draft</button>'
    + '<button class="btn-cancel" onclick="loadMyExpenses()">Cancel</button>'
    + '</div></div>'
    + '<div class="login-error" id="tex-form-error"></div>'
    + '</div>';
}

function texEstimateSelected(){
  var id = document.getElementById('tex-estimate-select').value;
  var formBody = document.getElementById('tex-form-body');
  if(!id){ formBody.style.display = 'none'; return; }
  var est = texAvailableEstimates.filter(function(e){ return e.id === id; })[0];
  if(!est){ return; }
  texLinkedEstimateTotals = { tripLead: parseFloat(est.trip_lead_total) || 0, eww: parseFloat(est.eww_total) || 0 };
  texEstimatedCosts = texComputeEstimatedCosts(est);
  formBody.style.display = '';
  document.getElementById('tex-actual-leave-date').value = est.leave_date || '';
  document.getElementById('tex-actual-return-date').value = est.return_date || '';
  document.getElementById('tex-trainers').value = est.number_of_trainers || 1;
  document.getElementById('tex-meals-rate').value = est.per_diem_meals_rate || 0;
  document.getElementById('tex-eww-rate').value = est.eww_rate || 0;
  document.getElementById('tex-eww-hours').value = est.eww_hours_per_trainer || 0;
  // The Actual Costs grid was first rendered before any estimate was picked
  // (so every category was filtered out) — rebuild it now that
  // texEstimatedCosts reflects the chosen estimate.
  texReceiptsByCategory = {};
  texAdditionalCategories = [];
  var gridEl = document.getElementById('tex-actual-costs-grid');
  if(gridEl){ gridEl.innerHTML = texActualCostsGridHtml(); }
  var additionalEl = document.getElementById('tex-additional-expenses-wrap');
  if(additionalEl){ additionalEl.innerHTML = texAdditionalExpensesSectionHtml(); }
  texRecalc();
}

function texPrefillForm(row){
  document.getElementById('tex-actual-leave-date').value = row.actual_leave_date || '';
  document.getElementById('tex-actual-return-date').value = row.actual_return_date || '';
  document.getElementById('tex-trainers').value = row.number_of_trainers || 1;
  document.getElementById('tex-meals-rate').value = row.per_diem_meals_rate || 0;
  document.getElementById('tex-eww-rate').value = row.eww_rate || 0;
  document.getElementById('tex-eww-hours').value = row.eww_hours_per_trainer || 0;
  // Categories with nothing estimated (and not added via Additional
  // Expenses) aren't rendered, so guard each lookup.
  texCostCategories.forEach(function(c){
    var el = document.getElementById(c.fieldId);
    if(el){ el.value = '$' + (parseFloat(row[c.column]) || 0).toFixed(2); }
  });
}

function texCalc(inputs){
  var leave = inputs.leaveDate ? new Date(inputs.leaveDate) : null;
  var ret = inputs.returnDate ? new Date(inputs.returnDate) : null;
  var nights = (leave && ret) ? Math.round((ret - leave) / 86400000) : 0;
  if(nights < 0){ nights = 0; }

  var perDiemMealsTotal = (1.5 * inputs.mealsRate) + (Math.max(nights - 1, 0) * inputs.mealsRate);
  var perTravelerBucket = inputs.lodgingTotal + inputs.airfare + inputs.parkingTransport + inputs.baggage;
  var perTravelerSubtotal = perDiemMealsTotal + perTravelerBucket;
  var tripLevelBucket = inputs.rentalCar + inputs.fuelGas + inputs.parking + inputs.tolls + inputs.rideshare + inputs.mileage + inputs.shippingTo + inputs.shippingBack;
  var tripLeadTotal = (perTravelerSubtotal * inputs.trainers) + tripLevelBucket;
  var ewwTotal = inputs.ewwRate * inputs.ewwHours * inputs.trainers;

  return { nights: nights, perDiemMealsTotal: perDiemMealsTotal, perTravelerSubtotal: perTravelerSubtotal, tripLeadTotal: tripLeadTotal, ewwTotal: ewwTotal };
}

function texReadFormInputs(){
  var inputs = {
    leaveDate: document.getElementById('tex-actual-leave-date').value,
    returnDate: document.getElementById('tex-actual-return-date').value,
    trainers: parseInt(document.getElementById('tex-trainers').value, 10) || 1,
    mealsRate: parseFloat(document.getElementById('tex-meals-rate').value) || 0,
    ewwRate: parseFloat(document.getElementById('tex-eww-rate').value) || 0,
    ewwHours: parseFloat(document.getElementById('tex-eww-hours').value) || 0
  };
  // Hidden categories (nothing estimated) have no field in the DOM — read
  // as 0, same as if the user had left it blank.
  texCostCategories.forEach(function(c){
    var el = document.getElementById(c.fieldId);
    inputs[c.estimatedKey] = el ? parseMoneyValue(el.value) : 0;
  });
  return inputs;
}

function texRecalc(){
  var inputs = texReadFormInputs();
  var calc = texCalc(inputs);
  var grand = calc.tripLeadTotal + calc.ewwTotal;
  var estimateGrand = texLinkedEstimateTotals.tripLead + texLinkedEstimateTotals.eww;
  var variance = grand - estimateGrand;

  document.getElementById('tex-calc-nights').textContent = calc.nights;
  document.getElementById('tex-calc-perdiem').textContent = '$' + calc.perDiemMealsTotal.toFixed(2);
  document.getElementById('tex-total-per-traveler').textContent = '$' + calc.perTravelerSubtotal.toFixed(2);
  document.getElementById('tex-total-trip-lead').textContent = '$' + calc.tripLeadTotal.toFixed(2);
  document.getElementById('tex-total-eww').textContent = '$' + calc.ewwTotal.toFixed(2);
  document.getElementById('tex-total-grand').textContent = '$' + grand.toFixed(2);
  document.getElementById('tex-total-variance').textContent = (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2);

  texCostCategories.forEach(function(c){
    var fieldEl = document.getElementById(c.fieldId);
    var wrapEl = document.getElementById('tex-variance-wrap-' + c.category);
    if(!fieldEl || !wrapEl){ return; }
    var over = texIsVarianceOver10Pct(fieldEl.value, texEstimatedCosts[c.estimatedKey]);
    wrapEl.style.display = over ? '' : 'none';
  });

  return calc;
}

async function texRenderMyReportsTable(){
  var { data: rows } = await supabaseClient.from('travel_expenses').select('id,current_status,actual_trip_lead_total,actual_eww_total,variance_total,travel_estimates(destination_event,event_name,leave_date,return_date)').eq('created_by', travel.employeeId).order('created_at', { ascending: false });
  rows = rows || [];
  if(!rows.length){ return '<div class="tk-empty">No expense reports yet.</div>'; }
  return '<div class="tk-grid-table-wrap"><table class="tk-grid-table"><thead><tr><th>Destination / Event</th><th>Dates</th><th>Status</th><th>Actual Grand Total</th><th>Variance</th><th></th></tr></thead><tbody>'
    + rows.map(function(r){
        var est = r.travel_estimates || {};
        var grand = (parseFloat(r.actual_trip_lead_total) || 0) + (parseFloat(r.actual_eww_total) || 0);
        var variance = parseFloat(r.variance_total) || 0;
        var action = r.current_status === 'draft'
          ? '<button class="tk-now-btn" type="button" onclick="loadMyExpenses(\'' + r.id + '\')">Edit Draft</button>'
          : '<button class="tk-now-btn" type="button" onclick="loadMyExpenses(\'' + r.id + '\')">View</button>';
        return '<tr><td>' + escAttr(est.destination_event || '—') + (est.event_name ? ' — ' + escAttr(est.event_name) : '') + '</td><td>' + formatDate(est.leave_date) + ' – ' + formatDate(est.return_date) + '</td>'
          + '<td><span class="tk-status-pill ' + r.current_status + '">' + r.current_status + '</span></td>'
          + '<td>$' + grand.toFixed(2) + '</td><td>' + (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2) + '</td><td>' + action + '</td></tr>';
      }).join('') + '</tbody></table></div>';
}

function renderTexReadOnlyDetail(r){
  var wrap = document.getElementById('tex-detail-wrap');
  var est = r.travel_estimates || {};
  var grand = (parseFloat(r.actual_trip_lead_total) || 0) + (parseFloat(r.actual_eww_total) || 0);
  var variance = parseFloat(r.variance_total) || 0;

  wrap.innerHTML = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Expense Report — ' + escAttr(est.destination_event || '—') + (est.event_name ? ' — ' + escAttr(est.event_name) : '') + ' <span class="tk-status-pill ' + r.current_status + '">' + r.current_status + '</span></div>'
    + '<div class="placeholder-sub" style="margin-bottom:14px;">This report is ' + r.current_status + ' and can no longer be edited here.</div>'
    + '<div class="profile-grid">'
    + travelReadOnlyField('Actual Dates', formatDate(r.actual_leave_date) + ' – ' + formatDate(r.actual_return_date))
    + travelReadOnlyField('Number of Trainers', r.number_of_trainers)
    + travelReadOnlyField('Trip Lead Total', '$' + (parseFloat(r.actual_trip_lead_total) || 0).toFixed(2))
    + travelReadOnlyField('EWW Total', '$' + (parseFloat(r.actual_eww_total) || 0).toFixed(2))
    + travelReadOnlyField('Actual Grand Total', '$' + grand.toFixed(2))
    + travelReadOnlyField('Variance vs. Estimate', (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2))
    + travelReadOnlyField('Supervisor Decision', r.supervisor_status)
    + '</div>'
    + (Object.keys(r.variance_notes || {}).length
      ? '<div class="resume-section"><div class="resume-section-title">Variance Explanations</div>' + Object.keys(r.variance_notes).map(function(cat){
          var meta = texCostCategories.find(function(c){ return c.category === cat; });
          return '<div class="warning-box"><div><div class="warning-box-title">' + escAttr(meta ? meta.label : cat) + '</div><div class="warning-box-text">' + escAttr(r.variance_notes[cat]) + '</div></div></div>';
        }).join('') + '</div>'
      : '')
    + '<div class="resume-section"><div class="resume-section-title">Receipts</div><div id="tex-receipts-list"></div></div>'
    + '<div class="profile-actions"><button class="btn-cancel" onclick="loadMyExpenses()">Back</button></div>'
    + '</div>';
  texLoadReceipts(r.id);
}

// Read-only receipts list — used by the Supervisor/read-only detail views
// only. The editable form uses per-category receipts instead (see
// texLoadReceiptsByCategory/texRenderCategoryReceipts below).
async function texLoadReceipts(expenseId){
  var listEl = document.getElementById('tex-receipts-list');
  if(!listEl){ return; }
  try{
    var { data: rows } = await supabaseClient.from('travel_expense_receipts').select('*').eq('expense_id', expenseId).order('uploaded_at');
    rows = rows || [];
    if(!rows.length){ listEl.innerHTML = '<div class="tk-empty">No receipts attached yet.</div>'; return; }
    listEl.innerHTML = rows.map(function(rec){
      return '<div class="resume-cart-item"><a href="' + rec.file_url + '" target="_blank">' + escAttr(rec.file_name || 'Receipt') + '</a></div>';
    }).join('');
  }catch(e){
    listEl.innerHTML = '<div class="tk-empty">Couldn\'t load receipts.</div>';
    console.error(e);
  }
}

// Shared by submitTravelExpense and texEnsureDraftId (silent auto-save when
// attaching a receipt before the user has explicitly saved) so both build
// the travel_expenses row the same way. Mirrors the Travel Estimate side's
// teBuildBody pattern.
// Reads every category's variance-explanation textarea into a plain object
// (only non-empty notes kept) — used both to persist variance_notes on save
// and, at submit time, to check every over-threshold category has one.
function texReadVarianceNotes(){
  var notes = {};
  texCostCategories.forEach(function(c){
    var el = document.getElementById('tex-variance-note-' + c.category);
    var val = el ? el.value.trim() : '';
    if(val){ notes[c.category] = val; }
  });
  return notes;
}

function texBuildBody(targetStatus, inputs, estimateId){
  var calc = texCalc(inputs);
  var grand = calc.tripLeadTotal + calc.ewwTotal;
  var estimateGrand = texLinkedEstimateTotals.tripLead + texLinkedEstimateTotals.eww;

  var body = {
    estimate_id: estimateId, number_of_trainers: inputs.trainers,
    actual_leave_date: inputs.leaveDate || null, actual_return_date: inputs.returnDate || null,
    per_diem_meals_rate: inputs.mealsRate, eww_rate: inputs.ewwRate, eww_hours_per_trainer: inputs.ewwHours,
    actual_per_diem_meals_total: calc.perDiemMealsTotal, actual_per_traveler_subtotal: calc.perTravelerSubtotal,
    actual_trip_lead_total: calc.tripLeadTotal, actual_total_odc: calc.tripLeadTotal, actual_eww_total: calc.ewwTotal,
    variance_total: grand - estimateGrand, variance_notes: texReadVarianceNotes(), current_status: targetStatus
  };
  texCostCategories.forEach(function(c){ body[c.column] = inputs[c.estimatedKey]; });
  if(targetStatus === 'submitted'){ body.supervisor_status = 'pending'; }
  return body;
}

// Silently creates a draft travel_expenses row from the form's current
// values, without resetting/reloading the form, so a receipt can be
// attached before the user has explicitly clicked Save as Draft. No-op
// (returns the existing id) if the expense report is already saved.
// Mirrors the Travel Estimate side's teEnsureDraftId.
async function texEnsureDraftId(){
  if(texEditingId){ return texEditingId; }
  var estimateId = texEditingRow ? texEditingRow.estimate_id : (document.getElementById('tex-estimate-select') ? document.getElementById('tex-estimate-select').value : '');
  if(!estimateId){ return null; }
  var inputs = texReadFormInputs();
  var body = texBuildBody('draft', inputs, estimateId);
  try{
    body.created_by = travel.employeeId;
    var { data: inserted, error } = await supabaseClient.from('travel_expenses').insert(body).select('id').single();
    if(error){ throw error; }
    texEditingId = inserted.id;
    await supabaseClient.from('travel_expense_audit_log').insert({
      expense_id: texEditingId, changed_by: currentProfile.id, action: 'edit', previous_status: null, new_status: 'draft'
    });
    return texEditingId;
  }catch(e){
    console.error(e);
    return null;
  }
}

// ---------- Per-category receipts (editable-form path only) ----------
// The read-only detail view (renderTexReadOnlyDetail) and Supervisor's
// openExpenseApproval still use the flat texLoadReceipts/#tex-receipts-list
// above — untouched. These are only called from the editable Actual Costs
// rows (texActualCostRow / texRenderCategoryReceipts).

async function texLoadReceiptsByCategory(expenseId){
  texReceiptsByCategory = {};
  if(!expenseId){ return texReceiptsByCategory; }
  try{
    var { data: rows } = await supabaseClient.from('travel_expense_receipts').select('*').eq('expense_id', expenseId).order('uploaded_at');
    (rows || []).forEach(function(rec){
      var cat = rec.category || 'other';
      if(!texReceiptsByCategory[cat]){ texReceiptsByCategory[cat] = []; }
      texReceiptsByCategory[cat].push(rec);
    });
  }catch(e){
    console.error(e);
  }
  return texReceiptsByCategory;
}

async function texUploadReceiptForCategory(category, files){
  if(!files || !files.length){ return; }
  var errorEl = document.getElementById('tex-form-error');
  var expenseId = await texEnsureDraftId();
  if(!expenseId){
    if(errorEl){ errorEl.textContent = 'Select an authorized estimate before attaching receipts.'; }
    return;
  }
  for(var i = 0; i < files.length; i++){
    var file = files[i];
    var path = expenseId + '/' + Date.now() + '-' + file.name;
    try{
      var { error: upErr } = await supabaseClient.storage.from('travel-receipts').upload(path, file);
      if(upErr){ throw upErr; }
      var { data: pub } = supabaseClient.storage.from('travel-receipts').getPublicUrl(path);
      var { error: insErr } = await supabaseClient.from('travel_expense_receipts').insert({
        expense_id: expenseId, file_url: pub.publicUrl, file_name: file.name, uploaded_by: travel.employeeId, category: category
      });
      if(insErr){ throw insErr; }
    }catch(e){
      if(errorEl){ errorEl.textContent = 'Couldn\'t upload ' + file.name + '. Try again.'; }
      console.error(e);
    }
  }
  var input = document.getElementById('tex-receipt-input-' + category);
  if(input){ input.value = ''; }
  await texLoadReceiptsByCategory(expenseId);
  var cell = document.getElementById('tex-receipts-cell-' + category);
  if(cell){ cell.innerHTML = texRenderCategoryReceipts(category); }
}

async function texRemoveReceiptForCategory(receiptId){
  var errorEl = document.getElementById('tex-form-error');
  try{
    var { data: rec } = await supabaseClient.from('travel_expense_receipts').select('file_url,category').eq('id', receiptId).limit(1);
    var { error: delErr } = await supabaseClient.from('travel_expense_receipts').delete().eq('id', receiptId);
    if(delErr){ throw delErr; }
    var category = rec && rec.length ? rec[0].category : null;
    if(rec && rec.length){
      var marker = '/storage/v1/object/public/travel-receipts/';
      var idx = rec[0].file_url.indexOf(marker);
      if(idx !== -1){
        var path = rec[0].file_url.slice(idx + marker.length);
        await supabaseClient.storage.from('travel-receipts').remove([path]);
      }
    }
    if(texEditingId){ await texLoadReceiptsByCategory(texEditingId); }
    if(category){
      var cell = document.getElementById('tex-receipts-cell-' + category);
      if(cell){ cell.innerHTML = texRenderCategoryReceipts(category); }
    }
  }catch(e){
    if(errorEl){ errorEl.textContent = 'Couldn\'t remove receipt. Try again.'; }
    console.error(e);
  }
}

async function submitTravelExpense(targetStatus){
  var errorEl = document.getElementById('tex-form-error');
  errorEl.textContent = '';

  var estimateId = texEditingRow ? texEditingRow.estimate_id : (document.getElementById('tex-estimate-select') ? document.getElementById('tex-estimate-select').value : '');
  if(!estimateId){ errorEl.textContent = 'Select an authorized estimate first.'; return; }

  var inputs = texReadFormInputs();
  if(targetStatus === 'submitted'){
    if(!inputs.leaveDate || !inputs.returnDate){ errorEl.textContent = 'Actual leave and return dates are required to submit.'; return; }
    if(new Date(inputs.returnDate) < new Date(inputs.leaveDate)){ errorEl.textContent = 'Actual return date must be on or after leave date.'; return; }
    var missingVarianceNote = texCostCategories.find(function(c){
      var fieldEl = document.getElementById(c.fieldId);
      var noteEl = document.getElementById('tex-variance-note-' + c.category);
      return fieldEl && texIsVarianceOver10Pct(fieldEl.value, texEstimatedCosts[c.estimatedKey]) && (!noteEl || !noteEl.value.trim());
    });
    if(missingVarianceNote){
      errorEl.textContent = 'Explain the variance for ' + missingVarianceNote.label + ' before submitting — it\'s more than 10% over the estimate.';
      return;
    }
    var missingAdditionalNote = texAdditionalCategories.map(function(cat){
      return texCostCategories.find(function(c){ return c.category === cat; });
    }).find(function(c){
      var noteEl = c && document.getElementById('tex-variance-note-' + c.category);
      return c && (!noteEl || !noteEl.value.trim());
    });
    if(missingAdditionalNote){
      errorEl.textContent = 'Explain why ' + missingAdditionalNote.label + ' wasn\'t on the original estimate before submitting.';
      return;
    }
  }

  var body = texBuildBody(targetStatus, inputs, estimateId);

  try{
    var previousStatus = texEditingRow ? texEditingRow.current_status : null;
    var wasNew = !texEditingId;
    var newId = texEditingId;

    if(texEditingId){
      var { error } = await supabaseClient.from('travel_expenses').update(body).eq('id', texEditingId);
      if(error){ throw error; }
    }else{
      body.created_by = travel.employeeId;
      var { data: inserted, error: insErr } = await supabaseClient.from('travel_expenses').insert(body).select('id').single();
      if(insErr){ throw insErr; }
      newId = inserted.id;
    }

    await supabaseClient.from('travel_expense_audit_log').insert({
      expense_id: newId, changed_by: currentProfile.id,
      action: (previousStatus && previousStatus !== targetStatus) ? 'status_change' : 'edit',
      previous_status: previousStatus, new_status: targetStatus
    });

    if(targetStatus === 'submitted'){
      await supabaseClient.from('travel_estimates').update({ status: 'expensed' }).eq('id', estimateId);
    }

    if(targetStatus === 'draft' && wasNew){
      loadMyExpenses(newId);
    }else{
      texEditingId = null; texEditingRow = null;
      loadMyExpenses();
    }
  }catch(e){
    errorEl.textContent = 'Couldn\'t save expense report. Try again.';
    console.error(e);
  }
}

// ---------- Supervisor expense-report approval ----------

async function openExpenseApproval(expenseId){
  var detail = document.getElementById('travel-approval-detail');
  detail.innerHTML = '<div class="tk-entry-card"><div class="placeholder-sub">Loading...</div></div>';
  var { data: rows } = await supabaseClient.from('travel_expenses').select('*, travel_estimates(destination_event,event_name,leave_date,return_date)').eq('id', expenseId).limit(1);
  if(!rows || !rows.length){ detail.innerHTML = ''; return; }
  var r = rows[0];
  var est = r.travel_estimates || {};
  var names = await employeeNamesById([r.created_by]);
  var grand = (parseFloat(r.actual_trip_lead_total) || 0) + (parseFloat(r.actual_eww_total) || 0);
  var variance = parseFloat(r.variance_total) || 0;

  var { data: receipts } = await supabaseClient.from('travel_expense_receipts').select('*').eq('expense_id', expenseId).order('uploaded_at');
  var receiptsHtml = (receipts && receipts.length)
    ? receipts.map(function(rec){ return '<div class="resume-cart-item"><a href="' + rec.file_url + '" target="_blank">' + escAttr(rec.file_name || 'Receipt') + '</a></div>'; }).join('')
    : '<div class="tk-empty">No receipts attached.</div>';

  var varianceNotes = r.variance_notes || {};
  var varianceNoteKeys = Object.keys(varianceNotes);
  var varianceNotesHtml = varianceNoteKeys.length
    ? '<div class="resume-section"><div class="resume-section-title">Variance Explanations</div>' + varianceNoteKeys.map(function(cat){
        var meta = texCostCategories.find(function(c){ return c.category === cat; });
        return '<div class="warning-box"><div><div class="warning-box-title">' + escAttr(meta ? meta.label : cat) + '</div><div class="warning-box-text">' + escAttr(varianceNotes[cat]) + '</div></div></div>';
      }).join('') + '</div>'
    : '';

  detail.innerHTML = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Expense Report — ' + escAttr(names[r.created_by] || '—') + '</div>'
    + '<div class="profile-grid">'
    + travelReadOnlyField('Destination', est.destination_event)
    + travelReadOnlyField('Event Name', est.event_name)
    + travelReadOnlyField('Actual Dates', formatDate(r.actual_leave_date) + ' – ' + formatDate(r.actual_return_date))
    + travelReadOnlyField('Actual Grand Total', '$' + grand.toFixed(2))
    + travelReadOnlyField('Variance vs. Estimate', (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2))
    + '</div>'
    + varianceNotesHtml
    + '<div class="resume-section"><div class="resume-section-title">Receipts</div>' + receiptsHtml + '</div>'
    + '<div id="travel-approval-note-wrap" style="display:none;margin-top:10px;"><label class="field-label">Note (required for Return or Deny)</label><textarea class="info-edit-input" id="travel-approval-note" rows="2"></textarea></div>'
    + '<div class="login-error" id="travel-approval-error"></div>'
    + '<div class="profile-actions">'
    + '<button class="btn-save" onclick="expenseApprovalAction(\'' + r.id + '\',\'' + r.estimate_id + '\',\'approved\')">Approve (finalizes reimbursement)</button>'
    + '<button class="btn-edit" onclick="expenseApprovalAction(\'' + r.id + '\',\'' + r.estimate_id + '\',\'returned\')">Return</button>'
    + '<button class="btn-cancel" style="color:var(--red);border-color:var(--red);" onclick="expenseApprovalAction(\'' + r.id + '\',\'' + r.estimate_id + '\',\'denied\')">Deny</button>'
    + '<button class="btn-cancel" onclick="document.getElementById(\'travel-approval-detail\').innerHTML=\'\'">Close</button>'
    + '</div></div>';
}

async function expenseApprovalAction(expenseId, estimateId, decision){
  var noteWrap = document.getElementById('travel-approval-note-wrap');
  var noteField = document.getElementById('travel-approval-note');
  var errorEl = document.getElementById('travel-approval-error');
  errorEl.textContent = '';
  if(decision !== 'approved' && !noteField.value.trim()){
    noteWrap.style.display = '';
    errorEl.textContent = 'A note is required to return or deny this report.';
    return;
  }
  try{
    var { data: existing } = await supabaseClient.from('travel_expenses').select('current_status').eq('id', expenseId).limit(1);
    var previousStatus = existing && existing.length ? existing[0].current_status : null;

    var body = { supervisor_status: decision, current_status: decision === 'approved' ? 'approved' : decision };
    var { error } = await supabaseClient.from('travel_expenses').update(body).eq('id', expenseId);
    if(error){ throw error; }

    if(decision === 'approved'){
      await supabaseClient.from('travel_estimates').update({ status: 'paid' }).eq('id', estimateId);
    }

    await supabaseClient.from('travel_expense_audit_log').insert({
      expense_id: expenseId, changed_by: currentProfile.id, action: 'status_change',
      field_changes: { note: noteField ? noteField.value.trim() : null }, previous_status: previousStatus, new_status: body.current_status
    });

    document.getElementById('travel-approval-detail').innerHTML = '';
    loadApprovalsQueue();
  }catch(e){
    errorEl.textContent = 'Couldn\'t save decision. Try again.';
    console.error(e);
  }
}
