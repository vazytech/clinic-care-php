// Clinic Care — reference data and rules shared by the browser (loaded as a script)
// and the server (loaded with require). Keep this file free of browser- or Node-only code.

/* ---------- Reference data ---------- */

const VISIT_TYPES = ['General consultation', 'Follow-up', 'Wellness check', 'Vaccination', 'Dental check-up'];
const STATUSES = ['Confirmed', 'Checked in', 'Waiting', 'Completed', 'Cancelled'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SEXES = ['Female', 'Male', 'Intersex'];
const PAYERS = ['Cash', 'SHA', 'Private insurance'];
const PAYMENT_METHODS = ['Cash', 'M-Pesa', 'SHA', 'Insurance'];

// Demo prices in KES — replace with the clinic's real tariff.
const SERVICE_PRICES = {
  'General consultation': 1000,
  'Follow-up': 500,
  'Wellness check': 1500,
  'Vaccination': 300,
  'Dental check-up': 1500,
  'Blood pressure check': 300
};

// `cls` is used for allergy checks (e.g. a penicillin allergy blocks amoxicillin).
// `fixed` items are dispensed as one unit regardless of dose and duration.
const FORMULARY = [
  { name: 'Paracetamol 500mg tab', cls: 'analgesic', price: 2 },
  { name: 'Ibuprofen 400mg tab', cls: 'nsaid', price: 5 },
  { name: 'Amoxicillin 500mg cap', cls: 'penicillin', price: 10 },
  { name: 'Amoxicillin/clavulanate 625mg tab', cls: 'penicillin', price: 35 },
  { name: 'Azithromycin 500mg tab', cls: 'macrolide', price: 40 },
  { name: 'Ciprofloxacin 500mg tab', cls: 'fluoroquinolone', price: 15 },
  { name: 'Metronidazole 400mg tab', cls: 'nitroimidazole', price: 5 },
  { name: 'Co-trimoxazole 960mg tab', cls: 'sulfonamide', price: 6 },
  { name: 'Artemether/lumefantrine 20/120mg tab', cls: 'antimalarial', price: 12 },
  { name: 'Amlodipine 5mg tab', cls: 'calcium channel blocker', price: 5 },
  { name: 'Metformin 500mg tab', cls: 'biguanide', price: 4 },
  { name: 'Omeprazole 20mg cap', cls: 'ppi', price: 6 },
  { name: 'Cetirizine 10mg tab', cls: 'antihistamine', price: 5 },
  { name: 'Salbutamol 100mcg inhaler', cls: 'bronchodilator', price: 450, fixed: true },
  { name: 'ORS sachet', cls: 'rehydration', price: 20 }
];

const FREQUENCIES = { OD: 1, BD: 2, TDS: 3, QID: 4, PRN: 3 };
const FREQUENCY_LABELS = { OD: 'Once daily', BD: 'Twice daily', TDS: 'Three times daily', QID: 'Four times daily', PRN: 'As needed' };

const DIAGNOSES = [
  'A09 Diarrhoea and gastroenteritis',
  'B54 Malaria, unspecified',
  'E11.9 Type 2 diabetes mellitus',
  'I10 Essential (primary) hypertension',
  'J06.9 Acute upper respiratory infection',
  'J18.9 Pneumonia, unspecified',
  'J45.9 Asthma, unspecified',
  'K02.9 Dental caries, unspecified',
  'K29.7 Gastritis, unspecified',
  'L30.9 Dermatitis, unspecified',
  'M54.5 Low back pain',
  'N39.0 Urinary tract infection',
  'R50.9 Fever, unspecified',
  'Z00.0 General adult medical examination',
  'Z23 Encounter for immunization'
];

// Vital sign limits accepted on entry (anything outside is almost certainly a typo).
const VITAL_LIMITS = {
  sys: [50, 260], dia: [30, 160], temp: [30, 45], pulse: [20, 250],
  resp: [4, 60], spo2: [50, 100], weight: [0.5, 300], height: [30, 230]
};

/* ---------- Roles ---------- */

const ROLES = {
  admin: 'Clinic administrator',
  reception: 'Front desk',
  nurse: 'Nurse',
  doctor: 'Clinician'
};

const PERMISSIONS = {
  'patients.edit': ['admin', 'reception', 'nurse', 'doctor'],
  'patients.archive': ['admin'],
  'appointments.edit': ['admin', 'reception', 'nurse', 'doctor'],
  'clinical.view': ['admin', 'nurse', 'doctor'],
  'vitals.record': ['nurse', 'doctor'],
  'notes.write': ['doctor'],
  'billing.view': ['admin', 'reception'],
  'team.manage': ['admin']
};

function roleCan(role, perm) {
  return Boolean(PERMISSIONS[perm]?.includes(role));
}

/* ---------- Dates ---------- */

function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayISO() {
  return isoDate(new Date());
}

function parseISO(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- Rules ---------- */

// "Checked in" = arrived, awaiting triage; "Waiting" = triaged and ready for the clinician.
// Completing or cancelling the appointment takes the patient out of the waiting room.
function inWaitingRoom(a) {
  return a.status === 'Checked in' || a.status === 'Waiting';
}

function isOnDuty(member, date = new Date()) {
  return member.days.includes(date.getDay()) && !member.away.includes(isoDate(date));
}

function servicePrice(type) {
  const key = Object.keys(SERVICE_PRICES).find(k => String(type).startsWith(k));
  return key ? SERVICE_PRICES[key] : SERVICE_PRICES['General consultation'];
}

function drugByName(name) {
  return FORMULARY.find(d => d.name === name);
}

function prescriptionQty(drug, dose, freq, days) {
  return drug.fixed ? 1 : Math.ceil(dose * (FREQUENCIES[freq] ?? 1) * days);
}

// Returns the matching allergy term if the patient's recorded allergies cover this drug.
function allergyConflict(patient, drug) {
  const terms = String(patient?.allergies ?? '').toLowerCase().split(/[,;]/).map(t => t.trim()).filter(Boolean);
  const name = drug.name.toLowerCase();
  const cls = drug.cls.toLowerCase();
  return terms.find(t => {
    const stem = t.replace(/s$/, '').replace(/ drug$/, '');
    return name.includes(stem) || cls.includes(stem) || (stem.startsWith('sulfa') && cls === 'sulfonamide');
  });
}

function invoiceTotal(inv) {
  return inv.items.reduce((sum, i) => sum + i.qty * i.price, 0);
}

function invoicePaid(inv) {
  return inv.payments.reduce((sum, p) => sum + p.amount, 0);
}

function invoiceBalance(inv) {
  return invoiceTotal(inv) - invoicePaid(inv);
}

function invoiceStatus(inv) {
  const paid = invoicePaid(inv);
  return paid >= invoiceTotal(inv) ? 'Paid' : paid > 0 ? 'Part paid' : 'Unpaid';
}

/* ---------- Vitals assessment ---------- */

function bmi(v) {
  return v.weight && v.height ? v.weight / (v.height / 100) ** 2 : null;
}

// Adult reference ranges; flags are prompts for the clinician, not a diagnosis.
function vitalFlags(v) {
  const flags = [];
  const add = (level, label) => flags.push({ level, label });
  if (v.sys && v.dia) {
    if (v.sys >= 180 || v.dia >= 120) add('critical', `BP ${v.sys}/${v.dia} — very high`);
    else if (v.sys >= 140 || v.dia >= 90) add('warn', `BP ${v.sys}/${v.dia} — high`);
    else if (v.sys < 90) add('warn', `BP ${v.sys}/${v.dia} — low`);
  }
  if (v.temp) {
    if (v.temp >= 39.5) add('critical', `Temp ${v.temp} °C — high fever`);
    else if (v.temp >= 38) add('warn', `Temp ${v.temp} °C — fever`);
    else if (v.temp < 35.5) add('warn', `Temp ${v.temp} °C — low`);
  }
  if (v.pulse) {
    if (v.pulse > 130 || v.pulse < 40) add('critical', `Pulse ${v.pulse}`);
    else if (v.pulse > 100) add('warn', `Pulse ${v.pulse} — fast`);
    else if (v.pulse < 50) add('warn', `Pulse ${v.pulse} — slow`);
  }
  if (v.spo2) {
    if (v.spo2 < 90) add('critical', `SpO₂ ${v.spo2}%`);
    else if (v.spo2 < 94) add('warn', `SpO₂ ${v.spo2}% — low`);
  }
  if (v.resp && (v.resp > 24 || v.resp < 10)) add('warn', `Resp. rate ${v.resp}`);
  return flags;
}

if (typeof module !== 'undefined') {
  module.exports = {
    VISIT_TYPES, STATUSES, WEEKDAYS, SEXES, PAYERS, PAYMENT_METHODS, SERVICE_PRICES, FORMULARY,
    FREQUENCIES, FREQUENCY_LABELS, DIAGNOSES, VITAL_LIMITS, ROLES, PERMISSIONS, roleCan,
    localDate, isoDate, todayISO, parseISO, nowHHMM, inWaitingRoom, isOnDuty, servicePrice,
    drugByName, prescriptionQty, allergyConflict, invoiceTotal, invoicePaid, invoiceBalance,
    invoiceStatus, bmi, vitalFlags
  };
}
