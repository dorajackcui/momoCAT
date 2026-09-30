-- Separate catalogs keep V1 project snapshots readable without reinterpretation.
CREATE TABLE cloud_v2_projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  manifest TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  last_operation TEXT
);
CREATE INDEX cloud_v2_projects_owner ON cloud_v2_projects(owner_id, updated_at);

CREATE TABLE cloud_v2_resources (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('tm', 'tb')),
  name TEXT NOT NULL,
  src_lang TEXT NOT NULL,
  tgt_lang TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  manifest TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  last_operation TEXT
);
CREATE INDEX cloud_v2_resources_owner ON cloud_v2_resources(owner_id, updated_at);

CREATE TABLE cloud_v2_project_operations (
  entity_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(entity_id, operation_id),
  FOREIGN KEY(entity_id) REFERENCES cloud_v2_projects(id)
);
CREATE TABLE cloud_v2_resource_operations (
  entity_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(entity_id, operation_id),
  FOREIGN KEY(entity_id) REFERENCES cloud_v2_resources(id)
);
