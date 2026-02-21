const db = require('../config/db');

const createTables = async () => {
  // We use 'di_users' to keep it separate from any existing tables
  const queryText = `
    CREATE TABLE IF NOT EXISTS di_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name TEXT NOT NULL,
      phone_number TEXT UNIQUE NOT NULL,
      vnin_verified BOOLEAN DEFAULT FALSE,
      plan_type TEXT DEFAULT 'FREE', 
      subscription_status TEXT DEFAULT 'inactive',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;

  try {
    console.log("Connecting to Neon to build tables...");
    await db.query(queryText);
    console.log("✅ Discreet Intelligence tables created successfully in Neon!");
    process.exit();
  } catch (err) {
    console.error("❌ Error creating tables:", err);
    process.exit(1);
  }
};

createTables();