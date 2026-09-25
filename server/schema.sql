CREATE TABLE IF NOT EXISTS pilots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'pilot' CHECK(role IN ('admin','pilot')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS login_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pilot_id BIGINT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pilot_id BIGINT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS listings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  intent TEXT NOT NULL CHECK (intent IN ('offer', 'request')),
  kind TEXT NOT NULL CHECK (kind IN ('flight', 'shift')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  flight_number TEXT NOT NULL DEFAULT '',
  crew_role TEXT NOT NULL CHECK (crew_role IN ('captain', 'first_officer')),
  crew_name TEXT NOT NULL,
  exchange_dates TEXT NOT NULL DEFAULT '',
  exchange_flights TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'closed')),
  matched_with BIGINT REFERENCES pilots(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_times CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_listings_starts ON listings(starts_at);
CREATE TABLE IF NOT EXISTS interests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  from_pilot_id BIGINT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(listing_id, from_pilot_id)
);
CREATE INDEX IF NOT EXISTS idx_interests_listing ON interests(listing_id);
