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
  port: process.env.DB_PORT,
});

// Middleware
app.use(cors());
app.use(express.json()); // Crucial: Allows us to read JSON data from Flutter!

// ==========================================
// API ROUTES
// ==========================================

// POST: Real Authentication Login Route
app.post('/api/login', async (req, res) => {
  const { email, password, role } = req.body;

  try {
    let userRecord;
    
    // 1. Check which table to query based on role
    if (role === 'Vendor') {
      const result = await pool.query('SELECT * FROM vendors WHERE email = $1', [email]);
      userRecord = result.rows[0];
    } else {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      userRecord = result.rows[0];
    }

    // 2. If no user is found
    if (!userRecord) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // 3. Check password (In a real production app, you would use bcrypt.compare here!)
    if (userRecord.password_hash !== password) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // 4. Check for 1-Strike Ban (Only applies to Users, not Vendors)
    if (role === 'User' && userRecord.is_banned) {
      return res.status(403).json({ success: false, message: 'Account banned due to missed pickup.' });
    }

    // 5. Success! Send back user data
    delete userRecord.password_hash; // Never send passwords back to the app!
    
    res.json({
      success: true,
      message: 'Login successful',
      user: userRecord,
      token: 'mock-jwt-token-12345' // Later, we can add real JWT tokens here
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Basic test route
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