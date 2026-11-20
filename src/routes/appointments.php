<?php
// Booking, rescheduling, check-in and status changes.

declare(strict_types=1);

function get_appointment(string $id): array
{
    $a = q('SELECT id, patient_id, date, time, doctor, type, status, arrived_at FROM appointments WHERE id = ? FOR UPDATE', [uuid_param($id)])->fetch();
    if (!$a) throw new HttpError(404, 'That appointment could not be found.');
    return $a;
}

function mark_visited(string $patientId, string $date): void
{
    q('UPDATE patients SET last_visit = GREATEST(COALESCE(last_visit, ?), ?) WHERE id = ?', [$date, $date, $patientId]);
}

// Applies a status change with the same rules the screens show: arriving records the
// arrival time; leaving the waiting room any way other than completing clears it.
function change_status(array $appt, string $status): void
{
    if ($status === $appt['status']) return;
    $arrivedAt = $appt['arrived_at'];
    if (in_waiting_room($status) && !in_waiting_room($appt['status'])) $arrivedAt = $appt['date'] === today() ? now_hhmm() : $appt['time'];
    if (!in_waiting_room($status) && $status !== 'Completed') $arrivedAt = null;
    q('UPDATE appointments SET status = ?, arrived_at = ? WHERE id = ?', [$status, $arrivedAt, $appt['id']]);
    if ($status === 'Checked in' || $status === 'Completed') mark_visited($appt['patient_id'], $appt['date']);
}

function check_bookable_patient(string $patientId): void
{
    $p = q('SELECT archived FROM patients WHERE id = ?', [$patientId])->fetch();
    if (!$p) throw new HttpError(400, 'Choose a valid patient.');
    if ($p['archived']) throw new HttpError(400, 'That patient is archived. Restore them before booking.');
}

function check_practitioner(string $name): void
{
    if (!q('SELECT 1 FROM team_members WHERE name = ?', [$name])->fetch()) throw new HttpError(400, 'Choose a valid practitioner.');
}

function booking_input(): array
{
    return [
        'patientId' => v_text(input('patientId'), 'patient', true, 20),
        'date' => v_date(input('date'), 'date'),
        'time' => v_time(input('time')),
        'doctor' => v_text(input('doctor'), 'practitioner', true, 120),
        'type' => v_text(input('type'), 'appointment type', true, 120),
    ];
}

function route_appointment_create(array $user): array
{
    require_perm($user, 'appointments.edit');
    $b = booking_input();
    $id = tx(function () use ($b, $user) {
        check_bookable_patient($b['patientId']);
        check_practitioner($b['doctor']);
        $id = uuid();
        q("INSERT INTO appointments (id, patient_id, date, time, doctor, type, status) VALUES (?, ?, ?, ?, ?, ?, 'Confirmed')",
            [$id, $b['patientId'], $b['date'], $b['time'], $b['doctor'], $b['type']]);
        audit($user['id'], 'appointment.create', 'appointment', $id, $b);
        return $id;
    });
    http_response_code(201);
    return ['id' => $id];
}

function route_appointment_update(array $user, string $id): array
{
    require_perm($user, 'appointments.edit');
    $b = booking_input();
    $status = v_one_of(input('status'), STATUSES, 'status');
    tx(function () use ($b, $status, $id, $user) {
        $appt = get_appointment($id);
        if ($b['patientId'] !== $appt['patient_id']) check_bookable_patient($b['patientId']);
        check_practitioner($b['doctor']);
        q('UPDATE appointments SET patient_id = ?, date = ?, time = ?, doctor = ?, type = ? WHERE id = ?',
            [$b['patientId'], $b['date'], $b['time'], $b['doctor'], $b['type'], $appt['id']]);
        change_status(['patient_id' => $b['patientId'], 'date' => $b['date'], 'time' => $b['time']] + $appt, $status);
        audit($user['id'], 'appointment.update', 'appointment', $appt['id'], $b + ['status' => $status]);
    });
    return ['ok' => true];
}

function route_appointment_status(array $user, string $id): array
{
    require_perm($user, 'appointments.edit');
    $status = v_one_of(input('status'), STATUSES, 'status');
    tx(function () use ($status, $id, $user) {
        $appt = get_appointment($id);
        change_status($appt, $status);
        audit($user['id'], 'appointment.status', 'appointment', $appt['id'], ['from' => $appt['status'], 'to' => $status]);
    });
    return ['ok' => true];
}

function route_walk_in(array $user): array
{
    require_perm($user, 'appointments.edit');
    $patientId = v_text(input('patientId'), 'patient', true, 20);
    $doctor = v_text(input('doctor'), 'practitioner', true, 120);
    $type = v_text(input('type'), 'reason for visit', true, 120);
    $id = tx(function () use ($patientId, $doctor, $type, $user) {
        check_bookable_patient($patientId);
        check_practitioner($doctor);
        $id = uuid();
        $now = now_hhmm();
        q("INSERT INTO appointments (id, patient_id, date, time, doctor, type, status, arrived_at, walk_in) VALUES (?, ?, ?, ?, ?, ?, 'Checked in', ?, 1)",
            [$id, $patientId, today(), $now, $doctor, $type, $now]);
        mark_visited($patientId, today());
        audit($user['id'], 'appointment.walk_in', 'appointment', $id, compact('patientId', 'doctor', 'type'));
        return $id;
    });
    http_response_code(201);
    return ['id' => $id];
}
