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

async function ensurePersonasLoaded(){
  if(currentPersonas.length){ return; }
  var { data, error } = await supabaseClient.from('personas').select('*').order('sort_order');
  if(error){ console.error(error); return; }
  currentPersonas = data;
}

// ---------- Auth ----------

async function handleSendMagicLink(){
  var email = document.getElementById('login-email').value.trim();
  var errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  if(!email){ errorEl.textContent = 'Enter your email.'; return; }

  var btn = document.getElementById('login-btn');
  btn.disabled = true;
  try{
    var { error } = await supabaseClient.auth.signInWithOtp({
      email: email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname }
    });
    if(error){ throw error; }
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('login-sent').style.display = 'block';
  }catch(e){
    errorEl.textContent = (e.code === 'otp_disabled')
      ? 'This email hasn\'t been invited to the demo yet — ask your contact for an invite.'
      : (e.message || 'Could not send the magic link — try again.');
    console.error(e);
  }finally{
    btn.disabled = false;
  }
}

async function handleSignOut(){
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

  if(currentProfile && currentProfile.active_persona_id){
    document.getElementById('switch-role-btn').style.display = '';
    document.getElementById('app-nav').style.display = 'flex';
    switchScreen('home');
  }else{
    await showRolePicker();
  }
}

// ---------- Role picker ----------

async function showRolePicker(){
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

function renderPersonaGrid(category, containerId){
  var container = document.getElementById(containerId);
  var list = currentPersonas.filter(function(p){ return p.category === category; });
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
    switchScreen('home');
  }catch(e){
    errorEl.textContent = 'Could not select that role — try again.';
    console.error(e);
  }
}

// ---------- Screen router ----------

function switchScreen(name){
  document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.screen === name); });
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  if(name === 'home' && typeof loadDashboard === 'function'){ loadDashboard(); }
  if(name === 'settings'){ renderThemeToggle(); }
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

// ---------- Small shared util (mirrors app-core.js's escAttr in the pilot portal) ----------
function escAttr(v){
  return (v == null ? '' : String(v)).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------- Boot ----------

supabaseClient.auth.onAuthStateChange(function(event, session){
  if(session && session.user){
    showApp(session);
  }else if(event === 'SIGNED_OUT'){
    showLogin();
  }
});
