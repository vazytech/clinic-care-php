<?php
// Reference data and clinical/billing rules.
//
// These mirror public/shared.js, which the browser uses. If you change one, change
// the other to match — then run `php tests/check-rules.php` (needs Node) to confirm
// the two still agree.

declare(strict_types=1);

const VISIT_TYPES = ['General consultation', 'Follow-up', 'Wellness check', 'Vaccination', 'Dental check-up'];
const STATUSES = ['Confirmed', 'Checked in', 'Waiting', 'Completed', 'Cancelled'];
const SEXES = ['Female', 'Male', 'Intersex'];
const PAYERS = ['Cash', 'SHA', 'Private insurance'];
const PAYMENT_METHODS = ['Cash', 'M-Pesa', 'SHA', 'Insurance'];

// Demo prices in KES — replace with the clinic's real tariff.
const SERVICE_PRICES = [
    'General consultation' => 1000,
    'Follow-up' => 500,
    'Wellness check' => 1500,
    'Vaccination' => 300,
    'Dental check-up' => 1500,
    'Blood pressure check' => 300,
];

// `cls` is used for allergy checks (e.g. a penicillin allergy blocks amoxicillin).
// `fixed` items are dispensed as one unit regardless of dose and duration.
const FORMULARY = [
    ['name' => 'Paracetamol 500mg tab', 'cls' => 'analgesic', 'price' => 2],
    ['name' => 'Ibuprofen 400mg tab', 'cls' => 'nsaid', 'price' => 5],
    ['name' => 'Amoxicillin 500mg cap', 'cls' => 'penicillin', 'price' => 10],
    ['name' => 'Amoxicillin/clavulanate 625mg tab', 'cls' => 'penicillin', 'price' => 35],
    ['name' => 'Azithromycin 500mg tab', 'cls' => 'macrolide', 'price' => 40],
    ['name' => 'Ciprofloxacin 500mg tab', 'cls' => 'fluoroquinolone', 'price' => 15],
    ['name' => 'Metronidazole 400mg tab', 'cls' => 'nitroimidazole', 'price' => 5],
    ['name' => 'Co-trimoxazole 960mg tab', 'cls' => 'sulfonamide', 'price' => 6],
    ['name' => 'Artemether/lumefantrine 20/120mg tab', 'cls' => 'antimalarial', 'price' => 12],
    ['name' => 'Amlodipine 5mg tab', 'cls' => 'calcium channel blocker', 'price' => 5],
    ['name' => 'Metformin 500mg tab', 'cls' => 'biguanide', 'price' => 4],
    ['name' => 'Omeprazole 20mg cap', 'cls' => 'ppi', 'price' => 6],
    ['name' => 'Cetirizine 10mg tab', 'cls' => 'antihistamine', 'price' => 5],
    ['name' => 'Salbutamol 100mcg inhaler', 'cls' => 'bronchodilator', 'price' => 450, 'fixed' => true],
    ['name' => 'ORS sachet', 'cls' => 'rehydration', 'price' => 20],
];

const FREQUENCIES = ['OD' => 1, 'BD' => 2, 'TDS' => 3, 'QID' => 4, 'PRN' => 3];

// Vital sign limits accepted on entry (anything outside is almost certainly a typo).
const VITAL_LIMITS = [
    'sys' => [50, 260], 'dia' => [30, 160], 'temp' => [30, 45], 'pulse' => [20, 250],
    'resp' => [4, 60], 'spo2' => [50, 100], 'weight' => [0.5, 300], 'height' => [30, 230],
];

const ROLES = [
    'admin' => 'Clinic administrator',
    'reception' => 'Front desk',
    'nurse' => 'Nurse',
    'doctor' => 'Clinician',
];

const PERMISSIONS = [
    'patients.edit' => ['admin', 'reception', 'nurse', 'doctor'],
    'patients.archive' => ['admin'],
    'appointments.edit' => ['admin', 'reception', 'nurse', 'doctor'],
    'clinical.view' => ['admin', 'nurse', 'doctor'],
    'vitals.record' => ['nurse', 'doctor'],
    'notes.write' => ['doctor'],
    'billing.view' => ['admin', 'reception'],
    'team.manage' => ['admin'],
];

function role_can(string $role, string $perm): bool
{
    return in_array($role, PERMISSIONS[$perm] ?? [], true);
}

// "Checked in" = arrived, awaiting triage; "Waiting" = triaged and ready for the clinician.
function in_waiting_room(string $status): bool
{
    return $status === 'Checked in' || $status === 'Waiting';
}

function service_price(string $type): int
{
    foreach (SERVICE_PRICES as $name => $price) {
        if (str_starts_with($type, $name)) return $price;
    }
    return SERVICE_PRICES['General consultation'];
}

function drug_by_name(mixed $name): ?array
{
    foreach (FORMULARY as $drug) {
        if ($drug['name'] === $name) return $drug;
    }
    return null;
}

function prescription_qty(array $drug, float $dose, string $freq, int $days): int
{
    return !empty($drug['fixed']) ? 1 : (int) ceil($dose * (FREQUENCIES[$freq] ?? 1) * $days);
}

// Returns the matching allergy term if the patient's recorded allergies cover this drug.
function allergy_conflict(string $allergies, array $drug): ?string
{
    $name = strtolower($drug['name']);
    $cls = strtolower($drug['cls']);
    foreach (preg_split('/[,;]/', strtolower($allergies)) as $term) {
        $term = trim($term);
        if ($term === '') continue;
        $stem = preg_replace('/ drug$/', '', preg_replace('/s$/', '', $term));
        if (str_contains($name, $stem) || str_contains($cls, $stem) || (str_starts_with($stem, 'sulfa') && $cls === 'sulfonamide')) {
            return $term;
        }
    }
    return null;
}

// Formats a number the way JavaScript does in text (38.0 → "38", 38.4 → "38.4").
function js_number(int|float $n): string
{
    return rtrim(rtrim(number_format((float) $n, 1, '.', ''), '0'), '.');
}

// Adult reference ranges; flags are prompts for the clinician, not a diagnosis.
function vital_flags(array $v): array
{
    $flags = [];
    $add = function (string $level, string $label) use (&$flags) { $flags[] = ['level' => $level, 'label' => $label]; };
    [$sys, $dia, $temp, $pulse, $spo2, $resp] = [$v['sys'] ?? null, $v['dia'] ?? null, $v['temp'] ?? null, $v['pulse'] ?? null, $v['spo2'] ?? null, $v['resp'] ?? null];
    if ($sys && $dia) {
        $bp = js_number($sys) . '/' . js_number($dia);
        if ($sys >= 180 || $dia >= 120) $add('critical', "BP $bp — very high");
        elseif ($sys >= 140 || $dia >= 90) $add('warn', "BP $bp — high");
        elseif ($sys < 90) $add('warn', "BP $bp — low");
    }
    if ($temp) {
        $t = js_number($temp);
        if ($temp >= 39.5) $add('critical', "Temp $t °C — high fever");
        elseif ($temp >= 38) $add('warn', "Temp $t °C — fever");
        elseif ($temp < 35.5) $add('warn', "Temp $t °C — low");
    }
    if ($pulse) {
        $p = js_number($pulse);
        if ($pulse > 130 || $pulse < 40) $add('critical', "Pulse $p");
        elseif ($pulse > 100) $add('warn', "Pulse $p — fast");
        elseif ($pulse < 50) $add('warn', "Pulse $p — slow");
    }
    if ($spo2) {
        $s = js_number($spo2);
        if ($spo2 < 90) $add('critical', "SpO₂ $s%");
        elseif ($spo2 < 94) $add('warn', "SpO₂ $s% — low");
    }
    if ($resp && ($resp > 24 || $resp < 10)) $add('warn', 'Resp. rate ' . js_number($resp));
    return $flags;
}
