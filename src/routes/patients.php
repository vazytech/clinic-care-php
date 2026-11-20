<?php
// Patient registration, editing, archiving.

declare(strict_types=1);

function patient_input(): array
{
    $p = [
        'name' => v_text(input('name'), 'patient’s name', true, 120),
        'sex' => v_one_of(input('sex'), SEXES, 'sex'),
        'dob' => v_date(input('dob'), 'date of birth', required: false, notFuture: true),
        'phone' => v_text(input('phone'), 'phone number', max: 40),
        'nationalId' => v_text(input('nationalId'), 'national ID', max: 40),
        'allergies' => v_text(input('allergies'), 'allergies', max: 300),
        'conditions' => v_text(input('conditions'), 'conditions', max: 300),
        'kinName' => v_text(input('kinName'), 'next of kin', max: 120),
        'kinPhone' => v_text(input('kinPhone'), 'next of kin phone', max: 40),
        'payer' => v_one_of(input('payer'), PAYERS, 'payer'),
        'memberNo' => v_text(input('memberNo'), 'member number', max: 60),
    ];
    if ($p['payer'] !== 'Cash' && $p['memberNo'] === '') {
        throw new HttpError(400, "Enter the {$p['payer']} member number, or set the payer to Cash.");
    }
    return $p;
}

// Same name is allowed (common in practice); same name *and* birth date is almost certainly a duplicate.
function check_duplicate_patient(array $p, ?string $exceptId): void
{
    if (!$p['dob']) return;
    $dup = q('SELECT id, name FROM patients WHERE LOWER(name) = LOWER(?) AND dob = ? AND id <> ?', [$p['name'], $p['dob'], $exceptId ?? ''])->fetch();
    if ($dup) throw new HttpError(409, "{$dup['name']} ({$dup['id']}) is already registered with that date of birth.");
}

function route_patient_create(array $user): array
{
    require_perm($user, 'patients.edit');
    $p = patient_input();
    // Staff who can't see clinical details can't set them either.
    if (!role_can($user['role'], 'clinical.view')) $p['conditions'] = '';
    $id = tx(function () use ($p, $user) {
        check_duplicate_patient($p, null);
        $id = next_patient_id();
        q('INSERT INTO patients (id, name, sex, dob, phone, national_id, allergies, conditions, kin_name, kin_phone, payer, member_no, registered)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $p['name'], $p['sex'], $p['dob'], $p['phone'], $p['nationalId'], $p['allergies'], $p['conditions'], $p['kinName'], $p['kinPhone'], $p['payer'], $p['memberNo'], today()]);
        audit($user['id'], 'patient.create', 'patient', $id);
        return $id;
    });
    http_response_code(201);
    return ['id' => $id];
}

function route_patient_update(array $user, string $id): array
{
    require_perm($user, 'patients.edit');
    $p = patient_input();
    $clinical = role_can($user['role'], 'clinical.view');
    tx(function () use ($p, $id, $user, $clinical) {
        if (!q('SELECT 1 FROM patients WHERE id = ? FOR UPDATE', [$id])->fetch()) throw new HttpError(404, 'That patient record could not be found.');
        check_duplicate_patient($p, $id);
        q('UPDATE patients SET name = ?, sex = ?, dob = ?, phone = ?, national_id = ?, allergies = ?, kin_name = ?, kin_phone = ?, payer = ?, member_no = ?, updated_at = ? WHERE id = ?',
            [$p['name'], $p['sex'], $p['dob'], $p['phone'], $p['nationalId'], $p['allergies'], $p['kinName'], $p['kinPhone'], $p['payer'], $p['memberNo'], now_str(), $id]);
        if ($clinical) q('UPDATE patients SET conditions = ? WHERE id = ?', [$p['conditions'], $id]);
        audit($user['id'], 'patient.update', 'patient', $id);
    });
    return ['id' => $id];
}

function route_patient_archive(array $user, string $id): array
{
    require_perm($user, 'patients.archive');
    $cancelled = tx(function () use ($id, $user) {
        if (q('UPDATE patients SET archived = 1, updated_at = ? WHERE id = ?', [now_str(), $id])->rowCount() === 0
            && !q('SELECT 1 FROM patients WHERE id = ?', [$id])->fetch()) {
            throw new HttpError(404, 'That patient record could not be found.');
        }
        $n = q("UPDATE appointments SET status = 'Cancelled', arrived_at = NULL
                WHERE patient_id = ? AND date >= ? AND status = 'Confirmed'", [$id, today()])->rowCount();
        audit($user['id'], 'patient.archive', 'patient', $id, ['cancelledAppointments' => $n]);
        return $n;
    });
    return ['cancelled' => $cancelled];
}

function route_patient_restore(array $user, string $id): array
{
    require_perm($user, 'patients.archive');
    tx(function () use ($id, $user) {
        if (!q('SELECT 1 FROM patients WHERE id = ?', [$id])->fetch()) throw new HttpError(404, 'That patient record could not be found.');
        q('UPDATE patients SET archived = 0, updated_at = ? WHERE id = ?', [now_str(), $id]);
        audit($user['id'], 'patient.restore', 'patient', $id);
    });
    return ['ok' => true];
}
