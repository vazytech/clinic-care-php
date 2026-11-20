<?php
// Invoices and payments.

declare(strict_types=1);

function route_invoice_create(array $user): array
{
    require_perm($user, 'billing.view');
    $patientId = v_text(input('patientId'), 'patient', true, 20);
    $service = v_one_of(input('service'), array_keys(SERVICE_PRICES), 'service');
    $qty = (int) v_number(input('qty'), 'quantity', [1, 50], true, true);
    $id = tx(function () use ($patientId, $service, $qty, $user) {
        if (!q('SELECT 1 FROM patients WHERE id = ?', [$patientId])->fetch()) throw new HttpError(400, 'Choose a valid patient.');
        $id = next_invoice_id();
        q('INSERT INTO invoices (id, patient_id, date) VALUES (?, ?, ?)', [$id, $patientId, today()]);
        q('INSERT INTO invoice_items (invoice_id, description, qty, price) VALUES (?, ?, ?, ?)', [$id, $service, $qty, SERVICE_PRICES[$service]]);
        audit($user['id'], 'invoice.create', 'invoice', $id, compact('patientId', 'service', 'qty'));
        return $id;
    });
    http_response_code(201);
    return ['id' => $id];
}

function route_payment(array $user, string $id): array
{
    require_perm($user, 'billing.view');
    $method = v_one_of(input('method'), PAYMENT_METHODS, 'payment method');
    $ref = strtoupper(v_text(input('ref'), 'reference', max: 60));
    if ($method === 'M-Pesa' && !preg_match('/^[A-Z0-9]{10}$/', $ref)) throw new HttpError(400, 'Enter the 10-character M-Pesa transaction code, e.g. SKL4H7Q2RT.');
    if (($method === 'SHA' || $method === 'Insurance') && $ref === '') throw new HttpError(400, "Enter the $method claim or member number.");

    $balance = tx(function () use ($id, $method, $ref, $user) {
        // Lock the invoice so two cashiers can't both take the last balance.
        if (!q('SELECT id FROM invoices WHERE id = ? FOR UPDATE', [$id])->fetch()) throw new HttpError(404, 'That invoice could not be found.');
        $due = invoice_balance($id);
        if ($due <= 0) throw new HttpError(400, 'This invoice is already paid.');
        $amount = (int) v_number(input('amount'), 'amount', [1, $due], true, true);
        if ($method === 'M-Pesa') {
            $used = q("SELECT invoice_id FROM payments WHERE method = 'M-Pesa' AND ref = ?", [$ref])->fetchColumn();
            if ($used) throw new HttpError(409, "M-Pesa code $ref has already been used on $used.");
        }
        q('INSERT INTO payments (invoice_id, method, amount, ref, paid_at, received_by) VALUES (?, ?, ?, ?, ?, ?)',
            [$id, $method, $amount, $ref, now_str(), $user['id']]);
        audit($user['id'], 'payment.record', 'invoice', $id, compact('method', 'amount', 'ref'));
        return $due - $amount;
    });
    http_response_code(201);
    return ['balance' => $balance];
}
