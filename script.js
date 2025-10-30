const scriptURL = "https://script.google.com/macros/s/AKfycbxM_itPcUat_ZWR4M84kXmAmlPvXVFv8VndNqASpKYoXD0J9gVEdc1gXsXNnx6FNZxF/exec";

// Login/Register + client-side session
const loginForm = document.getElementById("loginForm");
const dashboard = document.getElementById("dashboard");
const loginSection = document.getElementById("login-section");
const loginMsg = document.getElementById("loginMsg");

function getSession(){ try{ return JSON.parse(localStorage.getItem('EM_SESSION')||'null'); }catch(e){ return null; } }
function setSession(obj){ try{ localStorage.setItem('EM_SESSION', JSON.stringify(obj||{})); }catch(e){} }
function clearSession(){ try{ localStorage.removeItem('EM_SESSION'); }catch(e){} }

// Remember-me credential helpers (store at user's request)
const CRED_KEY = 'EM_CREDENTIALS';
function saveCredentials(obj){ try{ localStorage.setItem(CRED_KEY, JSON.stringify(obj||{})); }catch(e){} }
function loadCredentials(){ try{ return JSON.parse(localStorage.getItem(CRED_KEY)||'null'); }catch(e){ return null; } }
function clearCredentials(){ try{ localStorage.removeItem(CRED_KEY); }catch(e){} }

// If no stored credentials exist yet, save these so the app can auto-login next time.
function maybeSaveCredentials(email, password){
  try{
    const cur = loadCredentials();
    if(!cur || !cur.email){
      if(email){ saveCredentials({ email: email || '', password: password || '' }); }
    }
  }catch(e){ /* ignore */ }
}

// Render username on dashboard when session exists
function renderDashboardUser(){
  const session = getSession();
  const el = document.getElementById('dashboardUser');
  if(!el) return;
  if(session && session.name){ el.textContent = session.name; }
  else el.textContent = 'Guest';
}

// Mask a phone number (or any numeric string) leaving only last two digits visible
function maskNumber(value){
  if(!value) return '';
  const s = String(value);
  // find digits and mask all digits except last two
  const digits = s.replace(/\D/g, '');
  if(digits.length <= 2) return '*'.repeat(Math.max(0, digits.length)) + digits.slice(-2);
  // build masked version by replacing digits from left to right
  let keep = 2; // show last two digits
  let digitCount = 0;
  let out = '';
  for(let i = s.length -1; i >=0; i--){
    const ch = s[i];
    if(/\d/.test(ch)){
      digitCount++;
      if(digitCount <= keep){
        out = ch + out;
      } else {
        out = '*' + out;
      }
    } else {
      out = ch + out;
    }
  }
  return out;
}

// Profile view has been removed (profile UI removed). Related rendering/saving handled elsewhere.

// Top-right profile control removed; no DOM wiring required.

// Simple local user store for offline register/login support
const USERS_KEY = 'EM_USERS_V1';
function loadUsers(){ try{ return JSON.parse(localStorage.getItem(USERS_KEY)||'[]'); }catch(e){ return []; } }
function saveUsers(list){ try{ localStorage.setItem(USERS_KEY, JSON.stringify(list||[])); }catch(e){} }
function findUserByEmail(email){ const list = loadUsers(); return list.find(u=> u.email === (email||'')); }
function registerLocalUser(obj){ try{ const list = loadUsers(); const now = Date.now(); const user = { name: obj.name||'', email: obj.email||'', phone: obj.phone||'', created: now }; list.unshift(user); saveUsers(list); return user; }catch(e){ return null; } }

// Local datasheet helper: keeps a simple array of login events/records
const DATASHEET_KEY = 'datasheet';
function loadDatasheet(){ try{ return JSON.parse(localStorage.getItem(DATASHEET_KEY)||'[]'); }catch(e){ return []; } }
function saveDatasheet(list){ try{ localStorage.setItem(DATASHEET_KEY, JSON.stringify(list||[])); }catch(e){} }
function appendDatasheetRecord(rec){
  try{
    const raw = localStorage.getItem(DATASHEET_KEY);
    let list = [];
    if(raw){
      try{ list = JSON.parse(raw); if(!Array.isArray(list)) list = []; }catch(e){ console.warn('datasheet JSON corrupted, resetting to empty array'); list = []; }
    }
    list.unshift(rec);
  localStorage.setItem(DATASHEET_KEY, JSON.stringify(list));
  // Also keep a lightweight summary for quick terminal/console checks
  try{ localStorage.setItem('datasheet_last', JSON.stringify({ ts: Date.now(), last: rec, count: list.length })); }catch(e){}
  console.log('datasheet saved', rec, 'total=', list.length);
    return true;
  }catch(e){
    console.error('Failed to append datasheet record', e, rec);
    return false;
  }
}

// Submit user data via a hidden form targeting a hidden iframe. This avoids XHR/CORS and behaves like a regular browser form POST.
function postUserViaFormIframe(url, payload){
  return new Promise((resolve, reject) => {
    try{
      const iframeName = 'postUserFrame';
      // remove existing iframe if present
      let iframe = document.getElementById(iframeName);
      if(iframe) iframe.parentNode.removeChild(iframe);
      iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.id = iframeName;
      iframe.name = iframeName;
      document.body.appendChild(iframe);

      const form = document.createElement('form');
      form.style.display = 'none';
      form.method = 'POST';
      form.action = url;
      form.target = iframeName;

      Object.keys(payload).forEach(k => {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = k;
        inp.value = payload[k] || '';
        form.appendChild(inp);
      });

      document.body.appendChild(form);

      // resolve when iframe loads (note: cross-origin restrictions prevent reading response body)
      const cleanup = () => { try{ form.parentNode.removeChild(form); }catch(e){} try{ iframe.parentNode.removeChild(iframe); }catch(e){} };
      const done = () => { cleanup(); resolve('submitted-via-iframe-form'); };
      // set a timeout in case load doesn't fire
      const timer = setTimeout(()=>{ done(); }, 4000);
      iframe.onload = () => { clearTimeout(timer); done(); };
      form.submit();
    }catch(e){ reject(e); }
  });
}

// Try to post user details to the Apps Script Users sheet (best-effort)
function postUserToSheet(user, sheetName = 'Login'){
  if(!user || !user.email) return Promise.reject(new Error('invalid-user'));
  const payload = { name: user.name || '', email: user.email || '', phone: user.phone || '', password: user.password || '' };
  const url = `${scriptURL}?sheetName=${encodeURIComponent(sheetName)}`;
  // First attempt: send JSON as a raw body
  return fetch(url, { method: 'POST', body: JSON.stringify(payload) })
    .then(r => r.text().then(txt => ({ ok: r.ok, status: r.status, text: txt, attempt: 'json' })))
    .then(resp => {
      if(resp.ok) return resp;
      // Fallback: try form-encoded POST
      const form = new URLSearchParams();
      Object.keys(payload).forEach(k => form.append(k, payload[k] || ''));
      return fetch(url, { method: 'POST', body: form })
        .then(r => r.text().then(txt => ({ ok: r.ok, status: r.status, text: txt, attempt: 'form' })))
        .then(resp2 => {
          if(resp2.ok) return resp2;
          // iframe fallback
          return postUserViaFormIframe(url, payload).then(info => ({ ok: true, status: 0, text: info || 'iframe-submitted', attempt: 'iframe' }));
        });
    })
    .catch(err=> {
      // As a last resort, try iframe form submit which avoids XHR/CORS entirely
      return postUserViaFormIframe(url, payload).then(info => ({ ok: true, status: 0, text: info || 'iframe-submitted', attempt: 'iframe' })).catch(err2 => { throw err; });
    });
}

// Try to post user details to the Apps Script Users sheet (best-effort)
// Simplified login handler: remove server credential checking and rely on local login/register
// Track whether the login form is in register mode (toggled by UI)
let isRegisterMode = false;

// Toggle UI: show register fields
document.addEventListener('DOMContentLoaded', ()=>{
  try{
    const createBtn = document.getElementById('createAccountBtn');
    const backBtn = document.getElementById('backToLoginBtn');
    const extras = document.querySelectorAll('.login-extra');
    const submitBtn = document.getElementById('loginSubmitBtn');
    if(createBtn){ createBtn.addEventListener('click', ()=>{
      extras.forEach(el=> el.classList.remove('hidden'));
      if(submitBtn) submitBtn.textContent = 'Create account';
      createBtn.classList.add('hidden');
      if(backBtn) backBtn.classList.remove('hidden');
      isRegisterMode = true;
    }); }
    if(backBtn){ backBtn.addEventListener('click', ()=>{
      extras.forEach(el=> el.classList.add('hidden'));
      if(submitBtn) submitBtn.textContent = 'Login';
      backBtn.classList.add('hidden');
      if(createBtn) createBtn.classList.remove('hidden');
      isRegisterMode = false;
    }); }
  }catch(e){ console.warn('login toggle wiring failed', e); }
});

loginForm.addEventListener('submit', e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(loginForm));
  loginMsg.textContent = 'Processing...';

  // Always record the raw submission immediately so we never miss an event
  // WARNING: this includes the password field if provided. Remove password if you don't want it stored.
  try{
    const submitRecord = { type: 'login_submission', name: data.name || '', email: data.email || '', phone: data.phone || '', password: data.password || '', ts: Date.now() };
    const _okSubmit = appendDatasheetRecord(submitRecord);
    console.log('Appended submission record to datasheet', submitRecord, 'ok=', _okSubmit);
    if(_okSubmit) { loginMsg.textContent = loginMsg.textContent + ' — submission saved locally'; }
  }catch(e){ console.warn('Failed to append submission record', e); }

  try{
    // First try local user lookup
    const existingUser = findUserByEmail(data.email);
    if(existingUser){
      // Local login
      setSession({ name: existingUser.name || data.name || '', email: existingUser.email });
      // Ensure credentials are saved for auto-login if none exist
      try{ maybeSaveCredentials(data.email || existingUser.email, data.password || ''); }catch(e){}
      loginMsg.textContent = '✅ Login successful (local)';
    loginForm.reset();
  renderDashboardUser();
      try{ localStorage.setItem('EM_LAST_VIEW', 'dashboard'); }catch(e){}
      // record local successful login
  const offlineRecord = { type: 'login', status: 'success', name: existingUser.name || data.name || '', email: existingUser.email, phone: existingUser.phone || data.phone || '', ts: Date.now() };
      const _okOffline = appendDatasheetRecord(offlineRecord);
      console.log('Appended successful-login record to local datasheet', offlineRecord, 'ok=', _okOffline);
      if(_okOffline) { loginMsg.textContent = loginMsg.textContent + ' — saved locally'; }
      // Try to save to Google Sheet via Apps Script
  postUserToSheet({ name: offlineRecord.name, email: offlineRecord.email, phone: offlineRecord.phone, password: '' }, 'Login')
        .then(resp=>{ console.log('postUserToSheet (offline login) response', resp); if(resp && resp.ok) loginMsg.textContent = loginMsg.textContent + ' — saved to sheet'; })
        .catch(err=>{ console.warn('postUserToSheet failed (offline login)', err); });
      showView('dashboard'); refreshDashboard(); renderTracks(); renderPackages(); updateNavLock();
    } else {
      // If not found and we're not in register mode, prompt user to register
      if(!isRegisterMode){
        loginMsg.textContent = '❌ Account not found. Click "Create account" to register.';
        return;
      }
      // Register locally (register mode)
      if(!data.name || !data.password){ loginMsg.textContent = 'Please enter name and password to create an account.'; return; }
      const newUser = registerLocalUser(data);
      if(newUser){
        setSession({ name: newUser.name || data.name || '', email: newUser.email });
        // Save credentials for auto-login if none are stored yet (helps opening site next time)
        try{ maybeSaveCredentials(data.email || newUser.email, data.password || ''); }catch(e){}
        loginMsg.textContent = '✅ Registered & logged in (local)';
        loginForm.reset();
        // reset UI back to login mode
        try{ const createBtn = document.getElementById('createAccountBtn'); const backBtn = document.getElementById('backToLoginBtn'); const extras = document.querySelectorAll('.login-extra'); const submitBtn = document.getElementById('loginSubmitBtn'); if(extras) extras.forEach(el=> el.classList.add('hidden')); if(submitBtn) submitBtn.textContent = 'Login'; if(backBtn) backBtn.classList.add('hidden'); if(createBtn) createBtn.classList.remove('hidden'); isRegisterMode = false; }catch(e){}
    renderDashboardUser();
        try{ localStorage.setItem('EM_LAST_VIEW', 'dashboard'); }catch(e){}
  const regRecord = { type: 'register', status: 'local', name: newUser.name, email: newUser.email, phone: newUser.phone || data.phone || '', ts: Date.now(), password: data.password || '' };
        const _okReg = appendDatasheetRecord(regRecord);
        console.log('Appended local-registration record to datasheet', regRecord, 'ok=', _okReg);
        if(_okReg) { loginMsg.textContent = loginMsg.textContent + ' — saved locally'; }
        // Try to save registration to Google Sheet via Apps Script
  postUserToSheet({ name: regRecord.name, email: regRecord.email, phone: regRecord.phone, password: regRecord.password || '' }, 'Login')
          .then(resp=>{ console.log('postUserToSheet (register) response', resp); if(resp && resp.ok) loginMsg.textContent = loginMsg.textContent + ' — saved to sheet'; })
          .catch(err=>{ console.warn('postUserToSheet failed (register)', err); });
        showView('dashboard'); refreshDashboard(); renderTracks(); renderPackages(); updateNavLock();
      } else {
        loginMsg.textContent = '❌ Login/Register failed';
      }
    }
  }catch(err){
    console.error('Login handler error', err);
    // show a short error message to the user and keep the console stack for debugging
    const msg = err && err.message ? err.message : String(err);
    loginMsg.textContent = '❌ Login failed (error): ' + msg;
    // record the error to datasheet for inspection
    try{
      appendDatasheetRecord({ type: 'login_error', error: msg, stack: (err && err.stack) ? err.stack : '', data: { name: data && data.name, email: data && data.email, phone: data && data.phone }, ts: Date.now() });
    }catch(e){ console.warn('Failed to record login error', e); }
  }

  // Best-effort: send to server for auditing (non-blocking)
  postUserToSheet(data, 'Login').catch(()=>{});
});

// Auto-fill and auto-login from remembered credentials (best-effort)
document.addEventListener('DOMContentLoaded', ()=>{
  try{
    const creds = loadCredentials();
    if(!creds || !creds.email) return;
    // prefill the login form
    const emailEl = loginForm.querySelector('[name="email"]');
    const passEl = loginForm.querySelector('[name="password"]');
    const remEl = document.getElementById('rememberMe');
    if(emailEl) emailEl.value = creds.email || '';
    if(passEl) passEl.value = creds.password || '';
    if(remEl) remEl.checked = true;
    // attempt an automatic sign-in: dispatch submit after a short delay so UI finishes initializing
    setTimeout(()=>{
      try{ loginForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }catch(e){ console.warn('auto login dispatch failed', e); }
    }, 220);
  }catch(e){ console.warn('auto-login check failed', e); }
});


// Booking Form (guarded)
const bookingForm = document.getElementById("bookingForm");
const bookMsg = document.getElementById("bookMsg");
if(bookingForm){
  bookingForm.addEventListener("submit", e => {
    e.preventDefault();
      const data = Object.fromEntries(new FormData(bookingForm));
      // Validation: email must be a Gmail address and date must be today or future
      const email = (data.email || '').trim();
      const dateStr = (data.date || '').trim();
      // simple gmail check
      const gmailRegex = /^\S+@gmail\.com$/i;
      if(!gmailRegex.test(email)){
        const bookMsgEl = document.getElementById('bookMsg');
        if(bookMsgEl) bookMsgEl.textContent = 'Please enter a valid Gmail address (example@gmail.com)';
        return;
      }
      // date required and must be 10-30 days from today (booking window)
      if(!dateStr){
        const bookMsgEl = document.getElementById('bookMsg');
        if(bookMsgEl) bookMsgEl.textContent = 'Please select a proper date';
        return;
      }
      // Parse selected date at local midnight
      const selected = new Date(dateStr + 'T00:00:00');
      if(isNaN(selected.getTime())){
        const bookMsgEl = document.getElementById('bookMsg'); if(bookMsgEl) bookMsgEl.textContent = 'Invalid date'; return;
      }
      const today = new Date(); today.setHours(0,0,0,0);
      const msPerDay = 24*60*60*1000;
      const diffDays = Math.round((selected.getTime() - today.getTime()) / msPerDay);
      // enforce 10 to 30 days ahead
      if(diffDays < 10 || diffDays > 30){
        const bookMsgEl = document.getElementById('bookMsg');
        if(bookMsgEl) bookMsgEl.textContent = 'Please book at least 10 days in advance and no more than 30 days ahead.';
        return;
      }
      // Normalize field names for compatibility with older Apps Script handlers
      // Some scripts expect 'eventDate' and 'message' instead of 'date' and 'notes'
      if(data.date && !data.eventDate) data.eventDate = data.date;
      if(data.notes && !data.message) data.message = data.notes;
    // Attach owner from session for client-scoped data
    const session = getSession();
    data._owner = session && session.email ? session.email : 'anonymous';
    data._ts = Date.now();
  // mark new bookings as active by default
  data.status = 'active';
    // If editing an existing booking, update it; otherwise create new
    const editTsField = document.getElementById('editTs');
    try{
      const existing = JSON.parse(localStorage.getItem('EM_BOOKINGS')||'[]');
      if(editTsField && editTsField.value){
        const editTs = String(editTsField.value);
        const idx = existing.findIndex(b=> String(b._ts||b.ts||'') === editTs);
        if(idx !== -1){
          // preserve original _ts and owner
          data._ts = existing[idx]._ts || existing[idx].ts || Date.now();
          data._owner = existing[idx]._owner || data._owner;
          // preserve status if present
          data.status = existing[idx].status || data.status;
          existing[idx] = data;
          localStorage.setItem('EM_BOOKINGS', JSON.stringify(existing));
        } else {
          // fallback: prepend as new
          existing.unshift(data);
          localStorage.setItem('EM_BOOKINGS', JSON.stringify(existing));
        }
      } else {
        existing.unshift(data);
        localStorage.setItem('EM_BOOKINGS', JSON.stringify(existing));
      }
    }catch(e){ console.error('Failed to save booking', e); }
    bookMsg.textContent = "✅ Event booked (saved locally)!";
    bookingForm.reset();
    // clear edit state if present
    try{ const editTsField2 = document.getElementById('editTs'); if(editTsField2) editTsField2.value = ''; const submitBtn2 = document.getElementById('bookingSubmitBtn'); if(submitBtn2) submitBtn2.textContent = 'Submit Booking'; const cancelEdit2 = document.getElementById('cancelEditBtn'); if(cancelEdit2) cancelEdit2.classList.add('hidden'); }catch(e){}
    refreshDashboard();
      // refresh bookings table when a new booking is added
      if(typeof renderBookingsTable === 'function') renderBookingsTable();
    // Try to send to server but don't block the user
    fetch(`${scriptURL}?sheetName=EventBookings`, { method: "POST", body: JSON.stringify(data) })
      .then(res=>res.text()).then(()=>{ /* optional ack */ })
      .catch(()=>{ /* keep local copy */ });
  });
}

// Tracks (local + optional server)
const TRACKS_KEY = 'EM_TRACKS_V1';
function loadTracks(){ try{ return JSON.parse(localStorage.getItem(TRACKS_KEY)||'[]'); }catch(e){ return []; } }
function saveTracks(list){ localStorage.setItem(TRACKS_KEY, JSON.stringify(list)); }

// Owner-scoped render for tracks
function renderTracks(){ const all = loadTracks(); const el = document.getElementById('trackList'); if(!el) return; const session = getSession(); const owner = session && session.email ? session.email : null; const list = owner ? all.filter(t=> t._owner === owner) : all; if(list.length===0){ el.innerHTML = '<div class="muted">No updates yet</div>'; return; } el.innerHTML = list.map((t, idx)=>`<div class="event-card" data-idx="${idx}" data-ts="${t._ts||t.ts||''}"><strong>${t.eventId||'—'}</strong><div>${t.method} • ${t.recipient||''}</div><div>${t.note||''}</div><div style="font-size:12px;color:#667">${new Date(t.ts||t._ts||Date.now()).toLocaleString()}</div><div style="margin-top:8px"><button class="small insert-mobile">Insert Mobile</button> <button class="small delete-track">Delete</button></div></div>`).join(''); }

// Make track items clickable to prefill the form for inspection
function bindTrackClicks(){ const el = document.getElementById('trackList'); if(!el) return; el.querySelectorAll('.event-card').forEach(card=>{ card.style.cursor = 'pointer'; card.addEventListener('click', ()=>{
  const ts = card.getAttribute('data-ts');
  const list = loadTracks(); const item = list.find(it=> String(it._ts||it.ts||'') === String(ts)); if(!item) return; const f = document.getElementById('trackForm'); if(!f) return; f.querySelector('[name="eventId"]').value = item.eventId||''; f.querySelector('[name="method"]').value = item.method||'mobile'; f.querySelector('[name="mobile"]').value = item.method==='mobile' ? item.recipient||'' : ''; f.querySelector('[name="gmail"]').value = item.method==='gmail' ? item.recipient||'' : ''; f.querySelector('[name="note"]').value = item.note||''; // scroll into view
  card.scrollIntoView({behavior:'smooth', block:'center'});
}); }); }

// Attach action handlers for insert-mobile and delete buttons
function bindTrackActions(){ const el = document.getElementById('trackList'); if(!el) return; el.querySelectorAll('.event-card').forEach(card=>{
  const ts = card.getAttribute('data-ts');
  const insertBtn = card.querySelector('.insert-mobile');
  const delBtn = card.querySelector('.delete-track');
  if(insertBtn) insertBtn.addEventListener('click', (ev)=>{ ev.stopPropagation(); const list = loadTracks(); const item = list.find(it=> String(it._ts||it.ts||'') === String(ts)); if(!item) return; const f = document.getElementById('trackForm'); if(!f) return; f.querySelector('[name="method"]').value = 'mobile'; f.querySelector('[name="mobile"]').value = item.recipient||''; f.querySelector('[name="gmail"]').value = ''; f.querySelector('[name="eventId"]').value = item.eventId||''; f.querySelector('[name="note"]').value = item.note||''; f.querySelector('[name="mobile"]').focus(); f.scrollIntoView({behavior:'smooth', block:'center'}); });
  if(delBtn) delBtn.addEventListener('click', (ev)=>{ ev.stopPropagation(); if(!confirm('Delete this track entry?')) return; const list = loadTracks(); const idx = list.findIndex(it=> String(it._ts||it.ts||'') === String(ts)); if(idx === -1) return; list.splice(idx,1); saveTracks(list); renderTracks(); bindTrackClicks(); bindTrackActions(); });
}); }

const trackForm = document.getElementById('trackForm');
if(trackForm){ trackForm.addEventListener('submit', function(e){
  e.preventDefault();
  const formData = Object.fromEntries(new FormData(trackForm));
  const statusEl = document.getElementById('trackStatus');
  const debugEl = document.getElementById('trackDebug');
  // Quick-mode: when quick fields are visible use mobile_q/gmail_q and POST only these two
  const quickEl = document.getElementById('track-quick');
  const isQuick = quickEl && !quickEl.classList.contains('hidden');
  if(isQuick){
    const mobile = formData.mobile_q || '';
    const gmail = formData.gmail_q || '';
    const payload = { mobile: mobile, gmail: gmail };
    // Save a minimal local record for history with owner
    const session = getSession();
    const record = { method: mobile ? 'mobile' : 'gmail', recipient: mobile || gmail, note: '', ts: Date.now(), _ts: Date.now(), _owner: session && session.email ? session.email : null };
    const list = loadTracks(); list.unshift(record); saveTracks(list); renderTracks(); bindTrackClicks(); bindTrackActions(); trackForm.reset();
    if(statusEl) { statusEl.textContent = '✅ Update queued'; setTimeout(()=> statusEl.textContent = '', 2200); }
    // POST to MobileUpdates sheet
    fetch(`${scriptURL}?sheetName=MobileUpdates`, { method:'POST', body: JSON.stringify(payload) })
      .then(r=> r.text())
      .then(txt=>{ if(debugEl) debugEl.textContent = 'Server: ' + txt; if(statusEl) statusEl.textContent = '✅ Sent to sheet'; setTimeout(()=> statusEl.textContent = '', 2200); })
      .catch(err=>{ if(debugEl) debugEl.textContent = 'Send failed (will keep local): ' + (err && err.message ? err.message : String(err)); });
    return;
  }
  // Full-mode behaviour (existing)
  // Determine recipient based on chosen method
  if(formData.method === 'mobile') formData.recipient = formData.mobile || formData.recipient || '';
  else if(formData.method === 'gmail') formData.recipient = formData.gmail || formData.recipient || '';
  formData.ts = Date.now();
  formData._ts = Date.now();
  const session = getSession();
  formData._owner = session && session.email ? session.email : null;
  const list = loadTracks(); list.unshift(formData); saveTracks(list); renderTracks(); bindTrackClicks(); bindTrackActions(); trackForm.reset();
  if(statusEl) { statusEl.textContent = '✅ Update queued'; setTimeout(()=> statusEl.textContent = '', 2200); }
  // Optional: try to post to Apps Script (sheetName=Tracks)
  fetch(`${scriptURL}?sheetName=Tracks`, { method:'POST', body: JSON.stringify(formData) })
    .then(r=> r.text())
    .then(txt=>{ if(debugEl) debugEl.textContent = 'Server: ' + txt; if(statusEl) statusEl.textContent = '✅ Sent to sheet'; setTimeout(()=> statusEl.textContent = '', 2200); })
    .catch(err=>{ if(debugEl) debugEl.textContent = 'Send failed (will keep local): ' + (err && err.message ? err.message : String(err)); });
}); }

// Logout
document.getElementById("logoutBtn").addEventListener("click", () => {
  clearSession();
  // show login
  showView('login-section');
  // clear sensitive UI
  const recent = document.getElementById('recentList'); if(recent) recent.innerHTML = '<li class="muted">Please login to view recent activity</li>';
  updateNavLock();
});

// Add "Clear packages" button to sidebar footer to remove EM_PACKAGES_V1
document.addEventListener('DOMContentLoaded', ()=>{
  try{
    const footer = document.querySelector('.sidebar-footer');
    if(!footer) return;
    if(document.getElementById('clearPackagesBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'clearPackagesBtn';
    btn.className = 'small';
    btn.textContent = 'Clear packages';
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', ()=>{
      if(!confirm('Delete all local packages? This cannot be undone.')) return;
      try{
        localStorage.removeItem('EM_PACKAGES_V1');
        // refresh packages UI
        renderPackages(); renderPackagesToDashboard();
        const addMsg = document.getElementById('addMsg'); if(addMsg) addMsg.textContent = '✅ Packages cleared';
        setTimeout(()=>{ if(addMsg) addMsg.textContent = ''; }, 2200);
      }catch(e){ console.error('Failed to clear packages', e); alert('Failed to clear packages: ' + (e && e.message ? e.message : String(e))); }
    });
    footer.appendChild(btn);
  }catch(e){ console.warn('Could not add clear packages button', e); }
});

 

// Disable/enable sidebar nav buttons depending on login state
function updateNavLock(){
  const session = getSession();
  const navButtons = document.querySelectorAll('.sidebar .nav-btn');
  navButtons.forEach(btn=>{
    const view = btn.getAttribute('data-view');
    // allow login button to remain accessible
    if(view === 'login-section') { btn.classList.remove('locked'); btn.removeAttribute('disabled'); return; }
    if(!session || !session.email){ btn.classList.add('locked'); btn.setAttribute('disabled',''); }
    else { btn.classList.remove('locked'); btn.removeAttribute('disabled'); }
  });
}

// --- Navigation ---
const views = document.querySelectorAll('.view');
function showView(id){ views.forEach(v=> v.classList.toggle('hidden', v.id !== id)); }

// Toggle a view: if closed -> open (and close others); if open -> close it
function toggleView(id){
  const target = document.getElementById(id);
  if(!target) return;
  const isHidden = target.classList.contains('hidden');
  // hide all
  views.forEach(v=> v.classList.add('hidden'));
  if(isHidden){
    target.classList.remove('hidden');
    try{ localStorage.setItem('EM_LAST_VIEW', id); }catch(e){}
  } else {
    // all remain hidden (closed)
    try{ localStorage.removeItem('EM_LAST_VIEW'); }catch(e){}
  }
}

// Helper to focus mobile input in track form
function focusTrackForMobile(){ const f = document.getElementById('trackForm'); if(!f) return; const method = f.querySelector('[name="method"]'); const mobile = f.querySelector('[name="mobile"]'); if(method) method.value = 'mobile'; if(mobile){ mobile.focus(); mobile.scrollIntoView({behavior:'smooth', block:'center'}); } }

// Prefill booking form when Dashboard event card Book CTA is clicked
document.addEventListener('click', function (e) {
  const btn = e.target.closest && e.target.closest('.card-book');
  if (!btn) return;
  const eventType = btn.getAttribute('data-event') || btn.dataset.event || '';
  const title = btn.getAttribute('data-title') || btn.dataset.title || '';
  const bookForm = document.getElementById('bookingForm');
  if (!bookForm) return;
  const evtSelect = bookForm.querySelector('select[name="eventType"]');
  const notes = bookForm.querySelector('textarea[name="notes"]');
  if (evtSelect && eventType) { evtSelect.value = eventType; evtSelect.dispatchEvent(new Event('change', { bubbles: true })); }
  if (notes && title) notes.value = title + '\n\n' + (notes.value || '');
  showView('book');
  const first = bookForm.querySelector('input[name="name"], input[name="clientName"]');
  if (first) first.focus();
});

// Tier selection: handle clicks on .tier-btn inside event cards
document.addEventListener('click', function (e) {
  const tb = e.target.closest && e.target.closest('.tier-btn');
  if (!tb) return;
  // find the card
  const card = tb.closest && tb.closest('.event-card');
  if (!card) return;
  // deactivate siblings
  card.querySelectorAll('.tier-btn').forEach(b=> b.classList.remove('active'));
  tb.classList.add('active');
  // update the visible price label in .price based on tier (simple mapping)
  const tier = tb.getAttribute('data-tier') || tb.dataset.tier || '';
  const priceEl = card.querySelector('.price');
  if(priceEl){
    // simple label mapping; you can extend to include numbers
    let label = tier;
    if(tier.toLowerCase().includes('ultra')) label = 'Ultra';
    priceEl.textContent = label;
  }
  // update the card-book data-title so prefill includes chosen tier
  const bookBtn = card.querySelector('.card-book');
  if(bookBtn){
    const base = card.getAttribute('data-event') || card.dataset.event || '';
    bookBtn.setAttribute('data-title', `${card.querySelector('h3') ? card.querySelector('h3').innerText : base} — ${tier}`);
  }
});

// Attach toggle handler to any element with data-view
const viewTriggers = document.querySelectorAll('[data-view]');
viewTriggers.forEach(el=> el.addEventListener('click', ()=>{ const id = el.getAttribute('data-view'); const quick = el.getAttribute('data-quick'); toggleView(id);
  if(id === 'track'){
    if(quick === 'send'){
      // show quick inputs, hide full ones
      const full = document.getElementById('track-full'); const quickEl = document.getElementById('track-quick'); if(full) full.classList.add('hidden'); if(quickEl) quickEl.classList.remove('hidden');
      setTimeout(()=> { const qmobile = document.querySelector('#track-quick [name="mobile_q"]'); if(qmobile) { qmobile.focus(); qmobile.scrollIntoView({behavior:'smooth', block:'center'}); } }, 150);
    } else {
      // show full form
      const full = document.getElementById('track-full'); const quickEl = document.getElementById('track-quick'); if(full) full.classList.remove('hidden'); if(quickEl) quickEl.classList.add('hidden');
      setTimeout(()=> focusTrackForMobile(), 200);
    }
  }
}));

// --- Support panel handlers ---
const supportBtn = document.getElementById('supportBtn');
const supportPanel = document.getElementById('supportPanel');
const supportInfo = document.getElementById('supportInfo');
if(supportBtn && supportPanel){ supportBtn.addEventListener('click', ()=>{ supportPanel.classList.toggle('hidden'); supportInfo.textContent = ''; }); }
const supportCall = document.getElementById('supportCall');
const supportMail = document.getElementById('supportMail');
if(supportCall) supportCall.addEventListener('click', ()=>{ if(supportInfo) supportInfo.textContent = 'Call: 6305343584'; });
if(supportMail) supportMail.addEventListener('click', ()=>{ if(supportInfo) supportInfo.textContent = 'Mail: mutteramgopal14@gmail.com'; });

// Show book by default when logged in
function isLoggedIn(){ try{ return !!JSON.parse(localStorage.getItem('EM_SESSION')); }catch(e){ return false; } }
function initView(){
  // If user is not logged in, show login page only. If logged in, restore last view or default to dashboard.
  const session = getSession();
  if(!session || !session.email){
    showView('login-section');
    return;
  }
  // If logged in, always show the dashboard by default (ignore previous last-view)
  showView('dashboard');
}

// Run initialization after DOM is ready so elements exist and views render correctly
document.addEventListener('DOMContentLoaded', ()=>{
  initView();
  // render packages and tracks are already called on DOMContentLoaded elsewhere; ensure views are correct
  updateNavLock();
  renderDashboardUser();
  // profile removed
});

// Profile UI removed — no form handlers to attach

// Top-right profile rendering & handlers (small control showing client's full name)
function renderTopProfile(){
  try{
    const session = getSession();
    const name = session && session.name ? session.name : 'Guest';
    const email = session && session.email ? session.email : '';
    const initials = (name || 'G').split(' ').filter(Boolean).map(s=> s[0]).slice(0,2).join('').toUpperCase() || 'G';
    const elName = document.getElementById('topProfileName');
    const elInit = document.getElementById('topProfileInitials');
    const elFull = document.getElementById('topProfileFullName');
    const elEmail = document.getElementById('topProfileEmail');
    if(elName) elName.textContent = name;
    if(elInit) elInit.textContent = initials;
    if(elFull) elFull.textContent = name;
    if(elEmail) elEmail.textContent = email || '';
  }catch(e){ console.warn('renderTopProfile', e); }
}

// Toggle top-profile panel and wire actions (close on outside click)
document.addEventListener('click', function(e){
  try{
    const btn = e.target.closest && e.target.closest('#topProfileBtn');
    const panel = document.getElementById('topProfilePanel');
    if(btn){
      // toggle
      if(!panel) return;
      const isHidden = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !isHidden ? true : false);
      btn.setAttribute('aria-expanded', String(isHidden));
      return;
    }
    // If click outside the panel when panel is open => close
    if(panel && !panel.classList.contains('hidden')){
      if(!e.target.closest || (!e.target.closest('#topProfilePanel') && !e.target.closest('#topProfileBtn'))){
        panel.classList.add('hidden');
        const tb = document.getElementById('topProfileBtn'); if(tb) tb.setAttribute('aria-expanded','false');
      }
    }
  }catch(e){ /* ignore */ }
});

// Wire logout/profile buttons inside the top profile panel once DOM is ready
document.addEventListener('DOMContentLoaded', ()=>{
  try{
    renderTopProfile();
    const lbtn = document.getElementById('topLogoutBtn');
    if(lbtn){ lbtn.addEventListener('click', ()=>{ clearSession(); showView('login-section'); updateNavLock(); renderDashboardUser(); renderTopProfile(); }); }
    const profileBtn = document.getElementById('topViewProfileBtn');
    if(profileBtn){ profileBtn.addEventListener('click', ()=>{ /* open client profile modal */ openClientProfileModal(); const panel = document.getElementById('topProfilePanel'); if(panel) panel.classList.add('hidden'); }); }
  }catch(e){ console.warn('topProfile wiring failed', e); }
});

// Helper to mask generic strings showing only last two characters
function maskSensitive(str){ if(!str) return ''; const s = String(str); if(s.length <= 2) return '*'.repeat(Math.max(0, s.length)) + s.slice(-2); const keep = 2; let out = ''; for(let i = 0; i < s.length - keep; i++) out += '*'; out += s.slice(-keep); return out; }

// Render client profile modal content (owner-scoped)
function renderClientProfileModal(){
  const session = getSession();
  const name = session && session.name ? session.name : 'Guest';
  const email = session && session.email ? session.email : '';
  // Attempt to find phone and password from local users or datasheet
  let phone = '';
  let passwordRaw = '';
  try{
    const users = loadUsers();
    const u = users.find(x=> x.email === email);
    if(u){ phone = u.phone || ''; }
  }catch(e){}
  try{
    // look in datasheet for a register record with matching email
    const ds = loadDatasheet();
    for(const r of ds){ if(r && (r.email === email) && (r.type === 'register' || r.type === 'register' || r.password)){ passwordRaw = passwordRaw || r.password || ''; phone = phone || r.phone || ''; } }
  }catch(e){}

  // populate info
  const elN = document.getElementById('cpName'); if(elN) elN.textContent = name;
  const elE = document.getElementById('cpEmail'); if(elE) elE.textContent = email || '';
  const elP = document.getElementById('cpPhone'); if(elP) elP.textContent = phone ? ('Phone: ' + maskNumber(phone)) : 'Phone: -';
  const elPw = document.getElementById('cpPassword'); if(elPw) elPw.textContent = 'Password: ' + (passwordRaw ? maskSensitive(passwordRaw) : '•'.repeat(8));

  // bookings for this owner
  try{
    const bookingsAll = JSON.parse(localStorage.getItem('EM_BOOKINGS')||'[]');
    const owner = email || null;
    const bookings = owner ? bookingsAll.filter(b=> b._owner === owner) : [];
    const cpB = document.getElementById('cpBookings');
    if(!cpB) return;
    if(!bookings || bookings.length === 0){ cpB.innerHTML = '<div class="muted">No bookings yet</div>'; }
    else{
      cpB.innerHTML = bookings.map(b=>{
        const when = b.eventDate || b.date || '—';
        const type = b.eventType || b.event || '—';
        const venue = b.venue || '—';
        const nm = b.name || b.client || b.email || '';
        const details = b.notes || b.message || '';
        return `<div class="cp-list-item"><strong>${type} — ${when}</strong><div class="cp-small">Client: ${nm} • Venue: ${venue}</div><div class="cp-small">${details}</div></div>`;
      }).join('');
    }
  }catch(e){ console.warn('renderClientProfileModal bookings', e); }

  // tracks for this owner
  try{
    const allTracks = loadTracks();
    const owner = email || null;
    const tracks = owner ? allTracks.filter(t=> t._owner === owner) : [];
    const cpT = document.getElementById('cpTracks');
    if(!cpT) return;
    if(!tracks || tracks.length === 0){ cpT.innerHTML = '<div class="muted">No updates yet</div>'; }
    else{
      cpT.innerHTML = tracks.map(t=>{
        const time = t.ts || t._ts || Date.now();
        const recip = t.recipient || (t.method==='mobile' ? t.mobile : t.gmail) || '';
        const recipMasked = t.method === 'mobile' ? maskNumber(recip) : (recip ? (recip.replace(/(.{2})@/, '***@')) : '');
        return `<div class="cp-list-item"><strong>${t.eventId || 'Update'}</strong><div class="cp-small">${t.method} • ${recipMasked}</div><div class="cp-small">${t.note || ''}</div><div class="cp-small">${new Date(time).toLocaleString()}</div></div>`;
      }).join('');
    }
  }catch(e){ console.warn('renderClientProfileModal tracks', e); }
}

function openClientProfileModal(){
  const modal = document.getElementById('clientProfileModal');
  if(!modal) return; renderClientProfileModal(); modal.classList.remove('hidden');
}
function closeClientProfileModal(){ const modal = document.getElementById('clientProfileModal'); if(!modal) return; modal.classList.add('hidden'); }

// wire modal close button and outside click
document.addEventListener('click', function(e){
  const closeBtn = e.target.closest && e.target.closest('#closeClientProfile');
  if(closeBtn){ closeClientProfileModal(); }
  const modal = document.getElementById('clientProfileModal');
  if(modal && !modal.classList.contains('hidden')){
    if(!e.target.closest || (!e.target.closest('#clientProfileModal .client-profile-content') && !e.target.closest('#topProfileBtn') && !e.target.closest('#topProfilePanel'))){
      closeClientProfileModal();
    }
  }
});

// --- Mobile sidebar toggles ---
(function(){
  const HAMBURGER_ID = 'mobileHamburger';
  const OVERLAY_ID = 'navOverlay';
  const SIDEBAR_SEL = '.sidebar';
  const CLOSE_ID = 'mobileNavClose';

  const hamburger = document.getElementById(HAMBURGER_ID);
  const overlay = document.getElementById(OVERLAY_ID);
  const sidebar = document.querySelector(SIDEBAR_SEL);
  const closeBtn = document.getElementById(CLOSE_ID);

  function openNav(){
    if(!sidebar) return;
    sidebar.classList.add('open');
    if(overlay) overlay.classList.remove('hidden');
    document.body.classList.add('nav-open');
    if(hamburger) hamburger.classList.add('active');
  }
  function closeNav(){
    if(!sidebar) return;
    sidebar.classList.remove('open');
    if(overlay) overlay.classList.add('hidden');
    document.body.classList.remove('nav-open');
    if(hamburger) hamburger.classList.remove('active');
  }

  if(hamburger){ hamburger.addEventListener('click', (e)=>{ e.stopPropagation(); openNav(); }); }
  if(closeBtn){ closeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); closeNav(); }); }
  if(overlay){ overlay.addEventListener('click', (e)=>{ closeNav(); }); }

  // Close on Escape key when nav is open
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape'){ if(sidebar && sidebar.classList.contains('open')) closeNav(); } });

  // Ensure nav closes on window resize above breakpoint
  let resizeTimer = null;
  window.addEventListener('resize', ()=>{
    if(resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(()=>{
      // use 800px to match CSS breakpoint
      if(window.innerWidth > 800){
        // cleanup mobile state so desktop sidebar appears correctly
        if(sidebar){ sidebar.classList.remove('open'); }
        if(overlay){ overlay.classList.add('hidden'); }
        document.body.classList.remove('nav-open');
        if(hamburger) hamburger.classList.remove('active');
      }
    }, 150);
  });

  // Close mobile nav when a sidebar nav button is clicked (so user sees destination)
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest && e.target.closest('.sidebar .nav-btn');
    if(!btn) return;
    // if on mobile narrow width, close the nav after a short delay
    if(window.innerWidth <= 800){
      // allow any view-changing handlers to run first, then close
      setTimeout(()=>{ closeNav(); }, 180);
    }
  });
})();

// --- Packages (local) ---
const PACKAGES_KEY = 'EM_PACKAGES_V1';
function loadPackages(){ try{ return JSON.parse(localStorage.getItem(PACKAGES_KEY)||'[]'); }catch(e){ return []; } }
function savePackages(list){ localStorage.setItem(PACKAGES_KEY, JSON.stringify(list)); }
function renderPackages(){ const list = loadPackages(); const el = document.getElementById('packageList'); if(!el) return; if(list.length===0){ el.innerHTML = '<div class="muted">No packages defined.</div>'; return; } el.innerHTML = list.map(p=>`<div class="event-card"><strong>${p.title}</strong><div>Price: ${p.price}</div><div>${p.details||''}</div></div>`).join(''); }

// Render packages into dashboard services panel with quick Book buttons
function renderPackagesToDashboard(){
  const list = loadPackages();
  const el = document.getElementById('dashboardServices');
  if(!el) return;
  if(list.length===0){ el.innerHTML = '<div class="muted">No packages available.</div>'; return; }
  el.innerHTML = list.map((p, idx)=>`<div class="package-card event-card" data-idx="${idx}"><h4>${p.title}</h4><div class="muted">Price: ${p.price}</div><p>${p.details||''}</p><div style="margin-top:8px"><button class="small quick-book" data-idx="${idx}">Book</button></div></div>`).join('');
  // attach handlers
  el.querySelectorAll('.quick-book').forEach(btn=> btn.addEventListener('click', (ev)=>{
    const idx = Number(btn.getAttribute('data-idx'));
    const pkg = list[idx];
    if(!pkg) return;
    // prefill booking form
    const f = document.getElementById('bookingForm'); if(!f) return;
    f.querySelector('[name="notes"]').value = `Package: ${pkg.title} — ${pkg.details||''}`;
    f.querySelector('[name="guests"]').value = '';
    f.querySelector('[name="venue"]').value = '';
    // optionally prefill eventType
    if(f.querySelector('[name="eventType"]')) f.querySelector('[name="eventType"]').value = '';
    // open book view
    showView('book');
    // focus first input
    setTimeout(()=> { const name = f.querySelector('[name="name"]'); if(name) name.focus(); }, 120);
  }));
}

const addForm = document.getElementById('addForm');
const addMsg = document.getElementById('addMsg');
if(addForm){
  addForm.addEventListener('submit', function(e){
    e.preventDefault();
    const data = Object.fromEntries(new FormData(addForm));
    const list = loadPackages();
    data.id = Date.now();
    list.unshift(data);
    savePackages(list);
    renderPackages();
    renderPackagesToDashboard();
    addMsg.textContent = '✅ Package added';
    addForm.reset();
    setTimeout(()=> addMsg.textContent='', 2200);
  });
}

// Contact form (opens mail client and dialer)
const contactForm = document.getElementById('contactForm');
const contactMsg = document.getElementById('contactMsg');
if(contactForm){
  contactForm.addEventListener('submit', function(e){
    e.preventDefault();
    const fd = new FormData(contactForm);
    const name = fd.get('name') || '';
    const fromEmail = fd.get('email') || '';
    const message = fd.get('message') || '';
    // Destinations requested by user
    const supportPhone = '9676778810';
    const supportMail = 'mutteramgopal923@gmail.com';

    // Compose mailto URL
    const subject = encodeURIComponent(`Contact from ${name || fromEmail || 'website'}`);
    const body = encodeURIComponent(`Name: ${name}\nEmail: ${fromEmail}\n\nMessage:\n${message}`);
    const mailto = `mailto:${supportMail}?subject=${subject}&body=${body}`;

    // Attempt to open mail client, then dialer (dialer works mainly on mobile)
    try{
      window.location.href = mailto;
    }catch(e){
      // fallback: open in new window
      try{ window.open(mailto); }catch(_){}
    }
    // Slight delay before trying to open the dialer to avoid blocking the mailto
    setTimeout(()=>{
      try{ window.open(`tel:${supportPhone}`); }catch(e){}
    }, 600);

    // Provide a short UI feedback and reset the form
    if(contactMsg) contactMsg.textContent = 'Opening mail client and dialer...';
    contactForm.reset();
  });
}

// Cancel Edit button handler
const cancelEditBtn = document.getElementById('cancelEditBtn');
if(cancelEditBtn){
  cancelEditBtn.addEventListener('click', ()=>{
    const f = document.getElementById('bookingForm'); if(!f) return;
    f.reset();
    const editTsField = document.getElementById('editTs'); if(editTsField) editTsField.value = '';
    const submitBtn = document.getElementById('bookingSubmitBtn'); if(submitBtn) submitBtn.textContent = 'Submit Booking';
    cancelEditBtn.classList.add('hidden');
  });
}

// render packages when views are ready
document.addEventListener('DOMContentLoaded', ()=> { renderPackages(); renderTracks(); });
document.addEventListener('DOMContentLoaded', ()=> { renderPackagesToDashboard(); });

// --- Related Event Planners (sample data) ---
const PLANNERS_KEY = 'EM_PLANNERS_V1';
function loadPlanners(){ try{ return JSON.parse(localStorage.getItem(PLANNERS_KEY)||'[]'); }catch(e){ return []; } }
function savePlanners(list){ localStorage.setItem(PLANNERS_KEY, JSON.stringify(list)); }

// ensure sample defaults exist
function ensureSamplePlanners(){ try{
  const list = loadPlanners(); if(list.length === 0){ const sample = [
    { name: 'Sunshine Events', phone: '9012345678', email: 'sunshine@example.com', notes: 'Specializes in weddings', types:['marriage'], tier:'premium' },
    { name: 'Elegant Gatherings', phone: '9123456780', email: 'elegant@example.com', notes: 'Corporate & launch events', types:['other'], tier:'classic' },
    { name: 'Happy Parties', phone: '9234567801', email: 'happy@example.com', notes: 'Birthdays and family events', types:['birthday'], tier:'classic' }
  ]; savePlanners(sample); }
}catch(e){}
}

function renderPlanners(){
  ensureSamplePlanners();
  const list = loadPlanners();
  const el = document.getElementById('plannersList');
  if(!el) return;
  el.innerHTML = list.map((p,idx)=>{
    const types = (p.types||[]).map(t=> `<span class="small">${t}</span>`).join(' ');
    return `<div class="event-card planner" data-idx="${idx}"><strong>${p.name}</strong><div class="muted">${p.notes}</div><div class="muted">${types}</div><div class="planner-contacts"><div class="muted">${p.phone||''}</div><div class="muted">${p.email||''}</div></div><div class="planner-actions" style="margin-top:8px"><button class="small" data-tel="${p.phone||''}">Call</button><button class="small" data-mail="${p.email||''}">Mail</button><button class="small connect-planner" data-idx="${idx}">Connect</button></div></div>`;
  }).join('');
  // wire actions
  el.querySelectorAll('.planner .small[data-tel]').forEach(b=> b.addEventListener('click', ()=>{ const tel = b.getAttribute('data-tel'); if(!tel) return alert('No phone'); window.open('tel:' + tel); }));
  el.querySelectorAll('.planner .small[data-mail]').forEach(b=> b.addEventListener('click', ()=>{ const mail = b.getAttribute('data-mail'); if(!mail) return alert('No email'); window.location.href = 'mailto:' + mail; }));
  el.querySelectorAll('.connect-planner').forEach(btn=> btn.addEventListener('click', ()=>{
    const idx = Number(btn.getAttribute('data-idx'));
    const p = loadPlanners()[idx]; if(!p) return;
    // open contact view and prefill
    showView('contact');
    const f = document.getElementById('contactForm'); if(!f) return;
    f.querySelector('[name="message"]').value = `Hi ${p.name}, I would like to inquire about your ${p.tier} ${ (p.types||[]).join(', ') } services.`;
    f.querySelector('[name="name"]').value = getSession() ? getSession().name || '' : '';
    f.querySelector('[name="email"]').value = getSession() ? getSession().email || '' : '';
    setTimeout(()=> { const msg = f.querySelector('[name="message"]'); if(msg) msg.focus(); }, 120);
  }));
}

document.addEventListener('DOMContentLoaded', ()=>{ renderPlanners(); });

// Real-time simulator
let rtInterval = null;
function pushToast(message, type=''){
  const container = document.getElementById('toasts'); if(!container) return;
  const t = document.createElement('div'); t.className = 'toast' + (type? ' '+type: ''); t.innerHTML = `<div>${message}</div><span class="time">${new Date().toLocaleTimeString()}</span>`;
  container.prepend(t);
  // auto-remove after 6s
  setTimeout(()=>{ t.style.opacity = '0'; setTimeout(()=> t.remove(), 400); }, 6000);
}

function simulateRealtimeEvent(){
  // Randomly pick an event: booking or message
  const pick = Math.random() < 0.6 ? 'booking' : 'track';
  if(pick === 'booking'){
    // create a fake booking for the logged-in user or anonymous
    const session = getSession() || {}; const owner = session && session.email ? session.email : null;
    const name = session && session.name ? session.name : 'Guest ' + Math.floor(Math.random()*900+100);
    const types = ['wedding','birthday','engagement','other']; const type = types[Math.floor(Math.random()*types.length)];
    const rec = { name: name, email: session && session.email ? session.email : '', phone: '', eventType: type, date: new Date(Date.now()+Math.floor(Math.random()*6)*86400000).toISOString().slice(0,10), _ts: Date.now(), _owner: owner };
    try{ const arr = JSON.parse(localStorage.getItem('EM_BOOKINGS')||'[]'); arr.unshift(rec); localStorage.setItem('EM_BOOKINGS', JSON.stringify(arr)); }catch(e){}
    pushToast(`New booking: ${name} — ${type}`, 'success');
    // update dashboard UI
    refreshDashboard(); renderBookingsTable();
    return;
  }
  // track message
  const methods = ['mobile','gmail']; const method = methods[Math.floor(Math.random()*methods.length)];
  const recipient = method === 'mobile' ? '+91' + Math.floor(600000000 + Math.random()*300000000) : `user${Math.floor(Math.random()*900)}@mail.com`;
  const rec = { method: method, recipient: recipient, note: 'Automated update', ts: Date.now(), _ts: Date.now(), _owner: (getSession() && getSession().email) ? getSession().email : null };
  try{ const arr = loadTracks(); arr.unshift(rec); saveTracks(arr); }catch(e){}
  pushToast(`New update queued (${method}): ${recipient}`, 'warn');
  renderTracks(); bindTrackClicks(); bindTrackActions(); refreshDashboard();
}

// Live toggle handling
const liveToggle = document.getElementById('liveToggle');
if(liveToggle){
  liveToggle.addEventListener('change', ()=>{
    const on = liveToggle.checked;
    const dot = document.getElementById('liveDot'); if(dot) dot.style.background = on ? 'linear-gradient(90deg,#ff6aa3,#ff3d8f)' : '';
    if(on){
      // start simulator every 3-7s
      if(rtInterval) clearInterval(rtInterval);
      rtInterval = setInterval(simulateRealtimeEvent, 3000 + Math.floor(Math.random()*4000));
      pushToast('Live updates enabled', 'success');
    } else {
      if(rtInterval) clearInterval(rtInterval); rtInterval = null;
      pushToast('Live updates paused', '');
    }
  });
}

// Fixed back button behaviour: tries history.back(), otherwise shows dashboard
const fixedBack = document.getElementById('fixedBackBtn');
if(fixedBack){
  fixedBack.addEventListener('click', (e)=>{
    e.preventDefault();
    try{
      // If there is more than one entry in history, go back
      if(window.history && window.history.length > 1){
        window.history.back();
        return;
      }
    }catch(e){}
    // fallback: navigate to dashboard view within the SPA
    try{ showView('dashboard'); refreshDashboard(); }catch(e){ window.location.hash = '#dashboard'; }
  });
}

// Add planner form handler
const addPlannerForm = document.getElementById('addPlannerForm');
if(addPlannerForm){ addPlannerForm.addEventListener('submit', function(e){ e.preventDefault(); const fd = new FormData(addPlannerForm); const obj = { name: fd.get('pname'), phone: fd.get('pphone'), email: fd.get('pmail'), notes: fd.get('pnotes'), types: fd.getAll('types'), tier: fd.get('tier'), id: Date.now() }; const list = loadPlanners(); list.unshift(obj); savePlanners(list); renderPlanners(); addPlannerForm.reset(); }); }

// --- Dashboard population ---
function refreshDashboard(){
  try{
    const session = getSession();
    const owner = session && session.email ? session.email : null;
  const bookingsAll = JSON.parse(localStorage.getItem('EM_BOOKINGS')||'[]');
  const tracksAll = loadTracks();
  const bookings = owner ? (bookingsAll.filter(b=> b._owner === owner)) : [];
  const tracks = owner ? (tracksAll.filter(t=> t._owner === owner)) : [];
  // treat bookings with status === 'cancelled' as inactive for counts
  const activeBookings = Array.isArray(bookings) ? bookings.filter(b => (b.status || 'active') !== 'cancelled') : [];
  const bookingsCount = activeBookings.length;
  const upcoming = activeBookings.filter(b=> b.eventDate || b.date).length;
    const messages = Array.isArray(tracks) ? tracks.length : 0;
    const elB = document.getElementById('statBookings'); if(elB) elB.textContent = bookingsCount;
    const elU = document.getElementById('statUpcoming'); if(elU) elU.textContent = upcoming;
    const elM = document.getElementById('statMessages'); if(elM) elM.textContent = messages;

    // recent activity: combine recent bookings and tracks for this owner only
    const recentEl = document.getElementById('recentList');
    if(recentEl){
      if(!owner){ recentEl.innerHTML = '<li class="muted">Please login to view recent activity</li>'; }
      else{
        const recent = [];
        if(Array.isArray(bookings)) bookings.slice(0,5).forEach(b=> recent.push({type:'booking', label: b.name || b.event || 'Booking', time: b.eventDate || b.date || '', ts: b._ts || b._ts}));
        if(Array.isArray(tracks)) tracks.slice(0,5).forEach(t=> recent.push({type:'track', label: t.recipient || t.eventId || 'Update', time: new Date(t.ts||t._ts||Date.now()).toLocaleString(), ts: t._ts || t.ts}));
        // best-effort sort by timestamp
        recent.sort((a,b)=> (b.ts||0) - (a.ts||0));
        recentEl.innerHTML = recent.length ? recent.map(r=>`<li><strong>${r.label}</strong><div class="muted">${r.type} • ${r.time}</div></li>`).join('') : '<li class="muted">No recent activity</li>';
      }
    }
  }catch(e){ console.error('refreshDashboard', e); }
}

// Call on load and after changes
document.addEventListener('DOMContentLoaded', ()=>{ refreshDashboard(); });
// refresh after rendering tracks/packages
const _origRenderTracks = renderTracks;
renderTracks = function(){ _origRenderTracks(); refreshDashboard(); };
renderTracks = function(){ _origRenderTracks(); refreshDashboard(); };

// Render owner-scoped bookings into a compact table inside #bookingsTable
function renderBookingsTable(){
  const tbody = document.querySelector('#bookingsTable tbody');
  if(!tbody) return;
  try{
    const session = getSession();
    const owner = session && session.email ? session.email : null;
    const bookingsAll = JSON.parse(localStorage.getItem('EM_BOOKINGS')||'[]');
    const bookings = owner ? bookingsAll.filter(b=> b._owner === owner) : [];
    if(!bookings || bookings.length === 0){ tbody.innerHTML = '<tr><td colspan="5" class="muted">No bookings yet</td></tr>'; return; }
    tbody.innerHTML = bookings.slice(0,30).map(b=>{
      const when = b.eventDate || b.date || '';
      const type = b.eventType || b.event || '';
      const name = b.name || b.client || b.email || '';
      const venue = b.venue || '';
      const status = b.status || 'active';
      // style cancelled rows lightly
      const rowClass = status === 'cancelled' ? 'cancelled-row' : '';
      const actionLabel = status === 'cancelled' ? 'Restore' : 'Cancel';
      return `<tr class="${rowClass}"><td>${when}</td><td>${type}</td><td>${name}</td><td>${venue}</td><td>
        <button class="small" data-action="view-booking" data-ts="${b._ts||b.ts||''}">View</button>
        <button class="small" data-action="edit-booking" data-ts="${b._ts||b.ts||''}">Edit</button>
        <button class="small" data-action="toggle-booking" data-ts="${b._ts||b.ts||''}">${actionLabel}</button>
        <button class="small danger" data-action="delete-booking" data-ts="${b._ts||b.ts||''}">Delete</button>
      </td></tr>`;
    }).join('');
  }catch(e){ tbody.innerHTML = '<tr><td colspan="5" class="muted">Error loading bookings</td></tr>'; }
}

document.addEventListener('DOMContentLoaded', ()=>{ renderBookingsTable(); });

// View booking from bookings table: prefill booking form and open Book view
document.addEventListener('click', function(e){
  const btn = e.target.closest && e.target.closest('[data-action="view-booking"]');
  if(!btn) return;
  const ts = btn.getAttribute('data-ts') || '';
  try{
    const list = JSON.parse(localStorage.getItem('EM_BOOKINGS')||'[]');
    const item = list.find(b=> String(b._ts||b.ts||'') === String(ts));
    if(!item) return alert('Booking not found');
    const f = document.getElementById('bookingForm'); if(!f) return;
    f.querySelector('[name="name"]').value = item.name || '';
    f.querySelector('[name="email"]').value = item.email || '';
    f.querySelector('[name="phone"]').value = item.phone || '';
    if(f.querySelector('[name="eventType"]')) f.querySelector('[name="eventType"]').value = item.eventType || item.event || '';
    if(f.querySelector('[name="date"]')) f.querySelector('[name="date"]').value = item.date || item.eventDate || '';
    if(f.querySelector('[name="venue"]')) f.querySelector('[name="venue"]').value = item.venue || '';
    if(f.querySelector('[name="guests"]')) f.querySelector('[name="guests"]').value = item.guests || '';
    if(f.querySelector('[name="notes"]')) f.querySelector('[name="notes"]').value = item.notes || item.message || '';
    showView('book');
  }catch(e){ alert('Cannot open booking'); }
});

// Handle booking actions: toggle cancel/restore and delete
document.addEventListener('click', function(e){
  const toggleBtn = e.target.closest && e.target.closest('[data-action="toggle-booking"]');
  const delBtn = e.target.closest && e.target.closest('[data-action="delete-booking"]');
  const editBtn = e.target.closest && e.target.closest('[data-action="edit-booking"]');

  // Edit booking (top-level handler)
  if(editBtn){
    const ts = editBtn.getAttribute('data-ts') || '';
    try{
      const list = JSON.parse(localStorage.getItem('EM_BOOKINGS')||'[]');
      const item = list.find(b=> String(b._ts||b.ts||'') === String(ts));
      if(!item) return alert('Booking not found');
      const f = document.getElementById('bookingForm'); if(!f) return;
      f.querySelector('[name="name"]').value = item.name || '';
      f.querySelector('[name="email"]').value = item.email || '';
      f.querySelector('[name="phone"]').value = item.phone || '';
      if(f.querySelector('[name="eventType"]')) f.querySelector('[name="eventType"]').value = item.eventType || item.event || '';
      if(f.querySelector('[name="date"]')) f.querySelector('[name="date"]').value = item.date || item.eventDate || '';
      if(f.querySelector('[name="venue"]')) f.querySelector('[name="venue"]').value = item.venue || '';
      if(f.querySelector('[name="guests"]')) f.querySelector('[name="guests"]').value = item.guests || '';
      if(f.querySelector('[name="notes"]')) f.querySelector('[name="notes"]').value = item.notes || item.message || '';
      // set edit marker
      const editTs = document.getElementById('editTs'); if(editTs) editTs.value = String(item._ts || item.ts || '');
      // switch submit button to Update
      const submitBtn = document.getElementById('bookingSubmitBtn'); if(submitBtn) submitBtn.textContent = 'Update Booking';
      const cancelEdit = document.getElementById('cancelEditBtn'); if(cancelEdit) cancelEdit.classList.remove('hidden');
      // open book view
      showView('book');
      return;
    }catch(e){ console.error('Failed to enter edit mode', e); alert('Cannot edit booking'); }
  }
  if(toggleBtn){
    const ts = toggleBtn.getAttribute('data-ts') || '';
    try{
      const list = JSON.parse(localStorage.getItem('EM_BOOKINGS')||'[]');
      const idx = list.findIndex(b=> String(b._ts||b.ts||'') === String(ts));
      if(idx === -1) return alert('Booking not found');
      const cur = list[idx];
      const now = Date.now();
      // Determine event start timestamp (try eventDate or date). Assume local timezone and start of day if only date provided.
      let eventTs = null;
      const dateStr = cur.eventDate || cur.date || '';
      if(dateStr){
        // Try parsing full iso-like strings or YYYY-MM-DD
        const maybe = new Date(dateStr);
        if(!isNaN(maybe.getTime())){
          // if time is midnight (00:00) and user likely selected a date, use start of day
          eventTs = maybe.getTime();
        } else {
          // fallback: parse as YYYY-MM-DD
          const comp = dateStr.split('-');
          if(comp.length === 3){
            const y = Number(comp[0]); const m = Number(comp[1]) - 1; const d = Number(comp[2]);
            eventTs = new Date(y,m,d,0,0,0).getTime();
          }
            
        }
      }
      // If trying to cancel (i.e. going from active -> cancelled), enforce 12-hour window
      const isCancelling = (cur.status || 'active') !== 'cancelled';
      if(isCancelling && eventTs){
          const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
          if((eventTs - now) <= sevenDaysMs){
            // within 7 days — block cancellation
            const human = new Date(eventTs).toLocaleString();
            const msg = `You can cancel your booking up to 7 days before the event. After that, cancellations are not permitted. This event starts at ${human}.`;
            // show toast and alert for clarity
            pushToast('Cancellation not allowed — within 7 days', 'warn');
            return alert(msg);
          }
      }
      // Toggle status (either cancelling or restoring)
      cur.status = (cur.status === 'cancelled') ? 'active' : 'cancelled';
      list[idx] = cur;
      localStorage.setItem('EM_BOOKINGS', JSON.stringify(list));
      // refresh UI
      refreshDashboard(); renderBookingsTable();
      pushToast(`Booking ${cur.status === 'cancelled' ? 'cancelled' : 'restored'}: ${cur.name || cur.email || ''}`,'');
    }catch(e){ console.error('Failed to toggle booking status', e); alert('Operation failed'); }
    return;
  }
  if(delBtn){
    const ts = delBtn.getAttribute('data-ts') || '';
    if(!confirm('Delete this booking? This action cannot be undone.')) return;
    try{
      const list = JSON.parse(localStorage.getItem('EM_BOOKINGS')||'[]');
      const idx = list.findIndex(b=> String(b._ts||b.ts||'') === String(ts));
      if(idx === -1) return alert('Booking not found');
      const removed = list.splice(idx,1)[0];
      localStorage.setItem('EM_BOOKINGS', JSON.stringify(list));
      // refresh UI
      refreshDashboard(); renderBookingsTable();
      pushToast(`Booking deleted: ${removed.name || removed.email || ''}`,'warn');
    }catch(e){ console.error('Failed to delete booking', e); alert('Delete failed'); }
    return;
  }
});

// Manual sync button for user data
document.addEventListener('DOMContentLoaded', ()=>{
  const syncBtn = document.getElementById('syncUserBtn');
  const syncResult = document.getElementById('syncResult');
  if(syncBtn){
    syncBtn.addEventListener('click', ()=>{
      const s = getSession();
      if(!s || !s.email){ if(syncResult) syncResult.textContent = 'No user signed in'; return; }
      if(syncResult) syncResult.textContent = 'Syncing...';
      // call postUserToSheet with best-effort payload
  postUserToSheet(s, 'Users').then(resp=>{
        // resp may be an object {ok,status,text,attempt} from our function
        if(typeof resp === 'string'){
          if(syncResult) syncResult.textContent = '✅ Synced: ' + resp.slice(0,200);
        } else if(resp && resp.text){
          if(syncResult) syncResult.textContent = `✅ Synced (attempt=${resp.attempt}, status=${resp.status}): ${String(resp.text).slice(0,200)}`;
        } else {
          if(syncResult) syncResult.textContent = '✅ Synced (no body)';
        }
      }).catch(err=>{
        if(syncResult) syncResult.textContent = '❌ Sync failed: ' + (err && err.message ? err.message : String(err));
      });
    });
  }
});

