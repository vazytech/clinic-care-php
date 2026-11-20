<?php
// Request and response helpers.

declare(strict_types=1);

// An error whose message is safe to show to the user.
final class HttpError extends Exception
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function json_out(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// The decoded JSON request body (an empty array for GET requests).
function body(): array
{
    static $body = null;
    if ($body === null) {
        $raw = file_get_contents('php://input');
        if ($raw === '' || $raw === false) return $body = [];
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) throw new HttpError(400, 'The request couldn’t be read.');
        $body = $decoded;
    }
    return $body;
}

function input(string $key): mixed
{
    return body()[$key] ?? null;
}

function uuid_param(string $id): string
{
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id)) {
        throw new HttpError(400, 'That ID isn’t valid.');
    }
    return $id;
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
        || !empty(config()['secure_cookies']);
}

function security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
}
