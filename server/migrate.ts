import { getPool } from "./src/db";

async function migrate() {
  const pool = await getPool();

  // Add status column to task entries
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns 
      WHERE object_id = OBJECT_ID('timesheet_task_entries') AND name = 'status'
    )
    ALTER TABLE timesheet_task_entries ADD status NVARCHAR(20) NOT NULL DEFAULT 'submitted'
  `);
  console.log("Migration: status column added");

  // Add role column to employees (default 'user')
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns 
      WHERE object_id = OBJECT_ID('timesheet_employees') AND name = 'role'
    )
    ALTER TABLE timesheet_employees ADD role NVARCHAR(20) NOT NULL DEFAULT 'user'
  `);
  console.log("Migration: role column added");

  // Create projects table
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'timesheet_projects')
    CREATE TABLE timesheet_projects (
      id INT IDENTITY(1,1) PRIMARY KEY,
      name NVARCHAR(200) NOT NULL,
      description NVARCHAR(MAX),
      created_by NVARCHAR(200) NOT NULL,
      created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      is_active BIT NOT NULL DEFAULT 1
    )
  `);
  console.log("Migration: projects table created");

  // Add project_id column to task entries
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns 
      WHERE object_id = OBJECT_ID('timesheet_task_entries') AND name = 'project_id'
    )
    ALTER TABLE timesheet_task_entries ADD project_id INT NULL
  `);
  console.log("Migration: project_id column added");

  // Add foreign key: task_entries.project_id -> projects.id (ON DELETE SET NULL)
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.foreign_keys 
      WHERE name = 'FK_timesheet_task_entries_project'
    )
    ALTER TABLE timesheet_task_entries
    ADD CONSTRAINT FK_timesheet_task_entries_project
    FOREIGN KEY (project_id) REFERENCES timesheet_projects(id)
    ON DELETE SET NULL
  `);
  console.log("Migration: project_id foreign key added");

  process.exit(0);
}

migrate().catch((err) => { console.error(err); process.exit(1); });
