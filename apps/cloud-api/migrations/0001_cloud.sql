CREATE TABLE cloud_projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  manifest TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_device TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  fence INTEGER NOT NULL DEFAULT 0,
  last_operation TEXT
);
CREATE INDEX cloud_projects_owner ON cloud_projects(owner_id, updated_at);
CREATE TABLE cloud_operations (
  project_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(project_id, operation_id),
  FOREIGN KEY(project_id) REFERENCES cloud_projects(id)
);
CREATE TABLE cloud_blobs (
  owner_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes >= 0 AND bytes <= 4194304),
  ready INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id, hash)
);
