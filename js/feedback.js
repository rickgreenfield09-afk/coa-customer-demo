// Demo feedback widget — floating button + modal, only reachable inside
// #app-shell (i.e. after OTP verification), so every submission carries a
// known, verified user email. Posts to the submit-feedback Edge Function,
// which forwards the payload server-side to a Power Automate HTTP trigger
// that writes it into the SharePoint feedback list.

var SCREEN_LABELS = {
  home: 'Dashboard',
  travel: 'Travel',
  burndown: 'Contract Data',
  odc: 'ODC Procurements',
  settings: 'Settings',
};

function currentScreenLabel(){
  var activeNav = document.querySelector('.nav-btn.active');
  if(activeNav && SCREEN_LABELS[activeNav.dataset.screen]){
    return SCREEN_LABELS[activeNav.dataset.screen];
  }
  return 'Other';
}

function openFeedbackModal(){
  document.getElementById('feedback-error').textContent = '';
  document.getElementById('feedback-form-wrap').style.display = 'block';
  document.getElementById('feedback-success-wrap').style.display = 'none';
  document.getElementById('feedback-type').value = 'Bug';
  document.getElementById('feedback-screen').value = currentScreenLabel();
  document.getElementById('feedback-severity').value = "I'm not sure";
  document.getElementById('feedback-description').value = '';
  document.getElementById('feedback-repro').value = '';
  document.getElementById('feedback-modal').classList.add('active');
}

function closeFeedbackModal(){
  document.getElementById('feedback-modal').classList.remove('active');
}

async function submitFeedback(){
  var errorEl = document.getElementById('feedback-error');
  var description = document.getElementById('feedback-description').value.trim();
  if(!description){
    errorEl.textContent = 'Please describe the issue or suggestion.';
    return;
  }

  var btn = document.getElementById('feedback-submit-btn');
  btn.disabled = true;
  errorEl.textContent = '';

  var payload = {
    feedbackType: document.getElementById('feedback-type').value,
    screenName: document.getElementById('feedback-screen').value,
    severity: document.getElementById('feedback-severity').value,
    issueDescription: description,
    reproductionSteps: document.getElementById('feedback-repro').value.trim(),
    dateSubmitted: new Date().toISOString(),
  };

  try{
    var { error } = await supabaseClient.functions.invoke('submit-feedback', { body: payload });
    if(error){ throw error; }
    document.getElementById('feedback-form-wrap').style.display = 'none';
    document.getElementById('feedback-success-wrap').style.display = 'block';
  }catch(e){
    errorEl.textContent = e.message || 'Could not send feedback — try again.';
  }finally{
    btn.disabled = false;
  }
}
