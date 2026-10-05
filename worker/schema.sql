CREATE TABLE IF NOT EXISTS padron (
  dni_hash TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  mesa TEXT,
  sede TEXT,
  instructions TEXT
);

CREATE INDEX IF NOT EXISTS idx_padron_category ON padron(category);
