-- Local folder / path repos (nullable for cloud-only rows)
ALTER TABLE repos ADD COLUMN local_path TEXT;
