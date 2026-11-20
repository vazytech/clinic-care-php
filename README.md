# Clinic Care (PHP edition)

A clinic management system for small clinics: patient records, appointments, a live waiting room, triage, consultations with prescriptions, billing (cash, M-Pesa, SHA, insurance) and a staff duty roster.

This is the **PHP + MySQL** version of [clinic-care](https://github.com/vazytech/clinic-care) (Node.js + PostgreSQL). Both share the same screens and the same API, and pass the same tests. This one runs on ordinary **cPanel shared hosting**: no Node, no Composer, no framework.

> **Status: early version.** It works end to end, but it hasn't been through a security review or a clinical pilot yet. Don't use it for real patients until it has. See [Before going live](#before-going-live).

## Features

- **Sign-in with roles:** administrator, front desk, nurse and clinician each see only what their role allows. Every rule is enforced on the server.
- **Patients:** registration with allergies, conditions, next of kin and SHA/insurance details. Records are archived, never deleted.
- **Appointments:** day schedule, walk-ins, check-in, and double-booking prevention.
- **Waiting room:** check-in → triage → consultation, with waiting times.
- **Triage:** vital signs with automatic flags for abnormal and critical readings.
- **Consultations:** complaint, findings, ICD-10 diagnosis and plan. Prescriptions are checked against the patient's allergies. Notes can be amended, and the earlier version is always kept.
- **Billing:** invoices are created automatically from each consultation, with partial payments, M-Pesa code checks and printable receipts.
- **Audit log:** every sign-in and every change is recorded with who did it and when.

## Requirements

- **PHP 8.1 or newer** with the `pdo_mysql` extension (standard on cPanel hosts)
- **MySQL 8** or **MariaDB 10.6+**

## Run it on your computer

1. **Create a database** and a user for it. With the MySQL command line:
   ```sql
   CREATE DATABASE clinic_care CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'clinic_care'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
   GRANT ALL ON clinic_care.* TO 'clinic_care'@'localhost';
   ```
   On Windows, the easiest route is **XAMPP** (apachefriends.org). Start MySQL in the XAMPP Control Panel and run the SQL above in phpMyAdmin's **SQL** tab.

2. **Configure:** copy `config.example.php` to `config.php` and put in the database name, user and password.

3. **Create the tables and first accounts:**
   ```bash
   php setup.php              # with demo patients
   php setup.php --no-demo    # without demo data, for real use
   ```
   This prints a one-time password for each account (`alex`, `faith`, `peter`, `james`, `sarah`). Save them.

4. **Start PHP's built-in server:**
   ```bash
   php -S 127.0.0.1:8000 -t public router.php
   ```
   Then open http://localhost:8000.

To change a password: `php scripts/set-password.php <username>`.

## Put it on cPanel hosting

1. In cPanel, open **MySQL Databases**. Create a database and a user, and add the user to the database with **All privileges**. Note the full names; cPanel adds your account name as a prefix, like `myacct_clinic`.
2. Upload the whole project to a folder **outside** `public_html`, for example `/home/myacct/clinic-care-php/`, using **File Manager** or FTP.
3. Make the website serve the `public` folder:
   - **For a subdomain or addon domain:** set its **document root** to `clinic-care-php/public` (in **Domains**).
   - **For your main domain:** copy the contents of `public/` into `public_html/`, then edit `public_html/api/index.php` so the path points at your project folder, e.g. `require '/home/myacct/clinic-care-php/src/app.php';`.
4. Create `config.php` from `config.example.php` with the database details from step 1.
5. Run the setup. Use cPanel's **Terminal** if your host has it:
   ```bash
   cd ~/clinic-care-php && php setup.php --no-demo
   ```
   Without Terminal, ask your host to run it once, or run it on your computer against the hosted database if remote MySQL is allowed.
6. Turn on **SSL/TLS** (free AutoSSL in cPanel) and open the site over `https://`.

`src/`, `database/`, `scripts/` and `tests/` each contain an `.htaccess` that blocks web access, as a safety net in case they end up inside `public_html`.

## Project layout

```
public/            Web root: what the browser can reach
  index.html, app.js, data.js, shared.js, styles.css   The screens (same as the Node edition)
  api/index.php    Entry point for every /api/... request
  .htaccess        Routes /api/... to PHP; adds security headers
src/               Application code (not web-accessible)
  app.php          Configuration, route table, error handling
  auth.php         Passwords (bcrypt), sessions, role checks, sign-in lockout
  db.php           Database connection, transactions, audit log, ID numbers
  rules.php        Reference data and clinical/billing rules
  validate.php     Input checks
  routes/          API endpoints by area
database/schema.sql  Tables
setup.php          Creates tables, accounts and demo data
router.php         Router for PHP's built-in development server
scripts/           Admin tools (set password)
tests/check-rules.php  Confirms rules.php matches public/shared.js
```

## Keep the rules in sync

The browser (`public/shared.js`) and the server (`src/rules.php`) each hold a copy of the reference data and rules: medicines, prices, permissions, allergy checks and vital-sign alerts. **If you change one, change the other**, then run:

```bash
php tests/check-rules.php   # needs Node.js
```

It reports any difference between the two.

## Before going live

- Serve over **HTTPS** only.
- Set up **automatic database backups** (cPanel → Backup, or your host's backup tool), and test restoring them.
- Replace the demo **prices and medicine list** in both `src/rules.php` and `public/shared.js`.
- Register with the **ODPC** as a data controller (Kenya Data Protection Act 2019). Health data is sensitive personal data.
- Run a **pilot** alongside paper records before switching over.
