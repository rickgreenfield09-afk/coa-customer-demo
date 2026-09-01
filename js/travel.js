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
  return travel.odcSlins.map(function(s){
    return '<option value="' + s.slin_id + '"' + (s.slin_id === selected ? ' selected' : '') + '>' + escAttr(s.slin_code) + ' — ' + escAttr(s.slin_description || '') + '</option>';
  }).join('');
}

// =====================================================================
// TRAVEL ESTIMATE
// =====================================================================

var teEditingId = null;
var teEditingRow = null;
var teLodgingQuotes = [];

async function loadMyEstimates(editId){
  var content = document.getElementById('travel-content');
  teEditingId = editId || null;
  teEditingRow = null;

  if(!travel.employeeId){
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">No employee record found</div><div class="placeholder-sub">Try switching roles and back, or refreshing the page.</div></div>';
    return;
  }

  try{
    if(teEditingId){
      var { data: rows } = await supabaseClient.from('travel_estimates').select('*').eq('id', teEditingId).limit(1);
      if(rows && rows.length){ teEditingRow = rows[0]; }
    }

    if(teEditingRow && teEditingRow.status !== 'draft'){
      content.innerHTML = '<div id="te-detail-wrap"></div><div class="tk-entry-card"><div class="tk-section-title">My Travel Estimates</div>' + (await teRenderMyEstimatesTable()) + '</div>';
      renderTeReadOnlyDetail(teEditingRow);
      return;
    }

    content.innerHTML = teFormHtml(teEditingRow) + '<div class="tk-entry-card"><div class="tk-section-title">My Travel Estimates</div>' + (await teRenderMyEstimatesTable()) + '</div>';
    if(teEditingRow){ tePrefillForm(teEditingRow); }
    await teLoadLodgingQuotes();
    teRecalc();
  }catch(e){
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load travel estimates</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
    console.error(e);
  }
}

function teFormHtml(row){
  return '<div class="tk-entry-card">'
    + '<div class="tk-section-title">' + (row ? 'Edit Draft Travel Estimate' : 'New Travel Estimate') + '</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1.3fr 70px 1fr 100px 140px 140px;">'
    + '<div><label class="field-label" for="te-city">City</label><input class="field-input" id="te-city" placeholder="City" onchange="teMaybeAutoLookupGsa()"></div>'
    + '<div><label class="field-label" for="te-state">State</label><input class="field-input" id="te-state" placeholder="ST" maxlength="20" onchange="teMaybeAutoLookupGsa()"></div>'
    + '<div><label class="field-label" for="te-event-name">Event Name</label><input class="field-input" id="te-event-name" placeholder="Event name"></div>'
    + '<div><label class="field-label" for="te-trainers">Trainers</label><input type="number" min="1" step="1" class="field-input" id="te-trainers" value="1" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-leave-date">Leave Date</label><input type="date" class="field-input" id="te-leave-date" oninput="teRecalc();teMaybeAutoLookupGsa();"></div>'
    + '<div><label class="field-label" for="te-return-date">Return Date</label><input type="date" class="field-input" id="te-return-date" oninput="teRecalc()"></div>'
    + '</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:220px auto;">'
    + '<div><label class="field-label" for="te-slin">ODC / Travel SLIN</label><select class="field-input" id="te-slin">' + slinOptionsHtml() + '</select></div>'
    + '<div></div>'
    + '</div>'
    + '<div class="cfd-two-col">'
    + '<div class="resume-section"><div class="resume-section-title">Lodging</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
    + '<div><label class="field-label" for="te-gsa-lodging-rate">GSA Lodging Rate (per night)</label><input type="number" step="0.01" class="field-input" id="te-gsa-lodging-rate" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-meals-rate">Meals (M&amp;IE) Rate (per day)</label><input type="number" step="0.01" class="field-input" id="te-meals-rate" value="0" oninput="teRecalc()"></div>'
    + '</div>'
    + '<div style="margin:4px 0 8px;"><button type="button" class="btn-cancel" id="te-gsa-lookup-btn" onclick="teMaybeAutoLookupGsa()">Refresh GSA Rates</button></div>'
    + '<div class="login-error" id="te-gsa-lookup-error" style="text-align:left;margin-top:-4px;"></div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 1fr;">'
    + '<div><label class="field-label" for="te-lodging-cost">Lodging Cost (per night, requested)</label><input type="number" step="0.01" class="field-input" id="te-lodging-cost" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-lodging-fees">Lodging Fees</label><input type="number" step="0.01" class="field-input" id="te-lodging-fees" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-lodging-taxes">Lodging Taxes</label><input type="number" step="0.01" class="field-input" id="te-lodging-taxes" value="0" oninput="teRecalc()"></div>'
    + '</div>'
    + '<div class="warning-box" id="te-lodging-warning" style="display:none;">'
    + '<div><div class="warning-box-title">Lodging cost exceeds GSA rate</div><div class="warning-box-text" id="te-lodging-warning-text"></div>'
    + '<button type="button" class="btn-edit" style="margin-top:8px;" id="te-lodging-quotes-btn" onclick="teOpenLodgingQuotesModal()">Upload Comparison Quotes</button></div>'
    + '</div>'
    + '<div class="profile-grid" style="margin-top:4px;">'
    + '<div class="info-box"><div class="info-label">Nights</div><div class="info-val" id="te-calc-nights">0</div></div>'
    + '<div class="info-box"><div class="info-label">Full Days (1x)</div><div class="info-val" id="te-calc-fulldays">0</div></div>'
    + '<div class="info-box"><div class="info-label">Per Diem Meals Total</div><div class="info-val" id="te-calc-perdiem">$0.00</div></div>'
    + '</div></div>'
    + '<div class="resume-section"><div class="resume-section-title">Flight</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr;">'
    + '<div><label class="field-label" for="te-airfare">Airfare (avg)</label><input type="number" step="0.01" class="field-input" id="te-airfare" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-baggage">Baggage</label><input type="number" step="0.01" class="field-input" id="te-baggage" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-parking-transport">Airport Parking</label><input type="number" step="0.01" class="field-input" id="te-parking-transport" value="0" oninput="teRecalc()"></div>'
    + '</div></div>'
    + '</div>'
    + '<div class="resume-section"><div class="resume-section-title">Transportation</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:120px 100px 100px 100px 140px 180px;">'
    + '<div><label class="field-label" for="te-rental-car">Rental Car</label><input type="number" step="0.01" class="field-input" id="te-rental-car" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-fuel-gas">Gas</label><input type="number" step="0.01" class="field-input" id="te-fuel-gas" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-parking">Parking</label><input type="number" step="0.01" class="field-input" id="te-parking" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-tolls">Tolls</label><input type="number" step="0.01" class="field-input" id="te-tolls" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-rideshare">Rideshare Estimate</label><input type="number" step="0.01" class="field-input" id="te-rideshare" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-mileage">Mileage (Personal Vehicle)</label><input type="number" step="0.01" class="field-input" id="te-mileage" value="0" oninput="teRecalc()"></div>'
    + '</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:140px 140px auto;">'
    + '<div><label class="field-label" for="te-shipping-to">Shipping (to)</label><input type="number" step="0.01" class="field-input" id="te-shipping-to" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-shipping-back">Shipping (back)</label><input type="number" step="0.01" class="field-input" id="te-shipping-back" value="0" oninput="teRecalc()"></div>'
    + '<div></div>'
    + '</div></div>'
    + '<div class="resume-section"><div class="resume-section-title">EWW (Extended Work Week)</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:160px 200px auto;">'
    + '<div><label class="field-label" for="te-eww-rate">EWW Rate (per hour)</label><input type="number" step="0.01" class="field-input" id="te-eww-rate" value="0" oninput="teRecalc()"></div>'
    + '<div><label class="field-label" for="te-eww-hours">EWW Hours per Trainer</label><input type="number" step="0.01" class="field-input" id="te-eww-hours" value="0" oninput="teRecalc()"></div>'
    + '<div></div>'
    + '</div></div>'
    + '<div class="tk-entry-card" style="margin-top:14px;margin-bottom:0;">'
    + '<div class="tk-pto-summary-row">'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Per Traveler Subtotal</div><div class="tk-pto-stat-val" id="te-total-per-traveler">$0.00</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Trip Lead Total</div><div class="tk-pto-stat-val" id="te-total-trip-lead">$0.00</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">EWW Total</div><div class="tk-pto-stat-val" id="te-total-eww">$0.00</div></div>'
    + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Grand Total (ODC + EWW)</div><div class="tk-pto-stat-val" id="te-total-grand">$0.00</div></div>'
    + '</div></div>'
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
  document.getElementById('te-trainers').value = row.number_of_trainers || 1;
  document.getElementById('te-leave-date').value = row.leave_date || '';
  document.getElementById('te-return-date').value = row.return_date || '';
  document.getElementById('te-gsa-lodging-rate').value = row.per_diem_lodging_rate || 0;
  document.getElementById('te-lodging-cost').value = row.lodging_cost_per_night || 0;
  document.getElementById('te-lodging-fees').value = row.lodging_fees || 0;
  document.getElementById('te-lodging-taxes').value = row.lodging_taxes || 0;
  document.getElementById('te-meals-rate').value = row.per_diem_meals_rate || 0;
  document.getElementById('te-airfare').value = row.airfare_avg || 0;
  document.getElementById('te-parking-transport').value = row.airport_parking_transport || 0;
  document.getElementById('te-baggage').value = row.baggage || 0;
  document.getElementById('te-rental-car').value = row.rental_car || 0;
  document.getElementById('te-fuel-gas').value = row.fuel_gas || 0;
  document.getElementById('te-parking').value = row.parking || 0;
  document.getElementById('te-tolls').value = row.tolls || 0;
  document.getElementById('te-rideshare').value = row.rideshare_estimate || 0;
  document.getElementById('te-mileage').value = row.mileage || 0;
  document.getElementById('te-shipping-to').value = row.shipping_to || 0;
  document.getElementById('te-shipping-back').value = row.shipping_back || 0;
  document.getElementById('te-eww-rate').value = row.eww_rate || 0;
  document.getElementById('te-eww-hours').value = row.eww_hours_per_trainer || 0;
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
  var ewwTotal = inputs.ewwRate * inputs.ewwHours * inputs.trainers;

  return {
    nights: nights, fullDays: fullDays, perDiemMealsTotal: perDiemMealsTotal, hotelTotal: hotelTotal,
    ewwTotal: ewwTotal, perTravelerInternal: perTravelerInternal, tripLeadInternal: tripLeadInternal
  };
}

function teReadFormInputs(){
  return {
    leaveDate: document.getElementById('te-leave-date').value,
    returnDate: document.getElementById('te-return-date').value,
    trainers: parseInt(document.getElementById('te-trainers').value, 10) || 1,
    lodgingRate: parseFloat(document.getElementById('te-gsa-lodging-rate').value) || 0,
    lodgingCost: parseFloat(document.getElementById('te-lodging-cost').value) || 0,
    lodgingFees: parseFloat(document.getElementById('te-lodging-fees').value) || 0,
    lodgingTaxes: parseFloat(document.getElementById('te-lodging-taxes').value) || 0,
    mealsRate: parseFloat(document.getElementById('te-meals-rate').value) || 0,
    airfare: parseFloat(document.getElementById('te-airfare').value) || 0,
    parkingTransport: parseFloat(document.getElementById('te-parking-transport').value) || 0,
    baggage: parseFloat(document.getElementById('te-baggage').value) || 0,
    rentalCar: parseFloat(document.getElementById('te-rental-car').value) || 0,
    fuelGas: parseFloat(document.getElementById('te-fuel-gas').value) || 0,
    parking: parseFloat(document.getElementById('te-parking').value) || 0,
    tolls: parseFloat(document.getElementById('te-tolls').value) || 0,
    rideshare: parseFloat(document.getElementById('te-rideshare').value) || 0,
    mileage: parseFloat(document.getElementById('te-mileage').value) || 0,
    shippingTo: parseFloat(document.getElementById('te-shipping-to').value) || 0,
    shippingBack: parseFloat(document.getElementById('te-shipping-back').value) || 0,
    ewwRate: parseFloat(document.getElementById('te-eww-rate').value) || 0,
    ewwHours: parseFloat(document.getElementById('te-eww-hours').value) || 0
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

async function teRenderMyEstimatesTable(){
  var { data: rows } = await supabaseClient.from('travel_estimates').select('id,destination_event,event_name,leave_date,return_date,status,trip_lead_total,eww_total').eq('created_by', travel.employeeId).order('created_at', { ascending: false });
  rows = rows || [];
  if(!rows.length){ return '<div class="tk-empty">No travel estimates yet.</div>'; }
  return '<div class="tk-grid-table-wrap"><table class="tk-grid-table"><thead><tr><th>Destination / Event</th><th>Dates</th><th>Status</th><th>Grand Total</th><th></th></tr></thead><tbody>'
    + rows.map(function(r){
        var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
        var action = r.status === 'draft'
          ? '<button class="tk-now-btn" type="button" onclick="loadMyEstimates(\'' + r.id + '\')">Edit Draft</button>'
          : '<button class="tk-now-btn" type="button" onclick="loadMyEstimates(\'' + r.id + '\')">View</button>';
        return '<tr><td>' + escAttr(r.destination_event || '—') + (r.event_name ? ' — ' + escAttr(r.event_name) : '') + '</td>'
          + '<td>' + formatDate(r.leave_date) + ' – ' + formatDate(r.return_date) + '</td>'
          + '<td><span class="tk-status-pill ' + r.status + '">' + r.status.replace('_', ' ') + '</span></td>'
          + '<td>$' + grand.toFixed(2) + '</td><td>' + action + '</td></tr>';
      }).join('')
    + '</tbody></table></div>';
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

async function submitTravelEstimate(targetStatus){
  var errorEl = document.getElementById('te-form-error');
  errorEl.textContent = '';
  var city = document.getElementById('te-city').value.trim();
  var state = document.getElementById('te-state').value.trim();
  var eventName = document.getElementById('te-event-name').value.trim();
  var slinId = document.getElementById('te-slin').value;
  var inputs = teReadFormInputs();

  if(targetStatus === 'submitted'){
    if(!city || !state || !slinId || !inputs.leaveDate || !inputs.returnDate){
      errorEl.textContent = 'City, State, SLIN, and both dates are required to submit.';
      return;
    }
    if(new Date(inputs.returnDate) < new Date(inputs.leaveDate)){
      errorEl.textContent = 'Return date must be on or after leave date.';
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

  var calc = teCalc(inputs);
  var destinationEvent = (city && state) ? (city + ', ' + state) : (city || state || null);
  var body = {
    destination_event: destinationEvent, city: city || null, state: state || null, event_name: eventName || null, slin_id: slinId || null,
    leave_date: inputs.leaveDate || null, return_date: inputs.returnDate || null,
    number_of_trainers: inputs.trainers, per_diem_lodging_rate: inputs.lodgingRate, lodging_cost_per_night: inputs.lodgingCost, per_diem_meals_rate: inputs.mealsRate,
    lodging_fees: inputs.lodgingFees, lodging_taxes: inputs.lodgingTaxes,
    airfare_avg: inputs.airfare, airport_parking_transport: inputs.parkingTransport, baggage: inputs.baggage,
    rental_car: inputs.rentalCar, fuel_gas: inputs.fuelGas, parking: inputs.parking, tolls: inputs.tolls, rideshare_estimate: inputs.rideshare, mileage: inputs.mileage,
    shipping_to: inputs.shippingTo, shipping_back: inputs.shippingBack,
    eww_rate: inputs.ewwRate, eww_hours_per_trainer: inputs.ewwHours,
    per_traveler_subtotal: calc.perTravelerInternal, trip_lead_total: calc.tripLeadInternal,
    estimated_total_odc: calc.tripLeadInternal, eww_total: calc.ewwTotal, status: targetStatus
  };
  if(targetStatus === 'submitted'){ body.fee_multiplier_used = travel.feeMultiplier; }

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

    await supabaseClient.from('travel_estimate_audit_log').insert({
      estimate_id: newId, changed_by: currentProfile.id,
      action: (previousStatus && previousStatus !== targetStatus) ? 'status_change' : 'edit',
      previous_status: previousStatus, new_status: targetStatus
    });

    teEditingId = null; teEditingRow = null;
    loadMyEstimates();
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
    if(data.lodgingRate != null){ document.getElementById('te-gsa-lodging-rate').value = data.lodgingRate; }
    if(data.mealsRate != null){ document.getElementById('te-meals-rate').value = data.mealsRate; }
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
    openModal('Comparison Quotes', '<div class="placeholder-sub">Save as Draft first to attach comparison quotes.</div>', '<button class="btn-cancel" onclick="closeModal()">Close</button>');
    return;
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

async function openEstimateApproval(estimateId){
  var detail = document.getElementById('travel-approval-detail');
  detail.innerHTML = '<div class="tk-entry-card"><div class="placeholder-sub">Loading...</div></div>';
  var { data: rows } = await supabaseClient.from('travel_estimates').select('*').eq('id', estimateId).limit(1);
  if(!rows || !rows.length){ detail.innerHTML = ''; return; }
  var r = rows[0];
  var names = await employeeNamesById([r.created_by]);
  var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);

  detail.innerHTML = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Travel Estimate — ' + escAttr(names[r.created_by] || '—') + '</div>'
    + '<div class="profile-grid">'
    + travelReadOnlyField('Destination', r.destination_event)
    + travelReadOnlyField('Event Name', r.event_name)
    + travelReadOnlyField('Dates', formatDate(r.leave_date) + ' – ' + formatDate(r.return_date))
    + travelReadOnlyField('Number of Trainers', r.number_of_trainers)
    + travelReadOnlyField('Trip Lead Total', '$' + (parseFloat(r.trip_lead_total) || 0).toFixed(2))
    + travelReadOnlyField('EWW Total', '$' + (parseFloat(r.eww_total) || 0).toFixed(2))
    + travelReadOnlyField('Grand Total', '$' + grand.toFixed(2))
    + '</div>'
    + '<div id="travel-approval-note-wrap" style="display:none;margin-top:10px;"><label class="field-label">Note (required for Return or Deny)</label><textarea class="info-edit-input" id="travel-approval-note" rows="2"></textarea></div>'
    + '<div class="login-error" id="travel-approval-error"></div>'
    + '<div class="profile-actions">'
    + '<button class="btn-save" onclick="estimateApprovalAction(\'' + r.id + '\',\'supervisor_approved\')">Approve (sends to Customer for authorization)</button>'
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

async function loadMyExpenses(editId){
  var content = document.getElementById('travel-content');
  texEditingId = editId || null;
  texEditingRow = null;

  if(!travel.employeeId){
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">No employee record found</div><div class="placeholder-sub">Try switching roles and back, or refreshing the page.</div></div>';
    return;
  }

  try{
    if(texEditingId){
      var { data: rows } = await supabaseClient.from('travel_expenses').select('*, travel_estimates(destination_event,event_name,leave_date,return_date,trip_lead_total,eww_total,number_of_trainers,per_diem_meals_rate,eww_rate,eww_hours_per_trainer)').eq('id', texEditingId).limit(1);
      if(rows && rows.length){ texEditingRow = rows[0]; }
    }

    if(texEditingRow && texEditingRow.current_status !== 'draft'){
      content.innerHTML = '<div id="tex-detail-wrap"></div><div class="tk-entry-card"><div class="tk-section-title">My Expense Reports</div>' + (await texRenderMyReportsTable()) + '</div>';
      renderTexReadOnlyDetail(texEditingRow);
      return;
    }

    if(!texEditingRow){
      var { data: approved } = await supabaseClient.from('travel_estimates').select('id,destination_event,event_name,leave_date,return_date,trip_lead_total,eww_total,number_of_trainers,per_diem_meals_rate,eww_rate,eww_hours_per_trainer').eq('created_by', travel.employeeId).eq('status', 'approved');
      var { data: existing } = await supabaseClient.from('travel_expenses').select('estimate_id').eq('created_by', travel.employeeId);
      var takenIds = (existing || []).map(function(r){ return r.estimate_id; });
      texAvailableEstimates = (approved || []).filter(function(e){ return takenIds.indexOf(e.id) === -1; });
    }

    content.innerHTML = texFormHtml(texEditingRow) + '<div class="tk-entry-card"><div class="tk-section-title">My Expense Reports</div>' + (await texRenderMyReportsTable()) + '</div>';

    if(texEditingRow){
      texLinkedEstimateTotals = {
        tripLead: parseFloat(texEditingRow.travel_estimates && texEditingRow.travel_estimates.trip_lead_total) || 0,
        eww: parseFloat(texEditingRow.travel_estimates && texEditingRow.travel_estimates.eww_total) || 0
      };
      texPrefillForm(texEditingRow);
      texLoadReceipts(texEditingRow.id, false);
    }
    texRecalc();
  }catch(e){
    content.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load expense reports</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
    console.error(e);
  }
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
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 1fr;">'
    + '<div><label class="field-label" for="tex-airfare">Airfare</label><input type="number" step="0.01" class="field-input" id="tex-airfare" value="0" oninput="texRecalc()"></div>'
    + '<div><label class="field-label" for="tex-parking-transport">Airport Parking / Transport</label><input type="number" step="0.01" class="field-input" id="tex-parking-transport" value="0" oninput="texRecalc()"></div>'
    + '<div><label class="field-label" for="tex-baggage">Baggage</label><input type="number" step="0.01" class="field-input" id="tex-baggage" value="0" oninput="texRecalc()"></div>'
    + '<div><label class="field-label" for="tex-lodging-total">Lodging (actual total)</label><input type="number" step="0.01" class="field-input" id="tex-lodging-total" value="0" oninput="texRecalc()"></div>'
    + '<div><label class="field-label" for="tex-rental-car">Rental Car / Gas / Parking / Tolls</label><input type="number" step="0.01" class="field-input" id="tex-rental-car" value="0" oninput="texRecalc()"></div>'
    + '<div><label class="field-label" for="tex-mileage">Mileage</label><input type="number" step="0.01" class="field-input" id="tex-mileage" value="0" oninput="texRecalc()"></div>'
    + '</div>'
    + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
    + '<div><label class="field-label" for="tex-shipping-to">Shipping (to)</label><input type="number" step="0.01" class="field-input" id="tex-shipping-to" value="0" oninput="texRecalc()"></div>'
    + '<div><label class="field-label" for="tex-shipping-back">Shipping (back)</label><input type="number" step="0.01" class="field-input" id="tex-shipping-back" value="0" oninput="texRecalc()"></div>'
    + '</div></div>'
    + '<div class="resume-section"><div class="resume-section-title">Receipts</div>'
    + (texEditingId ? '<input type="file" id="tex-receipt-input" multiple onchange="texUploadReceipts(this.files)">' : '<div class="placeholder-sub">Save as Draft first to attach receipts.</div>')
    + '<div id="tex-receipts-list" style="margin-top:10px;"></div></div>'
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
  formBody.style.display = '';
  document.getElementById('tex-actual-leave-date').value = est.leave_date || '';
  document.getElementById('tex-actual-return-date').value = est.return_date || '';
  document.getElementById('tex-trainers').value = est.number_of_trainers || 1;
  document.getElementById('tex-meals-rate').value = est.per_diem_meals_rate || 0;
  document.getElementById('tex-eww-rate').value = est.eww_rate || 0;
  document.getElementById('tex-eww-hours').value = est.eww_hours_per_trainer || 0;
  texRecalc();
}

function texPrefillForm(row){
  document.getElementById('tex-actual-leave-date').value = row.actual_leave_date || '';
  document.getElementById('tex-actual-return-date').value = row.actual_return_date || '';
  document.getElementById('tex-trainers').value = row.number_of_trainers || 1;
  document.getElementById('tex-meals-rate').value = row.per_diem_meals_rate || 0;
  document.getElementById('tex-eww-rate').value = row.eww_rate || 0;
  document.getElementById('tex-eww-hours').value = row.eww_hours_per_trainer || 0;
  document.getElementById('tex-airfare').value = row.actual_airfare || 0;
  document.getElementById('tex-parking-transport').value = row.actual_airport_parking_transport || 0;
  document.getElementById('tex-baggage').value = row.actual_baggage || 0;
  document.getElementById('tex-lodging-total').value = row.actual_lodging_total || 0;
  document.getElementById('tex-rental-car').value = row.actual_rental_car_gas_parking_tolls || 0;
  document.getElementById('tex-mileage').value = row.actual_mileage || 0;
  document.getElementById('tex-shipping-to').value = row.actual_shipping_to || 0;
  document.getElementById('tex-shipping-back').value = row.actual_shipping_back || 0;
}

function texCalc(inputs){
  var leave = inputs.leaveDate ? new Date(inputs.leaveDate) : null;
  var ret = inputs.returnDate ? new Date(inputs.returnDate) : null;
  var nights = (leave && ret) ? Math.round((ret - leave) / 86400000) : 0;
  if(nights < 0){ nights = 0; }

  var perDiemMealsTotal = (1.5 * inputs.mealsRate) + (Math.max(nights - 1, 0) * inputs.mealsRate);
  var perTravelerBucket = inputs.lodgingTotal + inputs.airfare + inputs.parkingTransport + inputs.baggage;
  var perTravelerSubtotal = perDiemMealsTotal + perTravelerBucket;
  var tripLevelBucket = inputs.rentalCar + inputs.mileage + inputs.shippingTo + inputs.shippingBack;
  var tripLeadTotal = (perTravelerSubtotal * inputs.trainers) + tripLevelBucket;
  var ewwTotal = inputs.ewwRate * inputs.ewwHours * inputs.trainers;

  return { nights: nights, perDiemMealsTotal: perDiemMealsTotal, perTravelerSubtotal: perTravelerSubtotal, tripLeadTotal: tripLeadTotal, ewwTotal: ewwTotal };
}

function texReadFormInputs(){
  return {
    leaveDate: document.getElementById('tex-actual-leave-date').value,
    returnDate: document.getElementById('tex-actual-return-date').value,
    trainers: parseInt(document.getElementById('tex-trainers').value, 10) || 1,
    mealsRate: parseFloat(document.getElementById('tex-meals-rate').value) || 0,
    ewwRate: parseFloat(document.getElementById('tex-eww-rate').value) || 0,
    ewwHours: parseFloat(document.getElementById('tex-eww-hours').value) || 0,
    airfare: parseFloat(document.getElementById('tex-airfare').value) || 0,
    parkingTransport: parseFloat(document.getElementById('tex-parking-transport').value) || 0,
    baggage: parseFloat(document.getElementById('tex-baggage').value) || 0,
    lodgingTotal: parseFloat(document.getElementById('tex-lodging-total').value) || 0,
    rentalCar: parseFloat(document.getElementById('tex-rental-car').value) || 0,
    mileage: parseFloat(document.getElementById('tex-mileage').value) || 0,
    shippingTo: parseFloat(document.getElementById('tex-shipping-to').value) || 0,
    shippingBack: parseFloat(document.getElementById('tex-shipping-back').value) || 0
  };
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
    + '<div class="resume-section"><div class="resume-section-title">Receipts</div><div id="tex-receipts-list"></div></div>'
    + '<div class="profile-actions"><button class="btn-cancel" onclick="loadMyExpenses()">Back</button></div>'
    + '</div>';
  texLoadReceipts(r.id, true);
}

async function texLoadReceipts(expenseId, readOnly){
  var listEl = document.getElementById('tex-receipts-list');
  if(!listEl){ return; }
  try{
    var { data: rows } = await supabaseClient.from('travel_expense_receipts').select('*').eq('expense_id', expenseId).order('uploaded_at');
    rows = rows || [];
    if(!rows.length){ listEl.innerHTML = '<div class="tk-empty">No receipts attached yet.</div>'; return; }
    listEl.innerHTML = rows.map(function(rec){
      var removeBtn = readOnly ? '' : ' <button type="button" class="btn-remove-row" style="display:inline;margin-top:0;" onclick="texRemoveReceipt(\'' + rec.id + '\')">Remove</button>';
      return '<div class="resume-cart-item"><a href="' + rec.file_url + '" target="_blank">' + escAttr(rec.file_name || 'Receipt') + '</a>' + removeBtn + '</div>';
    }).join('');
  }catch(e){
    listEl.innerHTML = '<div class="tk-empty">Couldn\'t load receipts.</div>';
    console.error(e);
  }
}

async function texUploadReceipts(files){
  if(!texEditingId || !files || !files.length){ return; }
  var errorEl = document.getElementById('tex-form-error');
  for(var i = 0; i < files.length; i++){
    var file = files[i];
    var path = texEditingId + '/' + Date.now() + '-' + file.name;
    try{
      var { error: upErr } = await supabaseClient.storage.from('travel-receipts').upload(path, file);
      if(upErr){ throw upErr; }
      var { data: pub } = supabaseClient.storage.from('travel-receipts').getPublicUrl(path);
      var { error: insErr } = await supabaseClient.from('travel_expense_receipts').insert({
        expense_id: texEditingId, file_url: pub.publicUrl, file_name: file.name, uploaded_by: travel.employeeId
      });
      if(insErr){ throw insErr; }
    }catch(e){
      errorEl.textContent = 'Couldn\'t upload ' + file.name + '. Try again.';
      console.error(e);
    }
  }
  document.getElementById('tex-receipt-input').value = '';
  texLoadReceipts(texEditingId, false);
}

async function texRemoveReceipt(receiptId){
  try{
    var { data: rec } = await supabaseClient.from('travel_expense_receipts').select('file_url').eq('id', receiptId).limit(1);
    await supabaseClient.from('travel_expense_receipts').delete().eq('id', receiptId);
    if(rec && rec.length){
      var marker = '/storage/v1/object/public/travel-receipts/';
      var idx = rec[0].file_url.indexOf(marker);
      if(idx !== -1){
        var path = rec[0].file_url.slice(idx + marker.length);
        await supabaseClient.storage.from('travel-receipts').remove([path]);
      }
    }
    texLoadReceipts(texEditingId, false);
  }catch(e){ console.error(e); }
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
  }

  var calc = texCalc(inputs);
  var grand = calc.tripLeadTotal + calc.ewwTotal;
  var estimateGrand = texLinkedEstimateTotals.tripLead + texLinkedEstimateTotals.eww;

  var body = {
    estimate_id: estimateId, number_of_trainers: inputs.trainers,
    actual_leave_date: inputs.leaveDate || null, actual_return_date: inputs.returnDate || null,
    actual_airfare: inputs.airfare, actual_airport_parking_transport: inputs.parkingTransport, actual_baggage: inputs.baggage,
    actual_lodging_total: inputs.lodgingTotal, actual_rental_car_gas_parking_tolls: inputs.rentalCar, actual_mileage: inputs.mileage,
    actual_shipping_to: inputs.shippingTo, actual_shipping_back: inputs.shippingBack,
    per_diem_meals_rate: inputs.mealsRate, eww_rate: inputs.ewwRate, eww_hours_per_trainer: inputs.ewwHours,
    actual_per_diem_meals_total: calc.perDiemMealsTotal, actual_per_traveler_subtotal: calc.perTravelerSubtotal,
    actual_trip_lead_total: calc.tripLeadTotal, actual_total_odc: calc.tripLeadTotal, actual_eww_total: calc.ewwTotal,
    variance_total: grand - estimateGrand, current_status: targetStatus
  };
  if(targetStatus === 'submitted'){ body.supervisor_status = 'pending'; }

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

  detail.innerHTML = '<div class="tk-entry-card">'
    + '<div class="tk-section-title">Expense Report — ' + escAttr(names[r.created_by] || '—') + '</div>'
    + '<div class="profile-grid">'
    + travelReadOnlyField('Destination', est.destination_event)
    + travelReadOnlyField('Event Name', est.event_name)
    + travelReadOnlyField('Actual Dates', formatDate(r.actual_leave_date) + ' – ' + formatDate(r.actual_return_date))
    + travelReadOnlyField('Actual Grand Total', '$' + grand.toFixed(2))
    + travelReadOnlyField('Variance vs. Estimate', (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2))
    + '</div>'
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
