// Import required packages
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// Initialize the Express app
const app = express();
const port = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARE
// ==========================================
// Allow cross-origin requests (so your Flutter app can talk to the server)
app.use(cors());
// Parse incoming JSON data automatically
app.use(express.json());

// ==========================================
// DATABASE CONNECTION
// ==========================================
// Set up the PostgreSQL connection pool using environment variables
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

// Test the database connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to the database:', err.stack);
  } else {
    console.log('✅ Successfully connected to the E-Bentobox PostgreSQL database!');
  }
  if (client) release();
});

// ==========================================
// API ENDPOINTS
// ==========================================

// 1. Basic Health Check Endpoint (To see if server is online)
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the E-Bentobox API! 🍱' });
});

// 2. Test Endpoint: Get a list of active vendors
app.get('/api/vendors', async (req, res) => {
  try {
    // Query the database securely
    const result = await pool.query(
      'SELECT id, store_name, location_description FROM vendors WHERE is_active = true'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Database query error:', err);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

// ==========================================
// START SERVER
// ==========================================
app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});