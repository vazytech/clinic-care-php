<?php
// Vitals, consultations (with prescriptions and billing) and note amendments.

declare(strict_types=1);

function get_active_patient(string $id): array
{
    $p = q('SELECT id, name, allergies, archived FROM patients WHERE id = ?', [$id])->fetch();
    if (!$p) throw new HttpError(400, 'Choose a valid patient.');
    if ($p['archived']) throw new HttpError(400, 'That patient is archived.');
    return $p;
}

function patient_appointment(mixed $appointmentId, string $patientId): ?array
{
    if ($appointmentId === null || $appointmentId === '') return null;
    $appt = get_appointment((string) $appointmentId);
    if ($appt['patient_id'] !== $patientId) throw new HttpError(400, 'That appointment belongs to a different patient.');
    return $appt;
}

function route_vitals(array $user): array
{
    require_perm($user, 'vitals.record');
    $patientId = v_text(input('patientId'), 'patient', true, 20);
    $labels = ['sys' => 'systolic BP', 'dia' => 'diastolic BP', 'temp' => 'temperature', 'pulse' => 'pulse', 'resp' => 'respiratory rate', 'spo2' => 'SpO₂', 'weight' => 'weight', 'height' => 'height'];
    $v = [];
    foreach (VITAL_LIMITS as $key => $range) {
        $v[$key] = v_number(input($key), $labels[$key], $range, integer: !in_array($key, ['temp', 'weight', 'height'], true));
    }
    $measured = array_filter(array_diff_key($v, ['height' => 1]), fn ($x) => $x !== null);
    if (!$measured) throw new HttpError(400, 'Enter at least one measurement.');
    if (($v['sys'] === null) !== ($v['dia'] === null)) throw new HttpError(400, 'Enter both systolic and diastolic blood pressure.');

    $result = tx(function () use ($patientId, $v, $user) {
        get_active_patient($patientId);
        $appt = patient_appointment(input('appointmentId'), $patientId);
        $id = uuid();
        q('INSERT INTO vitals (id, patient_id, appointment_id, recorded_at, recorded_by, sys, dia, temp, pulse, resp, spo2, weight, height)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $patientId, $appt['id'] ?? null, now_str(), $user['id'], $v['sys'], $v['dia'], $v['temp'], $v['pulse'], $v['resp'], $v['spo2'], $v['weight'], $v['height']]);
        // Triage done: the patient is now ready for the clinician.
        $ready = ($appt['status'] ?? null) === 'Checked in';
        if ($ready) change_status($appt, 'Waiting');
        audit($user['id'], 'vitals.record', 'patient', $patientId, ['vitalsId' => $id]);
        return ['id' => $id, 'flags' => vital_flags($v), 'readyForClinician' => $ready];
    });
    http_response_code(201);
    return $result;
}

function route_consultation(array $user): array
{
    require_perm($user, 'notes.write');
    $patientId = v_text(input('patientId'), 'patient', true, 20);
    $note = [
        'type' => v_text(input('type'), 'visit type', true, 120),
        'complaint' => v_text(input('complaint'), 'presenting complaint', true, 4000),
        'findings' => v_text(input('findings'), 'examination findings', max: 4000),
        'diagnosis' => v_text(input('diagnosis'), 'diagnosis', true, 300),
        'plan' => v_text(input('plan'), 'plan', true, 4000),
    ];
    $lines = is_array(input('prescriptions')) ? input('prescriptions') : [];
    if (count($lines) > 20) throw new HttpError(400, 'Too many medicines on one prescription.');

    $result = tx(function () use ($patientId, $note, $lines, $user) {
        $patient = get_active_patient($patientId);
        $prescriptions = [];
        foreach ($lines as $line) {
            $drug = drug_by_name(is_array($line) ? ($line['drug'] ?? null) : null) ?? throw new HttpError(400, 'Choose medicines from the list.');
            $freq = $line['freq'] ?? null;
            if (!is_string($freq) || !isset(FREQUENCIES[$freq])) throw new HttpError(400, "Choose a valid frequency for {$drug['name']}.");
            $dose = (float) v_number($line['dose'] ?? null, "dose of {$drug['name']}", [0.5, 20], true);
            $days = (int) v_number($line['days'] ?? null, "number of days for {$drug['name']}", [1, 365], true, true);
            // The server makes the final allergy check, whatever the browser did.
            $allergy = allergy_conflict($patient['allergies'], $drug);
            if ($allergy !== null) throw new HttpError(400, "{$patient['name']} has a recorded allergy to $allergy — {$drug['name']} is a {$drug['cls']}. Remove it or choose another medicine.");
            $prescriptions[] = ['drug' => $drug, 'dose' => $dose, 'freq' => $freq, 'days' => $days, 'qty' => prescription_qty($drug, $dose, $freq, $days)];
        }
        $appt = patient_appointment(input('appointmentId'), $patientId);

        $noteId = uuid();
        q('INSERT INTO notes (id, patient_id, appointment_id, date, type, complaint, findings, diagnosis, plan, author_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$noteId, $patientId, $appt['id'] ?? null, today(), $note['type'], $note['complaint'], $note['findings'], $note['diagnosis'], $note['plan'], $user['id'], now_str()]);
        foreach ($prescriptions as $r) {
            q('INSERT INTO prescriptions (note_id, drug, dose, freq, days, qty) VALUES (?, ?, ?, ?, ?, ?)',
                [$noteId, $r['drug']['name'], $r['dose'], $r['freq'], $r['days'], $r['qty']]);
        }
        q('UPDATE patients SET visit = ? WHERE id = ?', [$note['type'], $patientId]);
        mark_visited($patientId, today());
        if ($appt) change_status($appt, 'Completed');

        // Bill the visit and dispensed medicines, adding to this appointment's invoice if one exists.
        $invoiceId = $appt ? q('SELECT id FROM invoices WHERE appointment_id = ?', [$appt['id']])->fetchColumn() : false;
        if (!$invoiceId) {
            $invoiceId = next_invoice_id();
            q('INSERT INTO invoices (id, patient_id, appointment_id, date) VALUES (?, ?, ?, ?)', [$invoiceId, $patientId, $appt['id'] ?? null, today()]);
        }
        $items = [['desc' => $note['type'], 'qty' => 1, 'price' => service_price($note['type'])]];
        foreach ($prescriptions as $r) $items[] = ['desc' => $r['drug']['name'], 'qty' => $r['qty'], 'price' => $r['drug']['price']];
        foreach ($items as $i) q('INSERT INTO invoice_items (invoice_id, description, qty, price) VALUES (?, ?, ?, ?)', [$invoiceId, $i['desc'], $i['qty'], $i['price']]);

        audit($user['id'], 'consultation.create', 'patient', $patientId, ['noteId' => $noteId, 'invoiceId' => $invoiceId]);
        return ['noteId' => $noteId, 'invoiceId' => $invoiceId, 'balance' => invoice_balance($invoiceId)];
    });
    http_response_code(201);
    return $result;
}

function route_note_amend(array $user, string $id): array
{
    require_perm($user, 'notes.write');
    $reason = v_text(input('reason'), 'reason for amendment', true, 300);
    $next = [
        'complaint' => v_text(input('complaint'), 'presenting complaint', max: 4000),
        'findings' => v_text(input('findings'), 'examination findings', max: 4000),
        'diagnosis' => v_text(input('diagnosis'), 'diagnosis', max: 300),
        'plan' => v_text(input('plan'), 'plan', max: 4000),
    ];
    tx(function () use ($id, $reason, $next, $user) {
        $note = q('SELECT id, patient_id, complaint, findings, diagnosis, plan FROM notes WHERE id = ? FOR UPDATE', [uuid_param($id)])->fetch();
        if (!$note) throw new HttpError(404, 'That note could not be found.');
        $previous = array_intersect_key($note, $next);
        if ($previous == $next) throw new HttpError(400, 'Nothing has changed.');
        q('INSERT INTO note_amendments (note_id, amended_at, amended_by, reason, previous) VALUES (?, ?, ?, ?, ?)',
            [$note['id'], now_str(), $user['id'], $reason, json_encode($previous, JSON_UNESCAPED_UNICODE)]);
        q('UPDATE notes SET complaint = ?, findings = ?, diagnosis = ?, plan = ? WHERE id = ?',
            [$next['complaint'], $next['findings'], $next['diagnosis'], $next['plan'], $note['id']]);
        audit($user['id'], 'note.amend', 'patient', $note['patient_id'], ['noteId' => $note['id'], 'reason' => $reason]);
    });
    return ['ok' => true];
}
