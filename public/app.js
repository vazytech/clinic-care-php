// Clinic Care — screens and interactions. Data access lives in data.js.

const CLINIC_NAME = 'Clinic Care';

const PAGES = {
  dashboard: { label: 'Overview' },
  patients: { label: 'Patients', kicker: 'PATIENT DIRECTORY', sub: 'Every person in your care, in one place.' },
  patient: { label: 'Patient record' },
  appointments: { label: 'Appointments', kicker: 'CLINIC SCHEDULE', sub: 'Book, move and track the day’s appointments.' },
  records: { label: 'Visit notes', kicker: 'CARE DOCUMENTATION', sub: 'Every consultation, linked to the patient’s record.', perm: 'clinical.view' },
  billing: { label: 'Billing', kicker: 'PAYMENTS', sub: 'Invoices, payments and what’s still outstanding.', perm: 'billing.view' },
  team: { label: 'Care team', kicker: 'YOUR PEOPLE', sub: 'Who’s working today and the weekly roster.' }
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const ui = { page: 'dashboard', dayOffset: 0, patientId: null, patientQuery: '', showArchived: false, billingFilter: 'outstanding' };
let currentUser = null;

/* ---------- Formatting ---------- */

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
  return String(name).replace(/^(Dr|Nurse)\.?\s+/i, '').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
}

function formatDate(d, opts) {
  return new Intl.DateTimeFormat('en-GB', opts).format(d);
}

function formatVisitDate(iso) {
  if (!iso) return '—';
  const days = Math.round((parseISO(todayISO()) - parseISO(iso)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days === -1) return 'Tomorrow';
  return formatDate(parseISO(iso), { day: 'numeric', month: 'short', year: Math.abs(days) > 300 ? 'numeric' : undefined });
}

function formatClock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return formatDate(new Date(2000, 0, 1, h, m), { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatStamp(stamp) {
  return `${formatVisitDate(stamp.slice(0, 10))}, ${formatClock(stamp.slice(11, 16))}`;
}

function nowStamp() {
  return `${todayISO()}T${nowHHMM()}`;
}

function minutesBetween(from, to) {
  const mins = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return mins(to) - mins(from);
}

function money(n) {
  return `KES ${Math.round(n).toLocaleString('en-KE')}`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function age(dob) {
  if (!dob) return null;
  const d = parseISO(dob);
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) years--;
  return years;
}

function phoneDigits(s) {
  let d = String(s).replace(/\D/g, '');
  if (d.startsWith('254')) d = `0${d.slice(3)}`;
  return d;
}

function shortName(name) {
  const parts = name.trim().split(/\s+/);
  return /^Dr\.?$/i.test(parts[0]) ? `Dr. ${parts[parts.length - 1]}` : parts[0];
}

function statusClass(status) {
  return { 'Checked in': 'checked', Waiting: 'waiting', Paid: 'checked', 'Part paid': 'waiting', Unpaid: 'danger' }[status] ?? '';
}

function vitalsLine(v) {
  const parts = [];
  if (v.sys && v.dia) parts.push(`BP ${v.sys}/${v.dia}`);
  if (v.temp) parts.push(`${v.temp} °C`);
  if (v.pulse) parts.push(`Pulse ${v.pulse}`);
  if (v.resp) parts.push(`Resp ${v.resp}`);
  if (v.spo2) parts.push(`SpO₂ ${v.spo2}%`);
  if (bmi(v)) parts.push(`BMI ${bmi(v).toFixed(1)}`);
  return parts.join(' · ');
}

function flagChips(v) {
  const flags = vitalFlags(v);
  return flags.length
    ? flags.map(f => `<span class="flag ${f.level}">${esc(f.label)}</span>`).join('')
    : '<span class="flag ok">Within normal range</span>';
}

function patientLink(id, name) {
  return `<button type="button" class="link-name" data-patient="${esc(id)}">${esc(name)}</button>`;
}

/* ---------- Form helpers ---------- */

// Keeps a stored value selectable even if it isn't in the standard list.
function optionList(values, selected) {
  const all = selected && !values.includes(selected) ? [selected, ...values] : values;
  return all.map(v => `<option ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
}

// Archived patients are left out of pickers unless they're already selected.
function patientOptions(selectedId) {
  return state.patients
    .filter(p => !p.archived || p.id === selectedId)
    .map(p => `<option value="${esc(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)} · ${esc(p.id)}</option>`)
    .join('');
}

function practitionerOptions(selected, date = new Date()) {
  return state.team
    .map(m => `<option value="${esc(m.name)}" ${m.name === selected ? 'selected' : ''}>${esc(m.name)}${isOnDuty(m, date) ? '' : ' (off duty)'}</option>`)
    .join('');
}

function labelInput(name, label, value = '', type = 'text', required = true, attrs = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${attrs}></label>`;
}

function numberInput(name, label, value, attrs) {
  return `<label>${label}<input name="${name}" type="number" inputmode="decimal" value="${esc(value ?? '')}" ${attrs}></label>`;
}

function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ---------- Session ---------- */

function can(perm) {
  return Boolean(currentUser && PERMISSIONS[perm]?.includes(currentUser.role));
}

function canSeePage(page) {
  return !PAGES[page]?.perm || can(PAGES[page].perm);
}

function showLogin(message = '') {
  currentUser = null;
  closeModal();
  $('#loginError').textContent = message;
  $('#loginScreen').hidden = false;
  $('#loginView').hidden = false;
  $('#signupView').hidden = true;
  $('#signupError').textContent = '';
  $('#loginForm [name=password]').value = '';
  setTimeout(() => $('#loginForm [name=username]').focus(), 30);
}

async function submitLogin(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    const { user } = await api('POST', '/api/login', { username: form.get('username'), password: form.get('password') });
    await startSession(user);
  } catch (err) {
    $('#loginError').textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

function showSignupView() {
  $('#loginNotice').hidden = true;
  $('#loginView').hidden = true;
  $('#signupView').hidden = false;
  $('#signupError').textContent = '';
  setTimeout(() => $('#signupForm [name=name]').focus(), 30);
}

function showLoginView() {
  $('#signupView').hidden = true;
  $('#loginView').hidden = false;
  $('#loginError').textContent = '';
  $('#loginNotice').hidden = true;
  setTimeout(() => $('#loginForm [name=username]').focus(), 30);
}

async function submitSignup(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    await api('POST', '/api/signup', {
      name: form.get('name'),
      username: form.get('username'),
      password: form.get('password'),
      confirmPassword: form.get('confirmPassword')
    });
    // The account waits for an administrator to approve it, so don't sign in yet.
    const username = String(form.get('username')).trim().toLowerCase();
    e.target.reset();
    showLoginView();
    $('#loginForm [name=username]').value = username;
    $('#loginNotice').textContent = 'Request sent. You can sign in once a clinic administrator approves your account.';
    $('#loginNotice').hidden = false;
  } catch (err) {
    $('#signupError').textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

async function startSession(user) {
  currentUser = user;
  await loadState();
  $('#loginScreen').hidden = true;
  const avatar = initials(currentUser.name);
  $('#profileButton .avatar').textContent = avatar;
  $('#profileButton strong').textContent = currentUser.name;
  $('#profileButton small').textContent = ROLES[currentUser.role];
  $('#topAvatar').textContent = avatar;
  $$('.nav-item').forEach(b => b.hidden = !canSeePage(b.dataset.page));
  setPage('dashboard');
  renderDashboard();
}

async function signOut() {
  await api('POST', '/api/logout', {}).catch(() => {});
  showLogin();
}

/* ---------- Refresh ---------- */

// Reloads everything from the server and redraws whatever is on screen.
async function reload() {
  await loadState();
  renderDashboard();
  if (ui.page !== 'dashboard') renderPage(ui.page);
}

// Sends a change to the server, then reloads so every screen shows the saved result.
async function mutate(method, url, body = {}) {
  const result = await api(method, url, body);
  await reload();
  return result;
}

// Shows a failed request to the user; an expired session goes back to sign-in.
function handleError(err) {
  if (err.status === 401) showLogin('Your session has ended. Please sign in again.');
  else showToast(err.message);
}

/* ---------- Dashboard ---------- */

function dayAppointments() {
  const key = isoDate(localDate(ui.dayOffset));
  return state.appointments
    .filter(a => a.date === key && a.status !== 'Cancelled')
    .sort((a, b) => a.time.localeCompare(b.time));
}

function renderDate() {
  const d = localDate(ui.dayOffset);
  $('#scheduleDate').textContent = formatDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#todayLabel').textContent = formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
}

function renderDashboard() {
  if (!currentUser) return;
  const hour = new Date().getHours();
  $('#greeting').textContent = `Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${shortName(currentUser.name)}`;
  // Demo opening hours: Mon–Sat, 08:00–17:00.
  const open = new Date().getDay() !== 0 && hour >= 8 && hour < 17;
  $('#clinicStatus').textContent = open ? 'Clinic open' : 'Clinic closed';
  $('#clinicStatus').previousElementSibling.classList.toggle('closed', !open);
  renderAppointments();
  renderStats();
  renderArrivals();
  renderTeam();
  renderBell();
  $('#patientNavCount').textContent = String(state.patients.filter(p => !p.archived).length);
}

function renderAppointments() {
  const appts = dayAppointments();
  const avatarTones = ['', 'alt', 'third'];
  $('#appointmentList').innerHTML = appts.slice(0, 6).map((a, i) => {
    const name = patientName(a);
    return `<div class="appointment-row">
      <span class="appointment-time">${esc(a.time)}</span>
      <span class="patient-avatar ${avatarTones[i % 3]}">${esc(initials(name))}</span>
      <span class="patient-info"><strong>${patientLink(a.patientId, name)}${a.walkIn ? ' <span class="tag">Walk-in</span>' : ''}</strong><small>${esc(a.type)} · ${esc(a.doctor)}</small></span>
      <button class="appt-status ${statusClass(a.status)}" data-appointment="${esc(a.id)}" title="Change appointment" aria-label="${esc(a.status)} — change ${esc(name)}’s appointment">${esc(a.status)} <span aria-hidden="true">▾</span></button>
    </div>`;
  }).join('') || '<div class="empty-state">No appointments scheduled for this day.</div>';
  $$('[data-appointment]').forEach(b => b.onclick = () => appointmentDialog(b.dataset.appointment));
  $('#moreAppointments').textContent = appts.length > 6 ? `View all ${appts.length} appointments` : 'Open full schedule';

  const doctors = new Set(appts.map(a => a.doctor)).size;
  const todays = todaysAppointments();
  $('#todayCount').textContent = String(todays.length);
  $('#todayDoctors').textContent = todays.length
    ? `${todays.filter(a => a.status === 'Completed').length} seen · ${todays.filter(a => a.status === 'Confirmed').length} still to arrive`
    : 'Nothing booked yet';
  $('#scheduleSummary').textContent = appts.length ? `${plural(appts.length, 'appointment', 'appointments')} with ${plural(doctors, 'practitioner', 'practitioners')}` : '';
}

function renderStats() {
  const room = waitingRoom();
  const ready = room.filter(a => a.status === 'Waiting').length;
  $('#waitingCount').textContent = String(room.length);
  $('#waitingUnit').textContent = room.length === 1 ? 'person' : 'people';
  $('#readyCount').textContent = room.length ? `${ready} ready · ${room.length - ready} awaiting triage` : 'Waiting room is clear';

  const registeredBetween = (from, to) => state.patients.filter(p => p.registered && p.registered >= isoDate(localDate(from)) && p.registered <= isoDate(localDate(to))).length;
  const thisWeek = registeredBetween(-6, 0);
  const diff = thisWeek - registeredBetween(-13, -7);
  $('#newPatientsCount').textContent = String(thisWeek);
  $('#communityNote').textContent = diff > 0 ? `${diff} more than last week` : diff < 0 ? `${-diff} fewer than last week` : 'Same as last week';

  const onDuty = state.team.filter(m => isOnDuty(m));
  $('#dutyCount').textContent = String(onDuty.length);
  $('#dutyTotal').textContent = `of ${state.team.length}`;
  const shown = onDuty.slice(0, 3).map(m => `<span class="avatar mini-avatar" title="${esc(m.name)}">${esc(initials(m.name))}</span>`).join('');
  const extra = onDuty.length > 3 ? `<span class="avatar mini-avatar">+${onDuty.length - 3}</span>` : '';
  const rostered = state.team.filter(m => m.days.includes(new Date().getDay())).length;
  const note = !onDuty.length ? 'No one on duty today' : onDuty.length === rostered ? 'All rostered staff in' : `${plural(rostered - onDuty.length, 'person', 'people')} away`;
  $('#dutyAvatars').innerHTML = `${shown}${extra}<span class="soft-copy">${note}</span>`;
}

function renderArrivals() {
  const room = waitingRoom();
  const now = nowHHMM();
  $('#arrivalSummary').textContent = plural(room.length, 'person', 'people');
  $('#arrivalList').innerHTML = room.map((a, i) => {
    const name = patientName(a);
    let action;
    if (a.status === 'Checked in') {
      action = can('vitals.record') ? `<button class="button button-small" data-triage="${esc(a.id)}">Triage</button>`
        : currentUser.role === 'admin' ? `<button class="button button-small button-quiet" data-ready="${esc(a.id)}">Mark ready</button>`
        : '<span class="stage">Awaiting triage</span>';
    } else {
      action = can('notes.write') ? `<button class="button button-small" data-consult="${esc(a.id)}">Consult</button>`
        : currentUser.role === 'admin' ? `<button class="button button-small button-quiet" data-seen="${esc(a.id)}">Mark seen</button>`
        : '<span class="stage ready">Ready</span>';
    }
    const waited = Math.max(0, minutesBetween(a.arrivedAt ?? a.time, now));
    return `<div class="arrival-row">
      <span class="patient-avatar ${i % 2 ? 'alt' : ''}">${esc(initials(name))}</span>
      <span class="arrival-name"><strong>${patientLink(a.patientId, name)}</strong><small>${esc(a.type)} · ${esc(a.doctor)}</small>
        <small class="arrival-time ${waited >= 30 ? 'late' : ''}">Arrived ${esc(formatClock(a.arrivedAt ?? a.time))}${waited >= 30 ? ` · waiting ${waited} min` : ''}</small></span>
      ${action}
    </div>`;
  }).join('') || '<div class="empty-state">No one is waiting right now.</div>';

  const quick = async (id, status, msg) => {
    const appt = state.appointments.find(a => a.id === id);
    try {
      await mutate('POST', `/api/appointments/${id}/status`, { status });
      showToast(`${patientName(appt)} ${msg}`);
    } catch (err) {
      handleError(err);
    }
  };
  $$('[data-ready]').forEach(b => b.onclick = () => quick(b.dataset.ready, 'Waiting', 'is ready to be seen.'));
  $$('[data-seen]').forEach(b => b.onclick = () => quick(b.dataset.seen, 'Completed', 'has been seen.'));
  $$('[data-triage]').forEach(b => b.onclick = () => {
    const appt = state.appointments.find(a => a.id === b.dataset.triage);
    vitalsDialog(appt.patientId, appt.id);
  });
  $$('[data-consult]').forEach(b => b.onclick = () => {
    const appt = state.appointments.find(a => a.id === b.dataset.consult);
    consultDialog(appt.patientId, appt.id);
  });
}

function dutyLabel(member, date = new Date()) {
  if (isOnDuty(member, date)) return 'On duty';
  return member.away.includes(isoDate(date)) ? 'Away today' : 'Off today';
}

function rosterText(member) {
  return [1, 2, 3, 4, 5, 6, 0].filter(d => member.days.includes(d)).map(d => WEEKDAYS[d]).join(', ') || 'No regular days';
}

function renderTeam() {
  // On-duty staff first, keeping roster order within each group.
  const team = [...state.team].sort((a, b) => isOnDuty(b) - isOnDuty(a));
  $('#teamList').innerHTML = team.slice(0, 4).map((m, i) => `<div class="team-row">
      <span class="patient-avatar ${i % 2 ? 'third' : ''}">${esc(initials(m.name))}</span>
      <span class="team-person"><strong>${esc(m.name)}</strong><small>${esc(m.role)}</small></span>
      <span class="team-state ${isOnDuty(m) ? '' : 'off'}">${dutyLabel(m)}</span>
    </div>`).join('');
}

function shiftDay(offset, redraw) {
  ui.dayOffset = offset;
  renderDate();
  redraw();
}

/* ---------- Notifications ---------- */

function computeAlerts() {
  const alerts = [];
  const now = nowHHMM();
  const today = todayISO();
  for (const a of waitingRoom()) {
    const mins = minutesBetween(a.arrivedAt ?? a.time, now);
    if (mins >= 30) {
      const stage = a.status === 'Checked in' ? 'awaiting triage' : `ready for ${a.doctor}`;
      alerts.push({ level: mins >= 60 ? 'critical' : 'warn', text: `${patientName(a)} has been waiting ${mins} min (${stage}).`, patientId: a.patientId });
    }
  }
  for (const a of todaysAppointments()) {
    if (a.status === 'Confirmed' && minutesBetween(a.time, now) >= 15) {
      alerts.push({ level: 'info', text: `${patientName(a)} hasn’t arrived for their ${a.time} appointment.`, patientId: a.patientId });
    }
  }
  for (const m of state.team.filter(m => m.away.includes(today))) {
    const open = todaysAppointments().filter(a => a.doctor === m.name && a.status !== 'Completed').length;
    if (open) alerts.push({ level: 'warn', text: `${m.name} is away today with ${plural(open, 'appointment', 'appointments')} to reassign.`, page: 'appointments' });
  }
  if (can('clinical.view')) {
    for (const v of state.vitals.filter(v => v.at.startsWith(today))) {
      for (const f of vitalFlags(v).filter(f => f.level === 'critical')) {
        alerts.push({ level: 'critical', text: `${patientName(v)}: ${f.label}.`, patientId: v.patientId });
      }
    }
  }
  if (can('billing.view')) {
    const owed = state.invoices.filter(i => i.date < today && invoiceBalance(i) > 0);
    if (owed.length) {
      const total = owed.reduce((sum, i) => sum + invoiceBalance(i), 0);
      alerts.push({ level: 'info', text: `${plural(owed.length, 'invoice', 'invoices')} from earlier days still outstanding (${money(total)}).`, page: 'billing' });
    }
  }
  if (can('team.manage') && state.accountRequests.length) {
    alerts.push({ level: 'warn', text: `${plural(state.accountRequests.length, 'account request is', 'account requests are')} waiting for approval.`, page: 'team' });
  }
  const order = { critical: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}

function renderBell() {
  const count = computeAlerts().length;
  $('#notificationCount').textContent = String(count);
  $('#notificationCount').hidden = !count;
  $('#notificationBtn').setAttribute('aria-label', count ? `Notifications (${count})` : 'Notifications');
}

function notificationsDialog() {
  const alerts = computeAlerts();
  const list = alerts.map((a, i) => `<button type="button" class="alert-item ${a.level}" data-alert="${i}">${esc(a.text)}</button>`).join('')
    || '<div class="empty-state">You’re all caught up.</div>';
  openModal('Notifications', `<div class="alert-list">${list}</div>`);
  $$('[data-alert]').forEach(b => b.onclick = () => {
    const alert = alerts[b.dataset.alert];
    closeModal();
    if (alert.patientId) openPatient(alert.patientId);
    else if (alert.page) setPage(alert.page);
  });
}

/* ---------- Pages ---------- */

function setPage(page) {
  if (!canSeePage(page)) page = 'dashboard';
  ui.page = page;
  const navPage = page === 'patient' ? 'patients' : page;
  $$('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.page === navPage);
    if (b.dataset.page === navPage) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('#crumbCurrent').textContent = page === 'patient' ? (patientById(ui.patientId)?.name ?? 'Patient') : PAGES[page].label;
  $('#dashboardPage').hidden = page !== 'dashboard';
  $('#alternatePage').hidden = page === 'dashboard';
  if (page !== 'dashboard') renderPage(page);
  $('#sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openPatient(id) {
  ui.patientId = id;
  setPage('patient');
}

function pageHeading(kicker, title, sub) {
  return `<div class="page-heading"><div>
      <div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${sub}</p>
    </div></div>`;
}

function renderPage(page) {
  if (!canSeePage(page)) return setPage('dashboard');
  if (page === 'patient') return renderPatientProfile();
  const { kicker, label, sub } = PAGES[page];
  const bodies = {
    patients: () => `<div class="section-panel">
      <div class="section-toolbar">
        <div class="toolbar-group">
          <input class="search-input" id="patientSearch" type="search" placeholder="Search name, patient ID or phone…" aria-label="Search patients" value="${esc(ui.patientQuery)}">
          <label class="check-label"><input type="checkbox" id="showArchived" ${ui.showArchived ? 'checked' : ''}> Show archived</label>
        </div>
        ${can('patients.edit') ? '<button class="button button-primary" id="addPatientBtn">＋ Register patient</button>' : ''}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Patient</th><th>Record ID</th><th>Phone</th><th>Age</th><th>Payer</th><th>Last visit</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody id="patientsBody"></tbody>
      </table></div>
    </div>`,
    appointments: () => `<div class="section-panel">
      <div class="section-toolbar">
        <div class="schedule-date-row" style="border:0;padding:0;margin:0">
          <button class="date-arrow" id="altPrev" aria-label="Previous day">‹</button>
          <strong id="altDate"></strong>
          <button class="date-arrow" id="altNext" aria-label="Next day">›</button>
          <button class="today-button" id="altToday">Today</button>
        </div>
        <div class="toolbar-group">
          <button class="button button-quiet" id="altPrint">Print list</button>
          <button class="button button-primary" id="altNewAppointment">＋ New appointment</button>
        </div>
      </div>
      <div id="dayView"></div>
    </div>`,
    records: () => `<div class="section-panel">
      <div class="section-toolbar">
        <p class="soft-copy">Notes can be amended but never deleted; earlier versions are kept.</p>
        ${can('notes.write') ? '<button class="button button-primary" id="newNoteBtn">＋ New consultation</button>' : ''}
      </div>
      <div class="notes-grid" id="notesGrid"></div>
    </div>`,
    billing: () => `<div class="stat-grid three" id="billingStats"></div>
      <div class="section-panel">
      <div class="section-toolbar">
        <div class="segmented" role="group" aria-label="Filter invoices">
          ${[['outstanding', 'Outstanding'], ['today', 'Today'], ['all', 'All']].map(([v, l]) => `<button type="button" data-filter="${v}" class="${ui.billingFilter === v ? 'active' : ''}" aria-pressed="${ui.billingFilter === v}">${l}</button>`).join('')}
        </div>
        <button class="button button-primary" id="newInvoiceBtn">＋ New invoice</button>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Invoice</th><th>Date</th><th>Patient</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody id="invoiceBody"></tbody>
      </table></div>
    </div>`,
    team: () => '<div id="accountRequests"></div><div class="notes-grid" id="teamGrid"></div>'
  };

  $('#alternatePage').innerHTML = pageHeading(kicker, label, sub) + bodies[page]();

  if (page === 'patients') {
    renderPatientRows();
    $('#patientSearch').oninput = e => { ui.patientQuery = e.target.value; renderPatientRows(); };
    $('#showArchived').onchange = e => { ui.showArchived = e.target.checked; renderPatientRows(); };
    if ($('#addPatientBtn')) $('#addPatientBtn').onclick = () => patientDialog();
  }
  if (page === 'appointments') renderDayPage();
  if (page === 'records') {
    renderNotes();
    if ($('#newNoteBtn')) $('#newNoteBtn').onclick = () => consultDialog();
  }
  if (page === 'billing') renderBilling();
  if (page === 'team') renderTeamPage();
}

function renderPatientRows() {
  const q = ui.patientQuery.trim().toLowerCase();
  const qDigits = /\d{3,}/.test(q) ? phoneDigits(q) : '';
  const matches = state.patients.filter(p => (ui.showArchived || !p.archived)
    && ([p.name, p.id, p.phone, p.nationalId].join(' ').toLowerCase().includes(q) || (qDigits && phoneDigits(p.phone).includes(qDigits))));
  $('#patientsBody').innerHTML = matches.map(p => `<tr class="${p.archived ? 'archived' : ''}">
      <td>${patientLink(p.id, p.name)}${p.allergies ? ' <span class="tag danger" title="Allergies recorded">Allergy</span>' : ''}${p.archived ? ' <span class="tag">Archived</span>' : ''}</td>
      <td>${esc(p.id)}</td><td>${esc(p.phone)}</td><td>${age(p.dob) ?? '—'}</td><td>${esc(p.payer)}</td>
      <td>${esc(formatVisitDate(p.lastVisit))}</td>
      <td class="row-actions"><button class="text-button" data-patient="${esc(p.id)}">Open</button>${can('patients.edit') ? `<button class="text-button" data-edit-patient="${esc(p.id)}">Edit</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty-state">No patients match your search.</td></tr>';
  $$('[data-edit-patient]').forEach(b => b.onclick = () => patientDialog(b.dataset.editPatient));
}

function renderPatientProfile() {
  const p = patientById(ui.patientId);
  if (!p) {
    $('#alternatePage').innerHTML = '<div class="empty-state">That patient record could not be found.</div>';
    return;
  }
  const today = todayISO();
  const clinical = can('clinical.view');
  const active = !p.archived;
  const vitals = patientVitals(p.id);
  const notes = patientNotes(p.id);
  const appts = state.appointments.filter(a => a.patientId === p.id);
  const upcoming = appts.filter(a => a.date >= today && ['Confirmed', 'Checked in', 'Waiting'].includes(a.status))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const past = appts.filter(a => !upcoming.includes(a))
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, 5);
  const invoices = state.invoices.filter(i => i.patientId === p.id).sort((a, b) => b.id.localeCompare(a.id));

  const actions = [
    active && can('notes.write') && '<button class="button button-primary" id="pConsult">New consultation</button>',
    active && can('vitals.record') && '<button class="button button-primary" id="pVitals">Record vitals</button>',
    active && can('appointments.edit') && '<button class="button button-quiet" id="pBook">Book appointment</button>',
    active && can('billing.view') && '<button class="button button-quiet" id="pInvoice">New invoice</button>',
    can('patients.edit') && '<button class="button button-quiet" id="pEdit">Edit details</button>',
    can('patients.archive') && `<button class="button button-quiet" id="pArchive">${active ? 'Archive' : 'Restore'}</button>`
  ].filter(Boolean).join('');

  const years = age(p.dob);
  const sub = [years !== null && `${years} yrs`, p.sex, p.phone, p.payer !== 'Cash' && `${p.payer} ${p.memberNo}`].filter(Boolean).map(esc).join(' · ');
  const kv = (k, v) => `<dt>${k}</dt><dd>${esc(v || '—')}</dd>`;
  const apptRow = a => `<li><span><strong>${esc(formatVisitDate(a.date))}, ${esc(a.time)}</strong><br>${esc(a.type)} · ${esc(a.doctor)}</span><span class="appt-status ${statusClass(a.status)}">${esc(a.status)}</span></li>`;

  $('#alternatePage').innerHTML = `
    <button class="back-link" id="backToPatients">← All patients</button>
    ${pageHeading(`PATIENT RECORD · ${esc(p.id)}`, esc(p.name), sub)}
    <div class="profile-actions">${actions}</div>
    ${p.archived ? '<div class="banner info">This record is archived. It is kept for reference and can be restored by an administrator.</div>' : ''}
    ${p.allergies ? `<div class="banner danger"><strong>Allergies:</strong> ${esc(p.allergies)}</div>` : ''}
    <div class="profile-grid">
      <section class="panel">
        <div class="panel-heading"><div><div class="section-kicker">CARE HISTORY</div><h2>Consultations</h2></div></div>
        <div class="timeline">${clinical
          ? notes.map(n => noteCard(n)).join('') || '<div class="empty-state">No consultations recorded yet.</div>'
          : '<div class="empty-state">Clinical notes are visible to clinical staff only.</div>'}</div>
      </section>
      <div class="right-column">
        <section class="panel">
          <div class="panel-heading"><div><div class="section-kicker">DETAILS</div><h2>Patient information</h2></div></div>
          <dl class="kv">
            ${kv('Date of birth', p.dob && `${formatDate(parseISO(p.dob), { day: 'numeric', month: 'short', year: 'numeric' })} (${years} yrs)`)}
            ${kv('National ID', p.nationalId)}
            ${kv('Phone', p.phone)}
            ${kv('Next of kin', [p.kinName, p.kinPhone].filter(Boolean).join(' · '))}
            ${kv('Payer', p.payer === 'Cash' ? 'Cash' : `${p.payer} · ${p.memberNo}`)}
            ${clinical ? kv('Conditions', p.conditions) : ''}
            ${kv('Registered', formatVisitDate(p.registered))}
          </dl>
        </section>
        ${clinical ? `<section class="panel">
          <div class="panel-heading"><div><div class="section-kicker">TRIAGE</div><h2>Vitals</h2></div></div>
          ${vitals.length ? `<p class="vitals-latest"><strong>${esc(formatStamp(vitals[0].at))}</strong><br>${esc(vitalsLine(vitals[0]))}</p>
            <div class="flags">${flagChips(vitals[0])}</div>
            ${vitals.length > 1 ? `<h3 class="list-title">Earlier</h3><ul class="mini-list">${vitals.slice(1, 5).map(v => `<li><span><strong>${esc(formatStamp(v.at))}</strong><br>${esc(vitalsLine(v))}</span></li>`).join('')}</ul>` : ''}`
            : '<div class="empty-state">No vitals recorded yet.</div>'}
        </section>` : ''}
        <section class="panel">
          <div class="panel-heading"><div><div class="section-kicker">SCHEDULE</div><h2>Appointments</h2></div></div>
          ${upcoming.length ? `<h3 class="list-title">Upcoming</h3><ul class="mini-list">${upcoming.map(apptRow).join('')}</ul>` : ''}
          ${past.length ? `<h3 class="list-title">Recent</h3><ul class="mini-list">${past.map(apptRow).join('')}</ul>` : ''}
          ${appts.length ? '' : '<div class="empty-state">No appointments yet.</div>'}
        </section>
        ${can('billing.view') ? `<section class="panel">
          <div class="panel-heading"><div><div class="section-kicker">BILLING</div><h2>Invoices</h2></div></div>
          ${invoices.length ? `<ul class="mini-list">${invoices.map(i => `<li>
              <span><strong>${esc(i.id)}</strong> · ${esc(formatVisitDate(i.date))}<br>${money(invoiceTotal(i))}${invoiceBalance(i) ? ` · ${money(invoiceBalance(i))} due` : ''}</span>
              <button class="appt-status ${statusClass(invoiceStatus(i))}" data-receipt="${esc(i.id)}" title="View invoice">${invoiceStatus(i)}</button>
            </li>`).join('')}</ul>` : '<div class="empty-state">No invoices yet.</div>'}
        </section>` : ''}
      </div>
    </div>`;

  const on = (sel, fn) => { if ($(sel)) $(sel).onclick = fn; };
  on('#backToPatients', () => setPage('patients'));
  on('#pEdit', () => patientDialog(p.id));
  on('#pBook', () => appointmentDialog(null, { patientId: p.id }));
  on('#pVitals', () => vitalsDialog(p.id));
  on('#pConsult', () => consultDialog(p.id));
  on('#pInvoice', () => invoiceDialog(p.id));
  on('#pArchive', () => (active ? archiveDialog(p) : restorePatient(p)));
  bindNoteActions();
  $$('[data-receipt]').forEach(b => b.onclick = () => receiptDialog(b.dataset.receipt));
}

function noteCard(n, { showPatient = false } = {}) {
  const fields = [['Complaint', n.complaint], ['Findings', n.findings], ['Diagnosis', n.diagnosis], ['Plan', n.plan], ['Notes', n.body]]
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const rx = n.prescriptions.length ? `<div class="rx-list"><span>Prescribed</span><ul>${n.prescriptions.map(r =>
    `<li>${esc(r.drug)} — ${esc(r.dose)} × ${esc(FREQUENCY_LABELS[r.freq]?.toLowerCase() ?? r.freq)} for ${plural(r.days, 'day', 'days')} <em>(qty ${esc(r.qty)})</em></li>`).join('')}</ul></div>` : '';
  const history = n.amendments.length ? `<details class="amendments"><summary>Amendment history (${n.amendments.length})</summary>${n.amendments.map(a => `<div>
      <small>${esc(formatStamp(a.at))} · ${esc(a.by)} — ${esc(a.reason)}</small>
      <p>Previous: ${esc([a.previous.complaint, a.previous.findings, a.previous.diagnosis, a.previous.plan, a.previous.body].filter(Boolean).join(' / '))}</p>
    </div>`).join('')}</details>` : '';
  return `<article class="note-card">
    <div class="note-head"><strong>${showPatient ? patientLink(n.patientId, patientName(n)) : esc(n.type)}</strong>${n.amendments.length ? '<span class="tag">Amended</span>' : ''}</div>
    <small>${esc(formatVisitDate(n.date))}${showPatient ? ` · ${esc(n.type)}` : ''} · ${esc(n.author ?? 'Author not recorded')}</small>
    <dl class="note-fields">${fields}</dl>
    ${rx}${history}
    ${can('notes.write') ? `<button class="text-button note-amend" data-amend="${esc(n.id)}">Amend note</button>` : ''}
  </article>`;
}

function bindNoteActions() {
  $$('[data-amend]').forEach(b => b.onclick = () => amendDialog(b.dataset.amend));
}

function renderDayPage() {
  const draw = () => {
    $('#altDate').textContent = formatDate(localDate(ui.dayOffset), { weekday: 'long', day: 'numeric', month: 'long' });
    const appts = dayAppointments();
    // Clinic hours are 08:00–15:00, but stretch to fit anything booked outside them.
    const booked = appts.map(a => Number(a.time.slice(0, 2)));
    const first = Math.min(8, ...booked);
    const last = Math.max(15, ...booked);
    const rows = [];
    for (let h = first; h <= last; h++) {
      const hour = String(h).padStart(2, '0');
      const events = appts.filter(a => a.time.startsWith(hour)).map(a => `<button class="day-event ${statusClass(a.status)}" data-edit-appt="${esc(a.id)}">
          <strong>${esc(a.time)} · ${esc(patientName(a))}</strong><span>${esc(a.type)}${a.walkIn ? ' (walk-in)' : ''} · ${esc(a.doctor)} · ${esc(a.status)}</span>
        </button>`).join('');
      rows.push(`<div class="day-view"><div class="day-time">${hour}:00</div><div class="day-slot">${events}</div></div>`);
    }
    $('#dayView').innerHTML = rows.join('');
    $$('[data-edit-appt]').forEach(b => b.onclick = () => appointmentDialog(b.dataset.editAppt));
  };
  draw();
  $('#altPrev').onclick = () => shiftDay(ui.dayOffset - 1, draw);
  $('#altNext').onclick = () => shiftDay(ui.dayOffset + 1, draw);
  $('#altToday').onclick = () => shiftDay(0, draw);
  $('#altPrint').onclick = printDayDialog;
  $('#altNewAppointment').onclick = () => appointmentDialog();
}

function renderNotes() {
  const notes = [...state.notes].sort((a, b) => (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date));
  $('#notesGrid').innerHTML = notes.map(n => noteCard(n, { showPatient: true })).join('')
    || '<div class="empty-state">No visit notes yet. Start a consultation to begin a patient’s care history.</div>';
  bindNoteActions();
}

function renderBilling() {
  const today = todayISO();
  const paidToday = state.invoices.flatMap(i => i.payments).filter(p => p.at.startsWith(today));
  const byMethod = PAYMENT_METHODS.map(m => [m, paidToday.filter(p => p.method === m).reduce((s, p) => s + p.amount, 0)]).filter(([, v]) => v);
  const outstanding = state.invoices.filter(i => invoiceBalance(i) > 0);
  const card = (title, value, foot) => `<article class="stat-card"><div class="stat-top"><span>${title}</span></div><div class="stat-number">${value}</div><div class="stat-foot"><span class="soft-copy">${foot}</span></div></article>`;
  $('#billingStats').innerHTML = card('Collected today', money(paidToday.reduce((s, p) => s + p.amount, 0)), byMethod.map(([m, v]) => `${m} ${money(v)}`).join(' · ') || 'No payments yet today')
    + card('Outstanding', money(outstanding.reduce((s, i) => s + invoiceBalance(i), 0)), plural(outstanding.length, 'invoice', 'invoices'))
    + card('Invoices today', String(state.invoices.filter(i => i.date === today).length), 'From consultations and the front desk');

  const filters = { outstanding: i => invoiceBalance(i) > 0, today: i => i.date === today, all: () => true };
  const rows = state.invoices.filter(filters[ui.billingFilter]).sort((a, b) => b.id.localeCompare(a.id));
  $('#invoiceBody').innerHTML = rows.map(i => `<tr>
      <td>${esc(i.id)}</td><td>${esc(formatVisitDate(i.date))}</td><td>${patientLink(i.patientId, patientName(i))}</td>
      <td>${money(invoiceTotal(i))}</td><td>${money(invoicePaid(i))}</td><td><strong>${money(invoiceBalance(i))}</strong></td>
      <td><span class="appt-status ${statusClass(invoiceStatus(i))}">${invoiceStatus(i)}</span></td>
      <td class="row-actions">${invoiceBalance(i) > 0 ? `<button class="button button-small" data-pay="${esc(i.id)}">Take payment</button>` : ''}<button class="text-button" data-receipt="${esc(i.id)}">${invoiceStatus(i) === 'Paid' ? 'Receipt' : 'View'}</button></td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty-state">No invoices to show.</td></tr>';

  $$('[data-filter]').forEach(b => b.onclick = () => { ui.billingFilter = b.dataset.filter; renderPage('billing'); });
  $('#newInvoiceBtn').onclick = () => invoiceDialog();
  $$('[data-pay]').forEach(b => b.onclick = () => paymentDialog(b.dataset.pay));
  $$('[data-receipt]').forEach(b => b.onclick = () => receiptDialog(b.dataset.receipt));
}

function renderAccountRequests() {
  const requests = can('team.manage') ? state.accountRequests : [];
  $('#accountRequests').innerHTML = requests.length ? `<section class="section-panel requests-panel">
      <div class="panel-heading"><div><h2>Account requests</h2>
        <p class="panel-sub">People who signed up and are waiting for access. Choose the role that matches their job before approving.</p></div></div>
      ${requests.map(r => `<div class="request-row">
        <span class="patient-avatar">${esc(initials(r.name))}</span>
        <span class="team-person"><strong>${esc(r.name)}</strong><small>@${esc(r.username)} · requested ${esc(formatStamp(r.requestedAt))}</small></span>
        <select class="request-role" data-role-for="${r.id}" aria-label="Role for ${esc(r.name)}">
          <option value="" selected disabled>Choose role…</option>
          ${Object.entries(ROLES).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}
        </select>
        <button class="button button-small" data-approve="${r.id}">Approve</button>
        <button class="button button-small button-quiet" data-reject="${r.id}">Reject</button>
      </div>`).join('')}
    </section>` : '';

  const request = id => state.accountRequests.find(r => String(r.id) === id);
  $$('[data-approve]').forEach(b => b.onclick = async () => {
    const r = request(b.dataset.approve);
    const role = $(`[data-role-for="${r.id}"]`).value;
    if (!role) return showToast(`Choose a role for ${r.name} first.`);
    try {
      await mutate('POST', `/api/users/${r.id}/approve`, { role });
      showToast(`${r.name} approved as ${ROLES[role]}. They can sign in now.`);
    } catch (err) {
      handleError(err);
    }
  });
  $$('[data-reject]').forEach(b => b.onclick = () => {
    const r = request(b.dataset.reject);
    openModal('Reject account request', `<p class="modal-copy">${esc(r.name)} (@${esc(r.username)}) won’t be able to sign in. The username stays reserved.</p>`, 'Reject', async () => {
      await mutate('POST', `/api/users/${r.id}/reject`);
      showToast(`${r.name}’s request was rejected.`);
    });
  });
}

function renderTeamPage() {
  renderAccountRequests();
  const today = todayISO();
  const manage = can('team.manage');
  $('#teamGrid').innerHTML = state.team.map(m => {
    const booked = todaysAppointments().filter(a => a.doctor === m.name).length;
    const rostered = m.days.includes(new Date().getDay());
    const toggle = manage && rostered
      ? `<button class="text-button" data-away="${m.id}">${m.away.includes(today) ? 'Mark back on duty' : 'Mark away today'}</button>` : '';
    return `<article class="note-card">
      <div class="note-head"><strong>${esc(m.name)}</strong><span class="team-state ${isOnDuty(m) ? '' : 'off'}">${dutyLabel(m)}</span></div>
      <small>${esc(m.role)}</small>
      <p>Works ${esc(rosterText(m))}. ${plural(booked, 'appointment', 'appointments')} today.</p>
      ${manage ? `<div class="card-actions">${toggle}<button class="text-button" data-roster="${m.id}">Edit roster</button></div>` : ''}
    </article>`;
  }).join('');
  const byId = id => state.team.find(m => String(m.id) === id);
  $$('[data-away]').forEach(b => b.onclick = () => toggleAway(byId(b.dataset.away)));
  $$('[data-roster]').forEach(b => b.onclick = () => rosterDialog(byId(b.dataset.roster)));
}

async function toggleAway(member) {
  const away = member.away.includes(todayISO());
  try {
    await mutate('POST', `/api/team/${member.id}/away`, { away: !away });
  } catch (err) {
    return handleError(err);
  }
  const booked = todaysAppointments().filter(a => a.doctor === member.name && a.status !== 'Completed').length;
  showToast(away ? `${member.name} is back on duty.`
    : booked ? `${member.name} marked away — ${plural(booked, 'appointment needs', 'appointments need')} reassigning.`
    : `${member.name} marked away today.`);
}

/* ---------- Modal ---------- */

let modalReturnFocus = null;

// `handler` receives the form data and may be async. Returning false, or throwing
// (e.g. the server rejected the input), keeps the dialog open so the user can fix it.
// With no `submitText` the dialog is read-only.
function openModal(title, fields, submitText, handler, { wide = false } = {}) {
  modalReturnFocus = document.activeElement;
  $('#modalTitle').textContent = title;
  $('.modal').classList.toggle('wide', wide);
  const form = $('#appointmentForm');
  form.innerHTML = `${fields}<div class="modal-actions">
      <button type="button" class="button button-quiet" id="modalCancel">${submitText ? 'Cancel' : 'Close'}</button>
      ${submitText ? `<button class="button button-primary">${submitText}</button>` : ''}
    </div>`;
  $('#modalBackdrop').hidden = false;
  $('#modalCancel').onclick = closeModal;
  form.onsubmit = async e => {
    e.preventDefault();
    if (!handler) return closeModal();
    const submit = form.querySelector('.modal-actions .button-primary');
    submit.disabled = true;
    try {
      if ((await handler(new FormData(form))) !== false) closeModal();
    } catch (err) {
      handleError(err);
    } finally {
      submit.disabled = false;
    }
  };
  const first = form.querySelector('input:not([type=hidden]),select,textarea') ?? $('#modalCancel');
  setTimeout(() => first.focus(), 30);
}

function closeModal() {
  if ($('#modalBackdrop').hidden) return;
  $('#modalBackdrop').hidden = true;
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
}

// Prints only the open dialog's content.
function printModal() {
  document.body.classList.add('printing');
  window.print();
  document.body.classList.remove('printing');
}

// Keep Tab / Shift+Tab inside the open dialog.
function trapFocus(e) {
  if (e.key !== 'Tab' || $('#modalBackdrop').hidden) return;
  const focusable = $$('#modalBackdrop button, #modalBackdrop input, #modalBackdrop select, #modalBackdrop textarea, #modalBackdrop summary');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------- Patient dialogs ---------- */

function patientDialog(id, onSaved) {
  const old = patientById(id);
  const fields = labelInput('name', 'Full name', old?.name)
    + `<div class="form-row"><label>Sex<select name="sex" required>${optionList(SEXES, old?.sex || 'Female')}</select></label>${labelInput('dob', 'Date of birth', old?.dob, 'date', false, `max="${todayISO()}"`)}</div>`
    + `<div class="form-row">${labelInput('phone', 'Phone number', old?.phone, 'tel')}${labelInput('nationalId', 'National ID / birth cert.', old?.nationalId, 'text', false)}</div>`
    + labelInput('allergies', 'Allergies', old?.allergies, 'text', false, 'placeholder="e.g. Penicillin, sulfa drugs — blank if none known"')
    + (can('clinical.view') ? labelInput('conditions', 'Chronic conditions', old?.conditions, 'text', false, 'placeholder="e.g. Hypertension, asthma"') : '')
    + `<div class="form-row">${labelInput('kinName', 'Next of kin', old?.kinName, 'text', false)}${labelInput('kinPhone', 'Next of kin phone', old?.kinPhone, 'tel', false)}</div>`
    + `<div class="form-row"><label>Payer<select name="payer">${optionList(PAYERS, old?.payer || 'Cash')}</select></label>${labelInput('memberNo', 'SHA / insurance no.', old?.memberNo, 'text', false)}</div>`;

  openModal(old ? 'Edit patient' : 'Register patient', fields, old ? 'Save changes' : 'Register patient', async data => {
    const body = Object.fromEntries(['name', 'sex', 'dob', 'phone', 'nationalId', 'allergies', 'conditions', 'kinName', 'kinPhone', 'payer', 'memberNo']
      .map(k => [k, String(data.get(k) ?? '').trim()]));
    const { id: savedId } = await mutate(old ? 'PUT' : 'POST', old ? `/api/patients/${old.id}` : '/api/patients', body);
    showToast(old ? 'Patient record updated.' : `${body.name} registered as ${savedId}.`);
    if (onSaved) setTimeout(() => onSaved(savedId));
  }, { wide: true });
}

function archiveDialog(p) {
  const upcoming = state.appointments.filter(a => a.patientId === p.id && a.date >= todayISO() && a.status === 'Confirmed');
  openModal('Archive patient', `<p class="modal-copy">${esc(p.name)} (${esc(p.id)}) will be hidden from patient lists and booking. Their records are kept and can be restored at any time.${upcoming.length ? ` <strong>${plural(upcoming.length, 'upcoming appointment', 'upcoming appointments')} will be cancelled.</strong>` : ''}</p>`, 'Archive', async () => {
    await mutate('POST', `/api/patients/${p.id}/archive`);
    showToast(`${p.name} archived.`);
  });
}

async function restorePatient(p) {
  try {
    await mutate('POST', `/api/patients/${p.id}/restore`);
    showToast(`${p.name} restored.`);
  } catch (err) {
    handleError(err);
  }
}

/* ---------- Appointment & check-in dialogs ---------- */

function appointmentDialog(id, preset = {}) {
  const old = state.appointments.find(a => a.id === id);
  if (!state.patients.some(p => !p.archived)) {
    showToast('Register a patient before booking an appointment.');
    return;
  }
  const date = old?.date || todayISO();
  const fields = `<label>Patient<select name="patientId" required>${patientOptions(old?.patientId ?? preset.patientId)}</select></label>
    <div class="form-row">${labelInput('date', 'Date', date, 'date')}${labelInput('time', 'Time', old?.time || '09:00', 'time')}</div>
    <label>Practitioner<select name="doctor">${practitionerOptions(old?.doctor, parseISO(date))}</select></label>
    <label>Appointment type<select name="type">${optionList(VISIT_TYPES, old?.type)}</select></label>
    ${old ? `<label>Status<select name="status">${optionList(STATUSES, old.status)}</select></label>` : ''}`;

  openModal(old ? 'Update appointment' : 'New appointment', fields, old ? 'Save appointment' : 'Book appointment', async data => {
    const body = Object.fromEntries(['patientId', 'date', 'time', 'doctor', 'type', 'status'].map(k => [k, data.get(k)]));
    await mutate(old ? 'PUT' : 'POST', old ? `/api/appointments/${old.id}` : '/api/appointments', body);
    const doctor = teamMember(body.doctor);
    const offDuty = doctor && !isOnDuty(doctor, parseISO(body.date));
    showToast(`${old ? 'Appointment updated.' : 'Appointment booked.'}${offDuty ? ` Note: ${doctor.name} isn’t on duty that day.` : ''}`);
  });
}

function checkInDialog() {
  const expected = todaysAppointments().filter(a => a.status === 'Confirmed').sort((a, b) => a.time.localeCompare(b.time));
  if (!expected.length) return walkInDialog();
  const options = expected.map(a => `<option value="${esc(a.id)}">${esc(a.time)} · ${esc(patientName(a))} · ${esc(a.doctor)}</option>`).join('');
  openModal('Check in patient', `<label>Today’s appointment<select name="id">${options}</select></label>
    <button type="button" class="text-button inline-link" id="walkInLink">Patient without a booking? Check in a walk-in →</button>`, 'Check in', async data => {
    const appt = state.appointments.find(a => a.id === data.get('id'));
    await mutate('POST', `/api/appointments/${appt.id}/status`, { status: 'Checked in' });
    showToast(`${patientName(appt)} checked in.`);
  });
  $('#walkInLink').onclick = () => { closeModal(); walkInDialog(); };
}

function walkInDialog(patientId) {
  const onDuty = state.team.filter(m => isOnDuty(m));
  const fields = `<label>Patient<select name="patientId" required>${patientOptions(patientId)}</select></label>
    <button type="button" class="text-button inline-link" id="walkInRegister">New patient? Register them first →</button>
    <label>Reason for visit<select name="type">${optionList(VISIT_TYPES)}</select></label>
    <label>See practitioner<select name="doctor">${practitionerOptions(onDuty[0]?.name)}</select></label>`;
  openModal('Walk-in check-in', fields, 'Check in', async data => {
    const body = { patientId: data.get('patientId'), type: data.get('type'), doctor: data.get('doctor') };
    await mutate('POST', '/api/appointments/walk-in', body);
    showToast(`${patientName(body)} checked in as a walk-in.`);
  });
  $('#walkInRegister').onclick = () => { closeModal(); patientDialog(null, id => walkInDialog(id)); };
}

function printDayDialog() {
  const d = localDate(ui.dayOffset);
  const appts = dayAppointments();
  const rows = appts.map(a => `<tr><td>${esc(a.time)}</td><td>${esc(patientName(a))}</td><td>${esc(a.patientId)}</td><td>${esc(a.type)}</td><td>${esc(a.doctor)}</td><td>${esc(a.status)}</td></tr>`).join('')
    || '<tr><td colspan="6" class="empty-state">No appointments.</td></tr>';
  openModal(`Day list · ${formatDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}`, `<div class="printable">
      <h3 class="print-title">${CLINIC_NAME} — ${esc(formatDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Patient</th><th>ID</th><th>Type</th><th>Practitioner</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`, 'Print', () => { printModal(); return false; }, { wide: true });
}

/* ---------- Clinical dialogs ---------- */

function vitalsDialog(patientId, appointmentId) {
  const p = patientById(patientId);
  const last = patientVitals(patientId)[0];
  const range = key => `min="${VITAL_LIMITS[key][0]}" max="${VITAL_LIMITS[key][1]}"`;
  const fields = `<p class="modal-copy">${esc(p.name)} · ${esc(p.id)}${age(p.dob) !== null ? ` · ${age(p.dob)} yrs` : ''}</p>
    ${p.allergies ? `<div class="banner danger"><strong>Allergies:</strong> ${esc(p.allergies)}</div>` : ''}
    <div class="form-row">${numberInput('sys', 'BP systolic (mmHg)', '', range('sys'))}${numberInput('dia', 'BP diastolic (mmHg)', '', range('dia'))}</div>
    <div class="form-row">${numberInput('temp', 'Temperature (°C)', '', `${range('temp')} step="0.1"`)}${numberInput('pulse', 'Pulse (bpm)', '', range('pulse'))}</div>
    <div class="form-row">${numberInput('resp', 'Respiratory rate (/min)', '', range('resp'))}${numberInput('spo2', 'SpO₂ (%)', '', range('spo2'))}</div>
    <div class="form-row">${numberInput('weight', 'Weight (kg)', '', `${range('weight')} step="0.1"`)}${numberInput('height', 'Height (cm)', last?.height, `${range('height')} step="0.1"`)}</div>`;

  openModal('Record vitals', fields, 'Save vitals', async data => {
    const body = { patientId, appointmentId: appointmentId ?? null };
    for (const key of Object.keys(VITAL_LIMITS)) body[key] = data.get(key) === '' ? null : Number(data.get(key));
    const { flags, readyForClinician } = await mutate('POST', '/api/vitals', body);
    const critical = flags.filter(f => f.level === 'critical');
    showToast(critical.length ? `Vitals saved — CRITICAL: ${critical.map(f => f.label).join('; ')}. Alert the clinician now.`
      : `Vitals saved${readyForClinician ? `; ${p.name} is ready to be seen` : ''}.`);
  }, { wide: true });
}

function rxRow() {
  return `<div class="rx-row">
    <select name="rxDrug" aria-label="Medicine">${FORMULARY.map(d => `<option>${esc(d.name)}</option>`).join('')}</select>
    <input name="rxDose" type="number" min="0.5" step="0.5" value="1" aria-label="Units per dose">
    <select name="rxFreq" aria-label="Frequency">${Object.keys(FREQUENCIES).map(f => `<option value="${f}" title="${FREQUENCY_LABELS[f]}">${f}</option>`).join('')}</select>
    <input name="rxDays" type="number" min="1" value="5" aria-label="Days">
    <button type="button" class="rx-remove" aria-label="Remove medicine">×</button>
  </div>`;
}

function consultDialog(patientId, appointmentId) {
  const p = patientById(patientId);
  const appt = state.appointments.find(a => a.id === appointmentId);
  const latest = p && patientVitals(p.id)[0];
  const todayVitals = latest?.at.startsWith(todayISO()) ? latest : null;
  const fields = `${p ? `<p class="modal-copy">${esc(p.name)} · ${esc(p.id)}${age(p.dob) !== null ? ` · ${age(p.dob)} yrs` : ''}${p.conditions ? ` · ${esc(p.conditions)}` : ''}</p>`
      : `<label>Patient<select name="patientId" required>${patientOptions()}</select></label>`}
    ${p?.allergies ? `<div class="banner danger"><strong>Allergies:</strong> ${esc(p.allergies)}</div>` : ''}
    ${todayVitals ? `<div class="banner info"><strong>Today’s vitals:</strong> ${esc(vitalsLine(todayVitals))}<div class="flags">${flagChips(todayVitals)}</div></div>` : ''}
    ${labelInput('type', 'Visit type', appt?.type ?? 'General consultation')}
    <label>Presenting complaint<textarea name="complaint" rows="2" required></textarea></label>
    <label>Examination findings<textarea name="findings" rows="2"></textarea></label>
    <label>Diagnosis<input name="diagnosis" list="dxList" required placeholder="Start typing a condition or ICD-10 code…"></label>
    <datalist id="dxList">${DIAGNOSES.map(d => `<option value="${esc(d)}">`).join('')}</datalist>
    <label>Plan &amp; advice<textarea name="plan" rows="2" required></textarea></label>
    <fieldset class="rx-fieldset"><legend>Prescription</legend>
      <div class="rx-head"><span>Medicine</span><span>Per dose</span><span>Freq.</span><span>Days</span><span></span></div>
      <div id="rxRows"></div>
      <button type="button" class="text-button" id="addRx">＋ Add medicine</button>
    </fieldset>`;

  openModal('Consultation', fields, 'Save & complete visit', async data => {
    const doses = data.getAll('rxDose');
    const freqs = data.getAll('rxFreq');
    const days = data.getAll('rxDays');
    const body = {
      patientId: p?.id ?? data.get('patientId'),
      appointmentId: appt?.id ?? null,
      ...Object.fromEntries(['type', 'complaint', 'findings', 'diagnosis', 'plan'].map(k => [k, String(data.get(k) ?? '').trim()])),
      prescriptions: data.getAll('rxDrug').map((drug, i) => ({ drug, dose: Number(doses[i]), freq: freqs[i], days: Number(days[i]) }))
    };
    // The server re-checks allergies; doing it here too gives instant feedback.
    const patient = patientById(body.patientId);
    for (const line of body.prescriptions) {
      const drug = drugByName(line.drug);
      const allergy = allergyConflict(patient, drug);
      if (allergy) {
        showToast(`${patient.name} has a recorded allergy to ${allergy} — ${drug.name} is a ${drug.cls}. Remove it or choose another medicine.`);
        return false;
      }
    }
    const { invoiceId, balance } = await mutate('POST', '/api/consultations', body);
    showToast(`Consultation saved · ${invoiceId} sent to billing (${money(balance)}).`);
  }, { wide: true });

  $('#addRx').onclick = () => $('#rxRows').insertAdjacentHTML('beforeend', rxRow());
  $('#rxRows').onclick = e => { if (e.target.closest('.rx-remove')) e.target.closest('.rx-row').remove(); };
}

function amendDialog(noteId) {
  const n = state.notes.find(x => x.id === noteId);
  const area = (name, label, value) => `<label>${label}<textarea name="${name}" rows="2">${esc(value ?? '')}</textarea></label>`;
  const fields = `<p class="modal-copy">${esc(patientName(n))} · ${esc(formatVisitDate(n.date))} · ${esc(n.author ?? 'Author not recorded')}</p>
    ${area('complaint', 'Presenting complaint', n.complaint)}${area('findings', 'Examination findings', n.findings)}
    <label>Diagnosis<input name="diagnosis" list="dxList" value="${esc(n.diagnosis ?? '')}"></label>
    <datalist id="dxList">${DIAGNOSES.map(d => `<option value="${esc(d)}">`).join('')}</datalist>
    ${area('plan', 'Plan & advice', n.plan)}
    ${labelInput('reason', 'Reason for amendment', '', 'text', true, 'placeholder="e.g. Corrected diagnosis after lab result"')}
    <p class="soft-copy">The original version is kept in the amendment history. Prescriptions can’t be changed after billing.</p>`;
  openModal('Amend visit note', fields, 'Save amendment', async data => {
    const body = Object.fromEntries(['complaint', 'findings', 'diagnosis', 'plan', 'reason'].map(k => [k, String(data.get(k) ?? '').trim()]));
    await mutate('POST', `/api/notes/${n.id}/amend`, body);
    showToast('Note amended. The previous version is kept in its history.');
  }, { wide: true });
}

/* ---------- Billing dialogs ---------- */

function invoiceDialog(patientId) {
  const services = Object.entries(SERVICE_PRICES).map(([name, price]) => `<option value="${esc(name)}">${esc(name)} — ${money(price)}</option>`).join('');
  const fields = `<label>Patient<select name="patientId" required>${patientOptions(patientId)}</select></label>
    <div class="form-row"><label>Service<select name="service">${services}</select></label>${numberInput('qty', 'Quantity', 1, 'min="1" max="50" required')}</div>`;
  openModal('New invoice', fields, 'Create invoice', async data => {
    const body = { patientId: data.get('patientId'), service: data.get('service'), qty: Number(data.get('qty')) };
    const { id } = await mutate('POST', '/api/invoices', body);
    showToast(`${id} created for ${patientName(body)} (${money(SERVICE_PRICES[body.service] * body.qty)}).`);
  });
}

function paymentDialog(invoiceId) {
  const inv = state.invoices.find(i => i.id === invoiceId);
  const balance = invoiceBalance(inv);
  const patient = patientById(inv.patientId);
  const defaultMethod = patient?.payer === 'SHA' ? 'SHA' : patient?.payer === 'Private insurance' ? 'Insurance' : 'M-Pesa';
  const fields = `<p class="modal-copy">${esc(inv.id)} · ${esc(patientName(inv))} · Balance <strong>${money(balance)}</strong></p>
    <div class="form-row"><label>Method<select name="method">${optionList(PAYMENT_METHODS, defaultMethod)}</select></label>${numberInput('amount', 'Amount (KES)', balance, `min="1" max="${balance}" required`)}</div>
    ${labelInput('ref', 'Reference', defaultMethod === 'SHA' || defaultMethod === 'Insurance' ? patient?.memberNo : '', 'text', false, 'placeholder="M-Pesa code, or SHA / insurance claim number"')}`;
  openModal('Take payment', fields, 'Record payment', async data => {
    const body = { method: data.get('method'), amount: Number(data.get('amount')), ref: String(data.get('ref')).trim() };
    const { balance: left } = await mutate('POST', `/api/invoices/${inv.id}/payments`, body);
    showToast(left ? `${money(body.amount)} recorded. ${money(left)} still due.` : `${inv.id} paid in full.`);
    if (!left) setTimeout(() => receiptDialog(inv.id));
  });
}

function receiptDialog(invoiceId) {
  const inv = state.invoices.find(i => i.id === invoiceId);
  const patient = patientById(inv.patientId);
  const paid = invoiceStatus(inv) === 'Paid';
  const items = inv.items.map(i => `<tr><td>${esc(i.desc)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.qty * i.price)}</td></tr>`).join('');
  const payments = inv.payments.map(p => `<li>${esc(formatStamp(p.at))} · ${esc(p.method)}${p.ref ? ` (${esc(p.ref)})` : ''} · ${money(p.amount)}${p.by ? ` · received by ${esc(p.by)}` : ''}</li>`).join('');
  openModal(`${paid ? 'Receipt' : 'Invoice'} ${inv.id}`, `<div class="printable receipt">
      <h3 class="print-title">${CLINIC_NAME}</h3>
      <dl class="kv">
        <dt>${paid ? 'Receipt' : 'Invoice'}</dt><dd>${esc(inv.id)}</dd>
        <dt>Date</dt><dd>${esc(formatDate(parseISO(inv.date), { day: 'numeric', month: 'long', year: 'numeric' }))}</dd>
        <dt>Patient</dt><dd>${esc(patientName(inv))} · ${esc(inv.patientId)}</dd>
        ${patient && patient.payer !== 'Cash' ? `<dt>Payer</dt><dd>${esc(patient.payer)} · ${esc(patient.memberNo)}</dd>` : ''}
      </dl>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>${items}</tbody></table></div>
      <dl class="kv totals"><dt>Total</dt><dd>${money(invoiceTotal(inv))}</dd><dt>Paid</dt><dd>${money(invoicePaid(inv))}</dd><dt>Balance</dt><dd><strong>${money(invoiceBalance(inv))}</strong></dd></dl>
      ${payments ? `<h4 class="list-title">Payments</h4><ul class="plain-list">${payments}</ul>` : ''}
    </div>`, 'Print', () => { printModal(); return false; }, { wide: true });
}

/* ---------- Team & account dialogs ---------- */

function rosterDialog(member) {
  const boxes = [1, 2, 3, 4, 5, 6, 0].map(d =>
    `<label><input type="checkbox" name="days" value="${d}" ${member.days.includes(d) ? 'checked' : ''}> ${WEEKDAYS[d]}</label>`).join('');
  openModal(`Roster · ${member.name}`, labelInput('role', 'Role', member.role)
    + `<fieldset class="day-checks"><legend>Works on</legend>${boxes}</fieldset>`, 'Save roster', async data => {
    await mutate('PUT', `/api/team/${member.id}`, { role: String(data.get('role')).trim(), days: data.getAll('days').map(Number) });
    showToast(`${member.name}’s roster updated.`);
  });
}

function accountDialog() {
  openModal('Your account', `<p class="modal-copy">Signed in as <strong>${esc(currentUser.name)}</strong> (${esc(currentUser.username)}) · ${esc(ROLES[currentUser.role])}</p>
    <p class="soft-copy">To change your password, ask your clinic administrator.</p>`, 'Sign out', () => {
    setTimeout(signOut);
  });
}

const HELP = {
  admin: ['Use Care team to edit rosters and mark staff away for the day.', 'Archive a patient from their record; nothing is ever deleted.', 'Billing shows what’s been collected today and what’s outstanding.'],
  reception: ['Use Check in on the overview for booked patients or walk-ins.', 'Register new patients from Patients; add their SHA or insurance number for billing.', 'Take payments from Billing. M-Pesa payments need the 10-character transaction code.'],
  nurse: ['Checked-in patients appear under Waiting room. Press Triage to record vitals.', 'Saving vitals moves the patient to “ready to be seen”.', 'Critical readings are flagged in red and appear in notifications.'],
  doctor: ['Press Consult next to a ready patient in the Waiting room.', 'Prescriptions are checked against the patient’s recorded allergies.', 'Saving a consultation completes the visit and sends the invoice to billing.']
};

function helpDialog() {
  openModal('Help', `<p class="modal-copy">Quick guide for ${esc(ROLES[currentUser.role].toLowerCase())}</p>
    <ul class="plain-list help-list">${HELP[currentUser.role].map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <p class="soft-copy">Press Esc to close any dialog. For account or access problems, contact your clinic administrator.</p>`);
}

/* ---------- Wiring ---------- */

function bind() {
  $$('.nav-item').forEach(b => b.onclick = () => setPage(b.dataset.page));
  $$('[data-goto]').forEach(b => b.onclick = () => setPage(b.dataset.goto));
  $('#newAppointmentBtn').onclick = () => appointmentDialog();
  $('#checkinBtn').onclick = checkInDialog;
  $('#walkInBtn').onclick = () => walkInDialog();
  $('#printDayBtn').onclick = printDayDialog;
  $('#notificationBtn').onclick = notificationsDialog;
  $('#helpBtn').onclick = helpDialog;
  $('#profileButton').onclick = accountDialog;
  $('#topAvatar').onclick = accountDialog;
  $('#menuToggle').onclick = () => $('#sidebar').classList.toggle('open');

  $('#prevDay').onclick = () => shiftDay(ui.dayOffset - 1, renderAppointments);
  $('#nextDay').onclick = () => shiftDay(ui.dayOffset + 1, renderAppointments);
  $('#todayButton').onclick = () => shiftDay(0, renderAppointments);

  // Patient names anywhere in the app open the patient's record.
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-patient]');
    if (!link) return;
    closeModal();
    openPatient(link.dataset.patient);
  });

  $('#modalClose').onclick = closeModal;
  $('#modalBackdrop').onclick = e => { if (e.target.id === 'modalBackdrop') closeModal(); };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    trapFocus(e);
  });
}

async function init() {
  renderDate();
  bind();
  $('#loginForm').onsubmit = submitLogin;
  $('#signupForm').onsubmit = submitSignup;
  $('#showSignup').onclick = showSignupView;
  $('#showLogin').onclick = showLoginView;
  try {
    const { user } = await api('GET', '/api/me');
    await startSession(user);
  } catch (err) {
    showLogin(err.status === 401 ? '' : err.message);
  }
  // Pick up changes made by colleagues on other computers.
  setInterval(async () => {
    if (!currentUser) return;
    try {
      await loadState();
    } catch (err) {
      if (err.status === 401) showLogin('Your session has ended. Please sign in again.');
      return;
    }
    if (ui.dayOffset === 0) renderDate();
    renderDashboard();
    // Don't redraw a page while someone is typing in it.
    const typing = $('#alternatePage').contains(document.activeElement) && document.activeElement.matches('input, select, textarea');
    if (ui.page !== 'dashboard' && $('#modalBackdrop').hidden && !typing) renderPage(ui.page);
  }, 30000);
}

init();
