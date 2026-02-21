// This is a mental map of our 'Users' table
// Fields: id, full_name, phone, vnin_verified, subscription_status
const createUserTable = `
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    phone_number TEXT UNIQUE NOT NULL,
    vnin_verified BOOLEAN DEFAULT FALSE,
    plan_type TEXT DEFAULT 'FREE', -- 'FREE', 'PRO_MONTHLY', 'PRO_YEARLY'
    subscription_status TEXT DEFAULT 'inactive',
    created_at TIMESTAMP DEFAULT NOW()
  );
`;