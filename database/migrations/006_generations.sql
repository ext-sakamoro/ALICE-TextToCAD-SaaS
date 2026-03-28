-- Text-to-CAD generation history
CREATE TABLE IF NOT EXISTS generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    lol_source TEXT DEFAULT '',
    triangle_count INTEGER DEFAULT 0,
    vertex_count INTEGER DEFAULT 0,
    quality TEXT DEFAULT 'high',
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own generations"
    ON generations FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generations"
    ON generations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Index for history listing
CREATE INDEX idx_generations_user_created ON generations (user_id, created_at DESC);
