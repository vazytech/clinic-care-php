<?php
// Copy this file to config.php and fill in your own values. Never commit config.php.
return [
    'db' => [
        // On cPanel the database and user names usually start with your account name,
        // e.g. dbname=myacct_clinic and user myacct_clinic.
        'dsn' => 'mysql:host=127.0.0.1;port=3306;dbname=clinic_care;charset=utf8mb4',
        'user' => 'clinic_care',
        'password' => 'CHANGE_ME',
    ],
    'timezone' => 'Africa/Nairobi',
    // Set to true when the site is served over HTTPS, so session cookies are marked Secure.
    // (Detected automatically on most hosts; this forces it on.)
    'secure_cookies' => false,
];
