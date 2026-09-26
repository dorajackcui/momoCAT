CREATE TABLE cloud_blob_parts (
  owner_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  part_index INTEGER NOT NULL CHECK(part_index >= 0 AND part_index < 16),
  data TEXT NOT NULL CHECK(length(data) <= 349528),
  PRIMARY KEY(owner_id, hash, part_index),
  FOREIGN KEY(owner_id, hash) REFERENCES cloud_blobs(owner_id, hash)
);
