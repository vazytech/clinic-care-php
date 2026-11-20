<?php
// Every request to /api/... arrives here (see public/.htaccess and router.php).
// The application code lives outside the web folder, in ../../src.

declare(strict_types=1);

require dirname(__DIR__, 2) . '/src/app.php';
handle_api_request();
