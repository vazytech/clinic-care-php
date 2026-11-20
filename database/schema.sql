-- Clinic Care database schema (MySQL 8 / MariaDB 10.6+).
-- Safe to run repeatedly: every statement only creates what is missing.

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(60)  NOT NULL UNIQUE,
  name          VARCHAR(120) NOT NULL,
  role          ENUM('admin', 'reception', 'nurse', 'doctor') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  -- Accounts created through sign-up start as 'pending' and can't sign in until an
  -- administrator approves them.
  status        ENUM('pending', 'active', 'rejected') NOT NULL DEFAULT 'active',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Only a hash of the session token is stored, so a database leak doesn't expose live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id    INT      NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Failed sign-ins per username, for the 15-minute lockout after 5 failures.
CREATE TABLE IF NOT EXISTS login_failures (
  username  VARCHAR(60) PRIMARY KEY,
  failures  INT         NOT NULL,
  last_at   DATETIME    NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Running numbers for patient IDs (CC-0001) and invoice IDs (INV-0001).
CREATE TABLE IF NOT EXISTS counters (
  name  VARCHAR(30) PRIMARY KEY,
  value INT         NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_members (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  role VARCHAR(120) NOT NULL,
  days VARCHAR(20)  NOT NULL DEFAULT '1,2,3,4,5'   -- weekly roster, 0 = Sunday
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_away (
  member_id INT  NOT NULL,
  date      DATE NOT NULL,
  PRIMARY KEY (member_id, date),
  FOREIGN KEY (member_id) REFERENCES team_members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS patients (
  id          VARCHAR(12)  PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  sex         VARCHAR(20)  NOT NULL,
  dob         DATE         NULL,
  phone       VARCHAR(40)  NOT NULL DEFAULT '',
  national_id VARCHAR(40)  NOT NULL DEFAULT '',
  allergies   VARCHAR(300) NOT NULL DEFAULT '',
  conditions  VARCHAR(300) NOT NULL DEFAULT '',
  kin_name    VARCHAR(120) NOT NULL DEFAULT '',
  kin_phone   VARCHAR(40)  NOT NULL DEFAULT '',
  payer       VARCHAR(30)  NOT NULL DEFAULT 'Cash',
  member_no   VARCHAR(60)  NOT NULL DEFAULT '',
  visit       VARCHAR(120) NOT NULL DEFAULT '—',
  last_visit  DATE         NULL,
  registered  DATE         NOT NULL,
  archived    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointments (
  id         CHAR(36)     PRIMARY KEY,
  patient_id VARCHAR(12)  NOT NULL,
  date       DATE         NOT NULL,
  time       CHAR(5)      NOT NULL,
  doctor     VARCHAR(120) NOT NULL,
  type       VARCHAR(120) NOT NULL,
  status     ENUM('Confirmed', 'Checked in', 'Waiting', 'Completed', 'Cancelled') NOT NULL,
  arrived_at CHAR(5)      NULL,
  walk_in    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 1 for live appointments, NULL for cancelled ones. A unique index ignores NULLs,
  -- so this stops a practitioner having two live appointments at the same time.
  live       TINYINT AS (IF(status <> 'Cancelled', 1, NULL)) STORED,
  UNIQUE KEY appointments_no_double_booking (doctor, date, time, live),
  KEY appointments_date (date),
  FOREIGN KEY (patient_id) REFERENCES patients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vitals (
  id             CHAR(36)     PRIMARY KEY,
  patient_id     VARCHAR(12)  NOT NULL,
  appointment_id CHAR(36)     NULL,
  recorded_at    DATETIME     NOT NULL,
  recorded_by    INT          NULL,
  sys INT NULL, dia INT NULL, temp DECIMAL(4,1) NULL, pulse INT NULL, resp INT NULL, spo2 INT NULL,
  weight DECIMAL(5,1) NULL, height DECIMAL(5,1) NULL,
  FOREIGN KEY (patient_id) REFERENCES patients (id),
  FOREIGN KEY (appointment_id) REFERENCES appointments (id),
  FOREIGN KEY (recorded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notes (
  id             CHAR(36)     PRIMARY KEY,
  patient_id     VARCHAR(12)  NOT NULL,
  appointment_id CHAR(36)     NULL,
  date           DATE         NOT NULL,
  type           VARCHAR(120) NOT NULL,
  complaint      TEXT         NOT NULL,
  findings       TEXT         NOT NULL,
  diagnosis      VARCHAR(300) NOT NULL,
  plan           TEXT         NOT NULL,
  author_id      INT          NULL,
  created_at     DATETIME     NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients (id),
  FOREIGN KEY (appointment_id) REFERENCES appointments (id),
  FOREIGN KEY (author_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prescriptions (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  note_id CHAR(36)     NOT NULL,
  drug    VARCHAR(120) NOT NULL,
  dose    DECIMAL(5,1) NOT NULL,
  freq    VARCHAR(10)  NOT NULL,
  days    INT          NOT NULL,
  qty     INT          NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notes are never edited in place without keeping the previous version here.
CREATE TABLE IF NOT EXISTS note_amendments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  note_id    CHAR(36)     NOT NULL,
  amended_at DATETIME     NOT NULL,
  amended_by INT          NULL,
  reason     VARCHAR(300) NOT NULL,
  previous   TEXT         NOT NULL,   -- JSON
  FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
  FOREIGN KEY (amended_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id             VARCHAR(12) PRIMARY KEY,
  patient_id     VARCHAR(12) NOT NULL,
  appointment_id CHAR(36)    NULL,
  date           DATE        NOT NULL,
  created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients (id),
  FOREIGN KEY (appointment_id) REFERENCES appointments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id  VARCHAR(12)  NOT NULL,
  description VARCHAR(120) NOT NULL,
  qty         INT          NOT NULL CHECK (qty > 0),
  price       INT          NOT NULL CHECK (price >= 0),
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id  VARCHAR(12) NOT NULL,
  method      VARCHAR(20) NOT NULL,
  amount      INT         NOT NULL CHECK (amount > 0),
  ref         VARCHAR(60) NOT NULL DEFAULT '',
  paid_at     DATETIME    NOT NULL,
  received_by INT         NULL,
  KEY payments_ref (ref),
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE,
  FOREIGN KEY (received_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Who did what, and when. Written for every change and every sign-in.
CREATE TABLE IF NOT EXISTS audit_log (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id   INT         NULL,
  action    VARCHAR(60) NOT NULL,
  entity    VARCHAR(30) NULL,
  entity_id VARCHAR(60) NULL,
  detail    TEXT        NULL,   -- JSON
  KEY audit_log_entity (entity, entity_id),
  FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
