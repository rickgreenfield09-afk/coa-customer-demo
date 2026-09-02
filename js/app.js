// COA Customer Demo — app.js
// Magic-link auth, role picker (persona list + clone_persona RPC), and the
// screen router for the (currently placeholder) Dashboard/Travel screens.
// Depends on supabaseClient.js (supabaseClient global).

var currentProfile = null;
var currentPersonas = [];

// Derived from currentProfile.active_persona_id + currentPersonas — used by
// dashboard.js to gate edit affordances (Customer Admin / platform admin only).
function currentPersonaSlug(){
  if(!currentProfile || !currentProfile.active_persona_id){ return null; }
  var p = currentPersonas.find(function(x){ return x.id === currentProfile.active_persona_id; });
  return p ? p.slug : null;
}
function isCustomerAdmin(){
  return currentProfile && (currentProfile.is_platform_admin || currentPersonaSlug() === 'customer_admin');
}
function isSupervisor(){
  return currentPersonaSlug() === 'supervisor';
}

// Resolves the demo_employees / customer_users id that should be stamped as
// the actor on an odc_commitments insert/close, based on the caller's
// current persona — Supervisor writes as their own demo_employees clone,
// Customer Admin writes as their customer_users membership row. Returns
// null if neither applies (e.g. platform admin with no persona selected —
// odc_commitments requires exactly one of the two actor columns, so there's
// no valid write path for that case here).
async function resolveOdcActor(){
  var slug = currentPersonaSlug();
  if(slug === 'supervisor'){
    var { data: emp, error } = await supabaseClient.from('demo_employees').select('id').eq('owner_profile_id', currentProfile.id).eq('persona_id', currentProfile.active_persona_id).limit(1);
    if(error){ console.error(error); return null; }
    return (emp && emp.length) ? { employee_id: emp[0].id, customer_user_id: null } : null;
  }
  if(slug === 'customer_admin'){
    var { data: cu, error: cuErr } = await supabaseClient.from('customer_users').select('id').eq('profile_id', currentProfile.id).limit(1);
    if(cuErr){ console.error(cuErr); return null; }
    return (cu && cu.length) ? { employee_id: null, customer_user_id: cu[0].id } : null;
  }
  return null;
}

async function ensurePersonasLoaded(){
  if(currentPersonas.length){ return; }
  var { data, error } = await supabaseClient.from('personas').select('*').order('sort_order');
  if(error){ console.error(error); return; }
  currentPersonas = data;
}

// ---------- Auth ----------

async function handleSendMagicLink(){
  var name = document.getElementById('login-name').value.trim();
  var company = document.getElementById('login-company').value.trim();
  var title = document.getElementById('login-title').value.trim();
  var email = document.getElementById('login-email').value.trim();
  var errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  if(!name || !company || !email){ errorEl.textContent = 'Name, Company, and Email are required.'; return; }

  var btn = document.getElementById('login-btn');
  btn.disabled = true;
  try{
    // shouldCreateUser: true — self-serve signup. handle_new_auth_user()
    // (Supabase trigger, migration 0015) only runs on a genuine new
    // auth.users row, so this metadata is ignored for a returning user;
    // it's captured once, at first signup, not re-sent on every login.
    var { error } = await supabaseClient.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: true,
        data: { full_name: name, company_name: company, title: title || null },
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });
    if(error){ throw error; }
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('login-sent').style.display = 'block';
  }catch(e){
    errorEl.textContent = e.message || 'Could not send the magic link — try again.';
    console.error(e);
  }finally{
    btn.disabled = false;
  }
}

async function handleSignOut(){
  if(!confirmLeaveIfTravelFormDirty()){ return; }
  try{
    await supabaseClient.rpc('reset_my_demo_session');
  }catch(e){
    console.error('Reset on sign-out failed (signing out anyway):', e);
  }
  await supabaseClient.auth.signOut();
  showLogin();
}

function showLogin(){
  document.getElementById('app-shell').classList.remove('active');
  document.getElementById('login-wrap').style.display = 'flex';
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('login-sent').style.display = 'none';
  document.getElementById('login-email').value = '';
  document.getElementById('login-error').textContent = '';
  currentProfile = null;
}

// ---------- Post-login bootstrap ----------

async function showApp(session){
  document.getElementById('login-wrap').style.display = 'none';
  document.getElementById('app-shell').classList.add('active');
  document.getElementById('user-email-display').textContent = session.user.email;

  var { data: rows, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .limit(1);
  if(error){ console.error(error); return; }
  currentProfile = rows && rows[0];
  await ensurePersonasLoaded();
  applyTheme(currentProfile ? currentProfile.theme_preference : 'dark');
  // White-label: a real signup's own company name (captured at signup,
  // migration 0015) replaces the placeholder everywhere post-login. The
  // login screen itself stays generic — there's no profile yet pre-auth.
  var companyNameEl = document.getElementById('header-company-name');
  if(companyNameEl){ companyNameEl.textContent = (currentProfile && currentProfile.display_company_name) || 'Axiom Forward Consulting'; }

  if(currentProfile && currentProfile.active_persona_id){
    document.getElementById('switch-role-btn').style.display = '';
    document.getElementById('app-nav').style.display = 'flex';
    updateNavVisibility();
    switchScreen('home');
  }else{
    await showRolePicker();
  }
}

// Travel isn't relevant to a Customer Viewer (no travel role at all).
// Contract Data (ported Burndown screens) and ODC Procurements are gated
// to Supervisor / Customer Admin — the personas playing "COA staff" /
// "the customer" respectively (see migration 0010).
function updateNavVisibility(){
  var travelBtn = document.getElementById('nav-btn-travel');
  travelBtn.style.display = currentPersonaSlug() === 'customer_viewer' ? 'none' : '';

  var showAdminScreens = isCustomerAdmin() || isSupervisor();
  var burndownBtn = document.getElementById('nav-btn-burndown');
  if(burndownBtn){ burndownBtn.style.display = showAdminScreens ? '' : 'none'; }
  var odcBtn = document.getElementById('nav-btn-odc');
  if(odcBtn){ odcBtn.style.display = showAdminScreens ? '' : 'none'; }
}

// ---------- Role picker ----------

async function showRolePicker(){
  if(!confirmLeaveIfTravelFormDirty()){ return; }
  document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-role-picker').classList.add('active');

  var errorEl = document.getElementById('persona-error');
  errorEl.textContent = '';
  await ensurePersonasLoaded();
  if(!currentPersonas.length){ errorEl.textContent = 'Could not load roles — try refreshing.'; return; }
  renderPersonaGrid('employee', 'persona-grid-employee');
  renderPersonaGrid('customer', 'persona-grid-customer');
}

// This build only offers 3 personas end-to-end: Employee, Supervisor, and
// Prime (customer_admin's persona-picker card, renamed to "Prime" —
// migration 0016). customer_viewer still exists in the personas table
// (nothing depends on removing the row) but is filtered out here so it's
// never selectable.
function renderPersonaGrid(category, containerId){
  var container = document.getElementById(containerId);
  var list = currentPersonas.filter(function(p){ return p.category === category && p.slug !== 'customer_viewer'; });
  container.innerHTML = list.map(function(p){
    var selected = currentProfile && currentProfile.active_persona_id === p.id;
    return '<div class="persona-card' + (selected ? ' selected' : '') + '" onclick="selectPersona(\'' + p.id + '\')">'
      + '<div class="persona-card-role">' + escAttr(p.display_role) + '</div>'
      + '<div class="persona-card-desc">' + escAttr(p.description) + '</div>'
      + '</div>';
  }).join('');
}

async function selectPersona(personaId){
  var errorEl = document.getElementById('persona-error');
  errorEl.textContent = '';
  try{
    var { error } = await supabaseClient.rpc('clone_persona', { p_persona_id: personaId });
    if(error){ throw error; }

    var { data: rows, error: profileError } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', currentProfile.id)
      .limit(1);
    if(profileError){ throw profileError; }
    currentProfile = rows[0];

    document.getElementById('switch-role-btn').style.display = '';
    document.getElementById('app-nav').style.display = 'flex';
    updateNavVisibility();
    switchScreen('home');
  }catch(e){
    errorEl.textContent = 'Could not select that role — try again.';
    console.error(e);
  }
}

// ---------- Screen router ----------

// Guards navigating away from an unsaved Travel Estimate (travel.js sets
// window.teFormDirty via a delegated listener on the open form). Native
// confirm() is used deliberately — it's synchronous, so it actually blocks
// the navigation on Cancel, unlike the app's custom modal.
function confirmLeaveIfTravelFormDirty(){
  if(typeof travelFormIsDirty !== 'function' || !travelFormIsDirty()){ return true; }
  return window.confirm('You have unsaved changes to this travel estimate. Click Cancel to go back and save or submit it, or OK to discard your changes and leave.');
}

function switchScreen(name){
  if(name !== 'travel' && !confirmLeaveIfTravelFormDirty()){ return; }
  document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.screen === name); });
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  if(name === 'home' && typeof loadDashboard === 'function'){ loadDashboard(); }
  if(name === 'travel' && typeof loadTravelScreen === 'function'){ loadTravelScreen(); }
  if(name === 'burndown' && typeof loadBurndownScreen === 'function'){ loadBurndownScreen(); }
  if(name === 'odc' && typeof loadOdcScreen === 'function'){ loadOdcScreen(); }
  if(name === 'settings'){ renderThemeToggle(); }
}

// ---------- Self-notification email (workflow nudges — "switch your role
// and act on this") ----------
// Reuses the send-report Edge Function, which only ever emails the calling
// user's own verified address (never a body-supplied one) — this is a
// single real person playing every persona via the role picker, so "notify
// the approver" means "email myself a reminder to switch roles," not
// emailing a different party. Fire-and-forget: a failed notification
// shouldn't block the workflow action that triggered it.
async function notifySelf(subject, html){
  try{
    var { error } = await supabaseClient.functions.invoke('send-report', { body: { subject: subject, html: html } });
    if(error){ throw error; }
  }catch(e){
    console.error('Notification email failed (continuing anyway):', e);
  }
}

// ---------- Shared toast (brief, self-dismissing success/status message —
// distinct from the blocking modal below) ----------
var showToastTimer = null;
function showToast(message){
  var el = document.getElementById('app-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('active');
  clearTimeout(showToastTimer);
  showToastTimer = setTimeout(function(){ el.classList.remove('active'); }, 3000);
}

// ---------- Shared modal (used by the Dashboard drill-down popups and the
// ODC Procurements "Close Commitment" flow) ----------
function openModal(titleHtml, bodyHtml, footerHtml){
  document.querySelector('#app-modal .modal-title').innerHTML = titleHtml;
  document.querySelector('#app-modal .modal-text').innerHTML = bodyHtml;
  document.querySelector('#app-modal .modal-actions').innerHTML = footerHtml || '';
  document.getElementById('app-modal').classList.add('active');
}
function closeModal(){
  document.getElementById('app-modal').classList.remove('active');
}

// ---------- Appearance (light/dark theme, Settings screen) ----------

function applyTheme(pref){
  var isLight = pref === 'light';
  document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
  try{ localStorage.setItem('axiom_theme', isLight ? 'light' : 'dark'); }catch(e){ /* private mode, etc. */ }
}

function renderThemeToggle(){
  var pref = (currentProfile && currentProfile.theme_preference) || 'dark';
  document.getElementById('theme-btn-dark').classList.toggle('active', pref === 'dark');
  document.getElementById('theme-btn-light').classList.toggle('active', pref === 'light');
}

async function setThemePreference(pref){
  applyTheme(pref);
  renderThemeToggle();
  try{
    var { error } = await supabaseClient.from('profiles').update({ theme_preference: pref }).eq('id', currentProfile.id);
    if(error){ throw error; }
    currentProfile.theme_preference = pref;
  }catch(e){
    console.error('Could not save theme preference:', e);
  }
}

// ---------- Small shared utils (mirror app-core.js's escAttr/formatDate in the pilot portal) ----------
function escAttr(v){
  return (v == null ? '' : String(v)).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Plain YYYY-MM-DD strings must be parsed as local calendar components, not
// UTC midnight — `new Date(d)` on a date-only string parses as UTC, so
// anyone west of UTC sees every date render one day early once
// toLocaleDateString() converts back to local time.
function formatDate(d){
  if(!d){ return '—'; }
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  var dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------- Boot ----------

// Supabase re-fires auth events (TOKEN_REFRESHED, and in some cases even
// SIGNED_IN again) when a background tab regains focus, re-triggering
// showApp()'s full bootstrap (which resets the screen router to Dashboard)
// even though it's still the same logged-in user. Event-name checks alone
// aren't reliable here — gate on whether we've already bootstrapped THIS
// user id instead, so any refire for an already-signed-in user is a no-op.
var bootstrappedUserId = null;

supabaseClient.auth.onAuthStateChange(function(event, session){
  if(session && session.user){
    if(session.user.id !== bootstrappedUserId){
      bootstrappedUserId = session.user.id;
      showApp(session);
    }
  }else if(event === 'SIGNED_OUT'){
    bootstrappedUserId = null;
    showLogin();
  }
});
