
CREATE DATABASE IF NOT EXISTS task_manager
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE task_manager;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    status ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'todo',
    priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
    assigned_to INT DEFAULT NULL,
    created_by INT NOT NULL,
    due_date DATE DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_tasks_status_updated (status, updated_at),
    KEY idx_tasks_assigned_to (assigned_to),
    KEY idx_tasks_created_by (created_by),
    CONSTRAINT fk_tasks_assigned_to
        FOREIGN KEY (assigned_to)
        REFERENCES users(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_tasks_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
) ENGINE=InnoDB;

-- These placeholder passwords are not usable credentials. Replace them with
-- Flask-Bcrypt hashes before enabling authentication.
INSERT IGNORE INTO users (name, email, password, role)
VALUES
    ('Admin User', 'admin@example.com', 'temporary_hash', 'admin'),
    ('Test Member', 'member@example.com', 'temporary_hash', 'member');

INSERT INTO tasks
    (title, description, status, priority, assigned_to, created_by, due_date)
SELECT
    'Build Dashboard',
    'Create the React dashboard',
    'in_progress',
    'high',
    assignee.id,
    creator.id,
    '2026-12-15'
FROM users AS assignee
JOIN users AS creator ON creator.email = 'admin@example.com'
WHERE assignee.email = 'member@example.com'
  AND NOT EXISTS (
      SELECT 1
      FROM tasks
      WHERE title = 'Build Dashboard'
        AND assigned_to = assignee.id
        AND created_by = creator.id
  );

INSERT INTO tasks
    (title, description, status, priority, assigned_to, created_by, due_date)
SELECT
    'Create Login Page',
    'Build the login page using React and TypeScript',
    'todo',
    'medium',
    assignee.id,
    creator.id,
    '2026-12-20'
FROM users AS assignee
JOIN users AS creator ON creator.email = 'admin@example.com'
WHERE assignee.email = 'member@example.com'
  AND NOT EXISTS (
      SELECT 1
      FROM tasks
      WHERE title = 'Create Login Page'
        AND assigned_to = assignee.id
        AND created_by = creator.id
  );

SHOW TABLES;
SELECT id, name, email, role, created_at FROM users;
SELECT * FROM tasks;
DESCRIBE users;
DESCRIBE tasks;
