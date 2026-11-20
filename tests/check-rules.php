<?php
// Confirms the server rules (src/rules.php) still match the browser rules
// (public/shared.js): same reference data, same allergy and vital-sign results.
// Run after changing either file:   php tests/check-rules.php   (needs Node.js)

declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit;
require dirname(__DIR__) . '/src/rules.php';

// Sample inputs covering every branch of the checks.
$allergies = ['Penicillin', 'Sulfa drugs', 'penicillins; nsaids', 'Peanuts', '', 'amoxicillin, ibuprofen'];
$vitals = [
    ['sys' => 185, 'dia' => 122], ['sys' => 145, 'dia' => 85], ['sys' => 85, 'dia' => 60], ['sys' => 120, 'dia' => 80],
    ['temp' => 39.5], ['temp' => 38.4], ['temp' => 35.0], ['temp' => 37.0],
    ['pulse' => 135], ['pulse' => 105], ['pulse' => 45], ['pulse' => 72],
    ['spo2' => 88], ['spo2' => 92], ['spo2' => 98], ['resp' => 28], ['resp' => 8],
];

function snapshot_php(array $allergies, array $vitals): array
{
    $conflicts = [];
    foreach ($allergies as $a) {
        foreach (FORMULARY as $drug) $conflicts[] = allergy_conflict($a, $drug);
    }
    return [
        'visitTypes' => VISIT_TYPES, 'statuses' => STATUSES, 'sexes' => SEXES, 'payers' => PAYERS,
        'paymentMethods' => PAYMENT_METHODS, 'servicePrices' => SERVICE_PRICES, 'formulary' => FORMULARY,
        'frequencies' => FREQUENCIES, 'vitalLimits' => VITAL_LIMITS, 'roles' => ROLES, 'permissions' => PERMISSIONS,
        'conflicts' => $conflicts, 'flags' => array_map('vital_flags', $vitals),
        'qty' => array_map(fn ($d) => prescription_qty($d, 1.5, 'TDS', 5), FORMULARY),
        'prices' => array_map('service_price', ['Follow-up · Blood pressure', 'Something else', 'Vaccination']),
    ];
}

$js = <<<'JS'
const s = require(process.argv[1]);
const [allergies, vitals] = JSON.parse(process.argv[2]);
const conflicts = [];
for (const a of allergies) for (const d of s.FORMULARY) conflicts.push(s.allergyConflict({ allergies: a }, d) ?? null);
console.log(JSON.stringify({
  visitTypes: s.VISIT_TYPES, statuses: s.STATUSES, sexes: s.SEXES, payers: s.PAYERS,
  paymentMethods: s.PAYMENT_METHODS, servicePrices: s.SERVICE_PRICES, formulary: s.FORMULARY,
  frequencies: s.FREQUENCIES, vitalLimits: s.VITAL_LIMITS, roles: s.ROLES, permissions: s.PERMISSIONS,
  conflicts, flags: vitals.map(s.vitalFlags),
  qty: s.FORMULARY.map(d => s.prescriptionQty(d, 1.5, 'TDS', 5)),
  prices: ['Follow-up · Blood pressure', 'Something else', 'Vaccination'].map(s.servicePrice)
}));
JS;

$cmd = 'node -e ' . escapeshellarg($js) . ' ' . escapeshellarg(dirname(__DIR__) . '/public/shared.js') . ' ' . escapeshellarg(json_encode([$allergies, $vitals]));
$output = shell_exec($cmd);
if (!$output) {
    fwrite(STDERR, "Couldn't run Node.js. Install it to use this check.\n");
    exit(2);
}

$browser = json_decode($output, true);
$server = json_decode(json_encode(snapshot_php($allergies, $vitals)), true);
$differences = 0;
foreach ($server as $key => $value) {
    if ($value !== $browser[$key]) {
        $differences++;
        echo "MISMATCH in $key\n  server (rules.php): " . json_encode($value, JSON_UNESCAPED_UNICODE) . "\n  browser (shared.js): " . json_encode($browser[$key], JSON_UNESCAPED_UNICODE) . "\n";
    }
}
echo $differences ? "$differences difference(s) — update rules.php and shared.js to match.\n" : "Rules match: rules.php and shared.js agree.\n";
exit($differences ? 1 : 0);
