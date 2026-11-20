<?php
// Loads configuration and the application code, and routes API requests.

declare(strict_types=1);

require __DIR__ . '/http.php';
require __DIR__ . '/rules.php';
require __DIR__ . '/db.php';
require __DIR__ . '/validate.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/routes/data.php';
require __DIR__ . '/routes/patients.php';
require __DIR__ . '/routes/appointments.php';
require __DIR__ . '/routes/clinical.php';
require __DIR__ . '/routes/billing.php';
require __DIR__ . '/routes/team.php';

// Settings come from config.php (copy config.example.php) or, if that file doesn't
// exist, from environment variables — handy on hosting platforms.
function config(): array
{
    static $config = null;
    if ($config === null) {
        $file = dirname(__DIR__) . '/config.php';
        if (is_file($file)) {
            $config = require $file;
        } else {
            $dsn = getenv('DB_DSN') ?: sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
                getenv('DB_HOST') ?: '127.0.0.1', getenv('DB_PORT') ?: '3306', getenv('DB_NAME') ?: 'clinic_care');
            $config = [
                'db' => ['dsn' => $dsn, 'user' => getenv('DB_USER') ?: 'clinic_care', 'password' => getenv('DB_PASSWORD') ?: ''],
                'timezone' => getenv('TZ') ?: 'Africa/Nairobi',
                'secure_cookies' => getenv('SECURE_COOKIES') === 'true',
            ];
        }
    }
    return $config;
}

date_default_timezone_set(config()['timezone'] ?? 'Africa/Nairobi');

// [method, path pattern, handler, needs sign-in]. Captured groups are passed to the handler.
const ROUTES = [
    ['GET', '#^/health$#', 'route_health', false],
    ['POST', '#^/login$#', 'login', false],
    ['POST', '#^/logout$#', 'logout', false],
    ['GET', '#^/me$#', 'route_me', true],
    ['GET', '#^/bootstrap$#', 'route_bootstrap', true],
    ['POST', '#^/patients$#', 'route_patient_create', true],
    ['PUT', '#^/patients/([\w-]+)$#', 'route_patient_update', true],
    ['POST', '#^/patients/([\w-]+)/archive$#', 'route_patient_archive', true],
    ['POST', '#^/patients/([\w-]+)/restore$#', 'route_patient_restore', true],
    ['POST', '#^/appointments$#', 'route_appointment_create', true],
    ['POST', '#^/appointments/walk-in$#', 'route_walk_in', true],
    ['PUT', '#^/appointments/([\w-]+)$#', 'route_appointment_update', true],
    ['POST', '#^/appointments/([\w-]+)/status$#', 'route_appointment_status', true],
    ['POST', '#^/vitals$#', 'route_vitals', true],
    ['POST', '#^/consultations$#', 'route_consultation', true],
    ['POST', '#^/notes/([\w-]+)/amend$#', 'route_note_amend', true],
    ['POST', '#^/invoices$#', 'route_invoice_create', true],
    ['POST', '#^/invoices/([\w-]+)/payments$#', 'route_payment', true],
    ['PUT', '#^/team/(\d+)$#', 'route_team_update', true],
    ['POST', '#^/team/(\d+)/away$#', 'route_team_away', true],
];

// Lets a hosting platform or uptime monitor check the server and database are up.
function route_health(): array
{
    db()->query('SELECT 1');
    return ['ok' => true];
}

function route_me(array $user): array
{
    return ['user' => $user];
}

function handle_api_request(): never
{
    security_headers();
    header('Cache-Control: no-store');
    try {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        // Everything after "/api", so the app also works from a sub-folder.
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $path = preg_replace('#^.*?/api(?=/|$)#', '', $uri) ?: '/';

        // Requiring JSON on writes means a plain cross-site form can't trigger them.
        if ($method !== 'GET' && !str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
            throw new HttpError(415, 'Requests must be sent as JSON.');
        }

        foreach (ROUTES as [$routeMethod, $pattern, $handler, $needsLogin]) {
            if ($routeMethod === $method && preg_match($pattern, $path, $m)) {
                $args = array_slice($m, 1);
                if ($needsLogin) array_unshift($args, require_login());
                json_out($handler(...$args), http_response_code() === 201 ? 201 : 200);
            }
        }
        throw new HttpError(404, 'Not found.');
    } catch (HttpError $e) {
        json_out(['error' => $e->getMessage()], $e->status);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? null) === 1062 && str_contains($e->getMessage(), 'appointments_no_double_booking')) {
            json_out(['error' => 'That practitioner already has an appointment at that time. Choose another time.'], 409);
        }
        error_log((string) $e);
        json_out(['error' => 'Something went wrong on the server. Please try again.'], 500);
    } catch (Throwable $e) {
        error_log((string) $e);
        json_out(['error' => 'Something went wrong on the server. Please try again.'], 500);
    }
}
