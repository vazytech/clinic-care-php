<?php
// Sets a user's password and signs them out everywhere.
//   php scripts/set-password.php <username>

declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit;
require dirname(__DIR__) . '/src/app.php';

$username = strtolower($argv[1] ?? '');
if ($username === '') {
    fwrite(STDERR, "Usage: php scripts/set-password.php <username>\n");
    exit(1);
}
$user = q('SELECT id, name FROM users WHERE username = ?', [$username])->fetch();
if (!$user) {
    fwrite(STDERR, "No user called \"$username\".\n");
    exit(1);
}

echo "New password for {$user['name']}: ";
// Hide typing where the terminal allows it.
$hide = DIRECTORY_SEPARATOR === '/' && function_exists('posix_isatty') && posix_isatty(STDIN);
if ($hide) shell_exec('stty -echo');
$password = rtrim((string) fgets(STDIN), "\r\n");
if ($hide) shell_exec('stty echo');
echo "\n";

try {
    check_password_strength($password);
} catch (HttpError $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
q('DELETE FROM sessions WHERE user_id = ?', [$user['id']]);
echo "Password updated.\n";
