<?php
// Database connection and small helpers shared by the routes.

declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config()['db'];
        $pdo = new PDO($c['dsn'], $c['user'], $c['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,   // real prepared statements
            PDO::ATTR_STRINGIFY_FETCHES => false,  // integers come back as integers
        ]);
        // Kenya has no daylight saving, so a fixed offset is exact; named time zones
        // would need extra tables loaded into MySQL.
        $pdo->exec("SET time_zone = '" . (new DateTime())->format('P') . "'");
    }
    return $pdo;
}

// Runs a prepared query with positional (?) parameters.
function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

// Runs $fn inside a transaction; rolls back if it throws.
function tx(callable $fn): mixed
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $fn();
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function audit(?int $userId, string $action, ?string $entity = null, ?string $entityId = null, mixed $detail = null): void
{
    q('INSERT INTO audit_log (at, user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)', [
        now_str(), $userId, $action, $entity, $entityId,
        $detail === null ? null : json_encode($detail, JSON_UNESCAPED_UNICODE),
    ]);
}

// Next value of a running number. Safe under concurrency: the UPDATE locks the row.
function next_number(string $counter): int
{
    q('INSERT IGNORE INTO counters (name, value) VALUES (?, 0)', [$counter]);
    q('UPDATE counters SET value = LAST_INSERT_ID(value + 1) WHERE name = ?', [$counter]);
    return (int) db()->query('SELECT LAST_INSERT_ID()')->fetchColumn();
}

function next_patient_id(): string
{
    return 'CC-' . str_pad((string) next_number('patient'), 4, '0', STR_PAD_LEFT);
}

function next_invoice_id(): string
{
    return 'INV-' . str_pad((string) next_number('invoice'), 4, '0', STR_PAD_LEFT);
}

function uuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

function today(): string { return date('Y-m-d'); }
function now_str(): string { return date('Y-m-d H:i:s'); }
function now_hhmm(): string { return date('H:i'); }

// Outstanding balance on an invoice, in KES.
function invoice_balance(string $invoiceId): int
{
    return (int) q(
        'SELECT (SELECT COALESCE(SUM(qty * price), 0) FROM invoice_items WHERE invoice_id = ?)
              - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = ?)',
        [$invoiceId, $invoiceId]
    )->fetchColumn();
}
