<?php
// Passwords, sessions and permission checks.

declare(strict_types=1);

const SESSION_COOKIE = 'cc_session';
const SESSION_HOURS = 12;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

function check_password_strength(string $password): void
{
    if (strlen($password) < 10) throw new HttpError(400, 'Use a password of at least 10 characters.');
}

function token_hash(string $token): string
{
    return hash('sha256', $token);
}

function set_session_cookie(string $token, int $maxAgeSeconds): void
{
    setcookie(SESSION_COOKIE, $token, [
        'expires' => $maxAgeSeconds > 0 ? time() + $maxAgeSeconds : time() - 3600,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => is_https(),
    ]);
}

// The signed-in user for this request, or null.
function current_user(): ?array
{
    static $user = false;
    if ($user === false) {
        $token = $_COOKIE[SESSION_COOKIE] ?? '';
        $user = null;
        if (is_string($token) && $token !== '') {
            $user = q(
                'SELECT u.id, u.username, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1',
                [token_hash($token), now_str()]
            )->fetch() ?: null;
        }
    }
    return $user;
}

function require_login(): array
{
    return current_user() ?? throw new HttpError(401, 'Please sign in again.');
}

function require_perm(array $user, string $perm): void
{
    if (!role_can($user['role'], $perm)) throw new HttpError(403, 'Your role doesn’t allow this.');
}

function login(): array
{
    $username = strtolower(v_text(input('username'), 'username', max: 60));
    $password = is_string(input('password')) ? input('password') : '';
    if ($username === '' || $password === '') throw new HttpError(400, 'Enter your username and password.');

    $lock = q('SELECT failures, last_at FROM login_failures WHERE username = ?', [$username])->fetch();
    $recent = $lock && strtotime($lock['last_at']) > time() - LOCK_MINUTES * 60;
    if ($recent && $lock['failures'] >= MAX_FAILURES) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');

    $user = q('SELECT id, username, name, role, password_hash, status, active FROM users WHERE username = ?', [$username])->fetch();
    // Check a dummy hash for unknown users so the response time doesn't reveal which usernames exist.
    $hash = $user['password_hash'] ?? password_hash(random_bytes(12), PASSWORD_DEFAULT);
    if (!password_verify($password, $hash) || !$user) {
        q('INSERT INTO login_failures (username, failures, last_at) VALUES (?, 1, ?)
           ON DUPLICATE KEY UPDATE failures = IF(last_at < ?, 1, failures + 1), last_at = ?',
            [$username, now_str(), date('Y-m-d H:i:s', time() - LOCK_MINUTES * 60), now_str()]);
        audit($user['id'] ?? null, 'login.failed', 'user', $username);
        throw new HttpError(401, 'Wrong username or password.');
    }
    q('DELETE FROM login_failures WHERE username = ?', [$username]);
    // Only say why sign-in is blocked once the password has proved who they are.
    if ($user['status'] === 'pending') throw new HttpError(403, 'Your account is waiting for an administrator to approve it.');
    if ($user['status'] !== 'active' || !$user['active']) throw new HttpError(403, 'This account isn’t active. Contact your clinic administrator.');
    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
    }

    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
        [token_hash($token), $user['id'], date('Y-m-d H:i:s', time() + SESSION_HOURS * 3600)]);
    q('DELETE FROM sessions WHERE expires_at < ?', [now_str()]);   // housekeeping
    set_session_cookie($token, SESSION_HOURS * 3600);
    audit($user['id'], 'login');
    return ['user' => ['id' => $user['id'], 'username' => $user['username'], 'name' => $user['name'], 'role' => $user['role']]];
}

// Anyone can request an account, but it stays "pending" — with no access at all —
// until an administrator approves it and chooses its role (see routes/users.php).
const MAX_PENDING = 20;

function signup(): array
{
    $name = v_text(input('name'), 'full name', max: 120);
    $username = strtolower(v_text(input('username'), 'username', max: 40));
    $password = is_string(input('password')) ? input('password') : '';
    $confirm = is_string(input('confirmPassword')) ? input('confirmPassword') : '';

    if (char_length($name) < 2) throw new HttpError(400, 'Enter your full name (2–120 characters).');
    if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,39}$/', $username)) {
        throw new HttpError(400, 'Use a username of 3–40 characters with letters, numbers, dots, underscores or hyphens.');
    }
    check_password_strength($password);
    if ($password !== $confirm) throw new HttpError(400, 'Passwords do not match.');

    if (q('SELECT 1 FROM users WHERE username = ?', [$username])->fetch()) throw new HttpError(409, 'That username is already taken.');
    if ((int) q("SELECT COUNT(*) FROM users WHERE status = 'pending'")->fetchColumn() >= MAX_PENDING) {
        throw new HttpError(429, 'There are too many account requests waiting. Ask your clinic administrator.');
    }
    // The role is a placeholder; the administrator picks the real one when approving.
    q("INSERT INTO users (username, name, role, password_hash, status, active) VALUES (?, ?, 'reception', ?, 'pending', 0)",
        [$username, $name, password_hash($password, PASSWORD_DEFAULT)]);
    audit((int) db()->lastInsertId(), 'signup.request', 'user', $username);
    http_response_code(201);
    return ['pending' => true];
}

function logout(): array
{
    $user = current_user();
    if ($user) audit($user['id'], 'logout');
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (is_string($token) && $token !== '') q('DELETE FROM sessions WHERE token_hash = ?', [token_hash($token)]);
    set_session_cookie('', 0);
    return ['ok' => true];
}
