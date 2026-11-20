<?php
// GET /api/bootstrap — everything the signed-in user's screens need, filtered by role.

declare(strict_types=1);

const STAMP = "'%Y-%m-%dT%H:%i:%s'";

function num_or_null(mixed $v): int|float|null
{
    return $v === null ? null : $v + 0;
}

function group_by(array $rows, string $key): array
{
    $groups = [];
    foreach ($rows as $row) {
        $k = $row[$key];
        unset($row[$key]);
        $groups[$k][] = $row;
    }
    return $groups;
}

function route_bootstrap(array $user): array
{
    $clinical = role_can($user['role'], 'clinical.view');
    $billing = role_can($user['role'], 'billing.view');

    $patients = array_map(fn ($p) => [
        'id' => $p['id'], 'name' => $p['name'], 'sex' => $p['sex'], 'dob' => $p['dob'], 'phone' => $p['phone'],
        'nationalId' => $p['national_id'], 'allergies' => $p['allergies'],
        'conditions' => $clinical ? $p['conditions'] : '',
        'kinName' => $p['kin_name'], 'kinPhone' => $p['kin_phone'], 'payer' => $p['payer'], 'memberNo' => $p['member_no'],
        'visit' => $p['visit'], 'lastVisit' => $p['last_visit'], 'registered' => $p['registered'], 'archived' => (bool) $p['archived'],
    ], q('SELECT * FROM patients ORDER BY created_at DESC, id DESC')->fetchAll());

    $appointments = array_map(fn ($a) => [
        'id' => $a['id'], 'patientId' => $a['patient_id'], 'date' => $a['date'], 'time' => $a['time'], 'doctor' => $a['doctor'],
        'type' => $a['type'], 'status' => $a['status'], 'arrivedAt' => $a['arrived_at'], 'walkIn' => (bool) $a['walk_in'],
    ], q('SELECT * FROM appointments ORDER BY date, time')->fetchAll());

    $away = group_by(q('SELECT member_id, date FROM team_away WHERE date >= ?', [today()])->fetchAll(), 'member_id');
    $team = array_map(fn ($m) => [
        'id' => $m['id'], 'name' => $m['name'], 'role' => $m['role'],
        'days' => $m['days'] === '' ? [] : array_map('intval', explode(',', $m['days'])),
        'away' => array_column($away[$m['id']] ?? [], 'date'),
    ], q('SELECT * FROM team_members ORDER BY id')->fetchAll());

    $data = ['patients' => $patients, 'appointments' => $appointments, 'team' => $team, 'vitals' => [], 'notes' => [], 'invoices' => [], 'accountRequests' => []];

    // Administrators see account requests waiting for approval.
    if (role_can($user['role'], 'team.manage')) {
        $data['accountRequests'] = q("SELECT id, name, username, DATE_FORMAT(created_at, " . STAMP . ") AS requestedAt
                                      FROM users WHERE status = 'pending' ORDER BY created_at")->fetchAll();
    }

    if ($clinical) {
        $data['vitals'] = array_map(fn ($v) => [
            'id' => $v['id'], 'patientId' => $v['patient_id'], 'appointmentId' => $v['appointment_id'], 'at' => $v['at'], 'by' => $v['by_name'],
            'sys' => $v['sys'], 'dia' => $v['dia'], 'temp' => num_or_null($v['temp']), 'pulse' => $v['pulse'], 'resp' => $v['resp'],
            'spo2' => $v['spo2'], 'weight' => num_or_null($v['weight']), 'height' => num_or_null($v['height']),
        ], q('SELECT v.*, DATE_FORMAT(v.recorded_at, ' . STAMP . ') AS at, u.name AS by_name
              FROM vitals v LEFT JOIN users u ON u.id = v.recorded_by')->fetchAll());

        $rx = group_by(array_map(fn ($r) => ['note_id' => $r['note_id'], 'drug' => $r['drug'], 'dose' => $r['dose'] + 0, 'freq' => $r['freq'], 'days' => $r['days'], 'qty' => $r['qty']],
            q('SELECT * FROM prescriptions ORDER BY id')->fetchAll()), 'note_id');
        $amendments = group_by(array_map(fn ($a) => ['note_id' => $a['note_id'], 'at' => $a['at'], 'by' => $a['by_name'], 'reason' => $a['reason'], 'previous' => json_decode($a['previous'], true)],
            q('SELECT a.*, DATE_FORMAT(a.amended_at, ' . STAMP . ') AS at, u.name AS by_name
               FROM note_amendments a LEFT JOIN users u ON u.id = a.amended_by ORDER BY a.id')->fetchAll()), 'note_id');
        $data['notes'] = array_map(fn ($n) => [
            'id' => $n['id'], 'patientId' => $n['patient_id'], 'appointmentId' => $n['appointment_id'], 'date' => $n['date'], 'type' => $n['type'],
            'complaint' => $n['complaint'], 'findings' => $n['findings'], 'diagnosis' => $n['diagnosis'], 'plan' => $n['plan'],
            'author' => $n['author'], 'createdAt' => $n['created'],
            'prescriptions' => $rx[$n['id']] ?? [], 'amendments' => $amendments[$n['id']] ?? [],
        ], q('SELECT n.*, u.name AS author, DATE_FORMAT(n.created_at, ' . STAMP . ') AS created
              FROM notes n LEFT JOIN users u ON u.id = n.author_id')->fetchAll());
    }

    if ($billing) {
        $items = group_by(q('SELECT invoice_id, description AS `desc`, qty, price FROM invoice_items ORDER BY id')->fetchAll(), 'invoice_id');
        $payments = group_by(q('SELECT p.invoice_id, p.method, p.amount, p.ref, DATE_FORMAT(p.paid_at, ' . STAMP . ') AS at, u.name AS `by`
                                FROM payments p LEFT JOIN users u ON u.id = p.received_by ORDER BY p.id')->fetchAll(), 'invoice_id');
        $data['invoices'] = array_map(fn ($i) => [
            'id' => $i['id'], 'patientId' => $i['patient_id'], 'appointmentId' => $i['appointment_id'], 'date' => $i['date'],
            'items' => $items[$i['id']] ?? [], 'payments' => $payments[$i['id']] ?? [],
        ], q('SELECT * FROM invoices ORDER BY id')->fetchAll());
    }

    return $data;
}
