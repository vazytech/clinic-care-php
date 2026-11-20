// Clinic Care — client data layer. Loads data from the server and talks to the API.
// Reference data and shared rules live in shared.js.

let state = { patients: [], appointments: [], team: [], notes: [], vitals: [], invoices: [] };

// Calls the API and returns the parsed JSON. Throws an Error whose message is safe to
// show the user; `status` is 401 when the session has expired.
async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw Object.assign(new Error('Can’t reach the server. Check the connection and try again.'), { status: 0 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `Something went wrong (${res.status}).`), { status: res.status });
  return data;
}

async function loadState() {
  state = await api('GET', '/api/bootstrap');
}

/* ---------- Queries ---------- */

function patientById(id) {
  return state.patients.find(p => p.id === id);
}

function patientName(record) {
  return patientById(record.patientId)?.name ?? 'Unknown patient';
}

function todaysAppointments() {
  const today = todayISO();
  return state.appointments.filter(a => a.date === today && a.status !== 'Cancelled');
}

function waitingRoom() {
  return todaysAppointments()
    .filter(inWaitingRoom)
    .sort((a, b) => (a.arrivedAt ?? a.time).localeCompare(b.arrivedAt ?? b.time));
}

function teamMember(name) {
  return state.team.find(m => m.name === name);
}

function patientVitals(patientId) {
  return state.vitals.filter(v => v.patientId === patientId).sort((a, b) => b.at.localeCompare(a.at));
}

function patientNotes(patientId) {
  return state.notes.filter(n => n.patientId === patientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
