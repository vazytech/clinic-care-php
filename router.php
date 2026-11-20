<?php
// Router for PHP's built-in development server:
//   php -S 127.0.0.1:8000 -t public router.php
// Sends /api/... to the API and serves everything else from public/ with the same
// security headers Apache would add. Not for production use.

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
if (preg_match('#^/api(/|$)#', $path)) {
    require __DIR__ . '/public/api/index.php';
    return true;
}
$file = realpath(__DIR__ . '/public' . ($path === '/' ? '/index.html' : $path));
$root = realpath(__DIR__ . '/public');
if ($file === false || !str_starts_with($file, $root . DIRECTORY_SEPARATOR) || !is_file($file) || str_ends_with($file, '.php') || basename($file)[0] === '.') {
    http_response_code(404);
    echo 'Not found';
    return true;
}
$types = ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'svg' => 'image/svg+xml', 'png' => 'image/png', 'ico' => 'image/x-icon', 'woff2' => 'font/woff2', 'txt' => 'text/plain; charset=utf-8'];
header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
readfile($file);
return true;
