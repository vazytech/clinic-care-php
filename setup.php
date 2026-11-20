<?php
// Creates the database tables and, on an empty database, the first user accounts.
//
//   php setup.php            tables + staff accounts + demo patients
//   php setup.php --no-demo  tables + staff accounts only (for real use)
//
// Prints a one-time password for each new account. Safe to run again: it never
// changes existing data.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/src/app.php';

const USERS = [
    ['alex', 'Alex Morgan', 'admin'],
    ['faith', 'Faith Njeri', 'reception'],
    ['peter', 'Peter Wambua', 'nurse'],
    ['james', 'Dr. James Mwangi', 'doctor'],
    ['sarah', 'Dr. Sarah Kimani', 'doctor'],
];

const TEAM = [
    ['Dr. James Mwangi', 'General practitioner', '1,2,3,4,5'],
    ['Dr. Sarah Kimani', 'Family medicine', '1,2,3,4,5'],
    ['Dr. Leah Otieno', 'Paediatrician', '1,3,5'],
    ['Peter Wambua', 'Registered nurse', '1,2,3,4,5,6'],
    ['Dr. Brian Ochieng', 'Dental surgeon', '2,4'],
    ['Grace Achieng', 'Clinical officer', '0,6'],
];

// Changes for databases created by an earlier version. Each step checks first, so
// running setup again is always safe.
function migrate(): void
{
    $hasColumn = fn (string $table, string $column) => (bool) q(
        'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [$table, $column]
    )->fetchColumn();
    if (!$hasColumn('users', 'status')) {
        db()->exec("ALTER TABLE users ADD COLUMN status ENUM('pending', 'active', 'rejected') NOT NULL DEFAULT 'active' AFTER active");
        echo "Added account approval (users.status).\n";
    }
}

function day(int $offset): string
{
    return date('Y-m-d', strtotime("$offset days"));
}

function seed_demo(array $userIds): void
{
    $patients = [
        ['Miriam Wekesa', 'Female', '1968-05-27', '+254 711 604 218', 'Sulfa drugs', 'Hypertension, Type 2 diabetes', '', '', 'SHA', 'SHA-0937716', -365],
        ['Noah Kiptoo', 'Male', '2002-10-09', '+254 722 913 057', '', '', '', '', 'Cash', '', -200],
        ['Zuri Mwende', 'Female', '2018-06-30', '+254 710 287 331', '', '', 'Agnes Mwende', '+254 710 287 330', 'SHA', 'SHA-1180274', -120],
        ['Peter Otieno', 'Male', '1975-02-11', '+254 733 410 285', 'Penicillin', '', 'Ruth Otieno', '+254 733 222 019', 'Cash', '', -40],
        ['Lila Wanjiku', 'Female', '1997-12-03', '+254 701 853 902', '', '', '', '', 'Cash', '', -6],
        ['David Kamau', 'Male', '1983-08-22', '+254 722 180 449', '', 'Hypertension', '', '', 'Private insurance', 'PI-88213', -4],
        ['Amara Njoroge', 'Female', '1991-04-16', '+254 712 345 678', '', '', 'Joseph Njoroge', '+254 712 000 111', 'SHA', 'SHA-4471023', -1],
    ];
    $ids = [];
    foreach ($patients as [$name, $sex, $dob, $phone, $allergies, $conditions, $kinName, $kinPhone, $payer, $memberNo, $registered]) {
        $ids[$name] = next_patient_id();
        q('INSERT INTO patients (id, name, sex, dob, phone, allergies, conditions, kin_name, kin_phone, payer, member_no, registered)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$ids[$name], $name, $sex, $dob, $phone, $allergies, $conditions, $kinName, $kinPhone, $payer, $memberNo, day($registered)]);
    }

    $appt = function (string $name, int $offset, string $time, string $type, string $doctor, string $status, ?string $arrivedAt = null) use ($ids): string {
        $id = uuid();
        q('INSERT INTO appointments (id, patient_id, date, time, doctor, type, status, arrived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $ids[$name], day($offset), $time, $doctor, $type, $status, $arrivedAt]);
        if ($arrivedAt) q('UPDATE patients SET last_visit = ? WHERE id = ?', [day($offset), $ids[$name]]);
        return $id;
    };
    $yesterday = $appt('Peter Otieno', -1, '14:00', 'General consultation', 'Dr. James Mwangi', 'Completed', '13:52');
    $appt('Amara Njoroge', 0, '09:00', 'General consultation', 'Dr. James Mwangi', 'Checked in', '08:54');
    $appt('Miriam Wekesa', 0, '09:15', 'Blood pressure check', 'Dr. Sarah Kimani', 'Checked in', '09:22');
    $david = $appt('David Kamau', 0, '09:30', 'Follow-up · Blood pressure', 'Dr. Sarah Kimani', 'Waiting', '09:18');
    $appt('Lila Wanjiku', 0, '10:15', 'Wellness check', 'Dr. Leah Otieno', 'Confirmed');
    $appt('Peter Otieno', 0, '11:00', 'General consultation', 'Dr. James Mwangi', 'Confirmed');
    $appt('Zuri Mwende', 0, '11:30', 'Vaccination', 'Peter Wambua', 'Confirmed');

    $vitals = 'INSERT INTO vitals (id, patient_id, appointment_id, recorded_at, recorded_by, sys, dia, temp, pulse, resp, spo2, weight, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    q($vitals, [uuid(), $ids['David Kamau'], $david, day(0) . ' 09:24', $userIds['peter'], 148, 94, 36.7, 82, 16, 98, 88, 176]);
    q($vitals, [uuid(), $ids['Peter Otieno'], $yesterday, day(-1) . ' 13:58', $userIds['peter'], 128, 82, 38.4, 96, 18, 97, 74, 171]);
    q($vitals, [uuid(), $ids['Miriam Wekesa'], null, day(-30) . ' 10:05', $userIds['peter'], 152, 96, 36.5, 78, 16, 97, 81, 163]);

    $noteId = uuid();
    q('INSERT INTO notes (id, patient_id, appointment_id, date, type, complaint, findings, diagnosis, plan, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        $noteId, $ids['Peter Otieno'], $yesterday, day(-1), 'General consultation', 'Cough and fever for 3 days, sore throat.',
        'Temp 38.4 °C. Throat inflamed, chest clear on auscultation.', 'J06.9 Acute upper respiratory infection',
        'Symptomatic treatment, plenty of fluids. Return if not improving in 5 days or if breathing becomes difficult.',
        $userIds['james'], day(-1) . ' 14:20',
    ]);
    q("INSERT INTO prescriptions (note_id, drug, dose, freq, days, qty) VALUES (?, 'Paracetamol 500mg tab', 2, 'TDS', 5, 30)", [$noteId]);

    $inv1 = next_invoice_id();
    q('INSERT INTO invoices (id, patient_id, appointment_id, date) VALUES (?, ?, ?, ?)', [$inv1, $ids['Peter Otieno'], $yesterday, day(-1)]);
    q("INSERT INTO invoice_items (invoice_id, description, qty, price) VALUES (?, 'General consultation', 1, 1000), (?, 'Paracetamol 500mg tab', 30, 2)", [$inv1, $inv1]);
    q("INSERT INTO payments (invoice_id, method, amount, ref, paid_at, received_by) VALUES (?, 'M-Pesa', 1060, 'SKL4H7Q2RT', ?, ?)", [$inv1, day(-1) . ' 14:31', $userIds['faith']]);

    $inv2 = next_invoice_id();
    q('INSERT INTO invoices (id, patient_id, date) VALUES (?, ?, ?)', [$inv2, $ids['Noah Kiptoo'], day(-5)]);
    q("INSERT INTO invoice_items (invoice_id, description, qty, price) VALUES (?, 'Dental check-up', 1, 1500)", [$inv2]);
    q("INSERT INTO payments (invoice_id, method, amount, paid_at, received_by) VALUES (?, 'Cash', 500, ?, ?)", [$inv2, day(-5) . ' 11:10', $userIds['faith']]);
}

try {
    $demo = !in_array('--no-demo', $argv, true);
    // Run each CREATE statement separately (comments stripped first).
    $schema = preg_replace('/^\s*--.*$/m', '', file_get_contents(__DIR__ . '/database/schema.sql'));
    foreach (array_filter(array_map('trim', explode(';', $schema))) as $statement) db()->exec($statement);
    migrate();
    echo "Tables are ready.\n";

    if ((int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
        echo "Accounts already exist, so nothing else was changed.\n";
        exit(0);
    }

    $passwords = [];
    tx(function () use ($demo, &$passwords) {
        $userIds = [];
        foreach (USERS as [$username, $name, $role]) {
            $password = rtrim(strtr(base64_encode(random_bytes(9)), '+/', '-_'), '=');
            q('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)', [$username, $name, $role, password_hash($password, PASSWORD_DEFAULT)]);
            $userIds[$username] = (int) db()->lastInsertId();
            $passwords[] = [$username, $name, $password];
        }
        foreach (TEAM as [$name, $role, $days]) q('INSERT INTO team_members (name, role, days) VALUES (?, ?, ?)', [$name, $role, $days]);
        if ($demo) seed_demo($userIds);
    });

    echo $demo ? "Demo patients, appointments and invoices added.\n" : "No demo data added.\n";
    echo "\nSign-in accounts — save these passwords now, they will not be shown again:\n\n";
    foreach ($passwords as [$username, $name, $password]) printf("  %-8s %s   (%s)\n", $username, $password, $name);
    echo "\nChange a password any time with: php scripts/set-password.php <username>\n\n";
} catch (PDOException $e) {
    fwrite(STDERR, 'Database error: ' . $e->getMessage() . "\nCheck the database settings in config.php.\n");
    exit(1);
}
