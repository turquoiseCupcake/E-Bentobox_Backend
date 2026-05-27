// Import required packages
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
// Expose the uploads folder to the internet
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// ==========================================
// MULTER STORAGE CONFIGURATION
// ==========================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Save in the uploads directory
  },
  filename: function (req, file, cb) {
    // Name format: vendorID_timestamp.jpg (e.g., menu_168425123.jpg)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// ==========================================
// API ROUTES
// ==========================================

// POST: Real Authentication Registration Route
app.post('/api/register', async (req, res) => {
  // We accept 'name' which will be mapped to full_name (User) or store_name (Vendor)
  const { name, email, password, role } = req.body;

  try {
    if (role === 'Vendor') {
      await pool.query(
        'INSERT INTO vendors (store_name, email, password_hash) VALUES ($1, $2, $3)',
        [name, email, password] // In production, hash this password before inserting!
      );
    } else {
      await pool.query(
        'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3)',
        [name, email, password]
      );
    }

    res.json({ success: true, message: 'Registration successful! You can now log in.' });

  } catch (error) {
    // 23505 is the PostgreSQL error code for a Unique Violation (e.g., email already exists)
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: 'This email is already registered.' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

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

// --- GET ALL ACTIVE VENDORS ---
app.get('/api/vendors', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, store_name, location_description, profile_image_url, cover_image_url, description, operating_hours FROM vendors WHERE is_active = true'
    );
    res.json({ success: true, vendors: result.rows });
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// --- GET ALL AVAILABLE MENU ITEMS (FOR EXPLORE FEED) ---
app.get('/api/menu-items', async (req, res) => {
  try {
    // This query joins the menu item with the vendor to get the store name!
    const query = `
      SELECT m.*, v.store_name 
      FROM menu_items m 
      JOIN vendors v ON m.vendor_id = v.id 
      WHERE m.is_available_tomorrow = true 
      ORDER BY RANDOM() LIMIT 30
    `;
    const result = await pool.query(query);
    res.json({ success: true, items: result.rows });
  } catch (error) {
    console.error('Error fetching all menu items:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// --- GET VENDOR PROFILE ---
app.get('/api/vendors/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'SELECT id, store_name, email, location_description, profile_image_url, cover_image_url, description, operating_hours, latitude, longitude FROM vendors WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    res.json({ success: true, vendor: result.rows[0] });
  } catch (error) {
    console.error('Error fetching vendor profile:', error);
    res.status(500).json({ success: false, message: 'Server error fetching profile' });
  }
});

// --- UPDATE VENDOR PROFILE ---
app.put('/api/vendors/:id', async (req, res) => {
  const { id } = req.params;
  const { store_name, location_description, profile_image_url, cover_image_url, description, operating_hours, latitude, longitude } = req.body;

  try {
    const result = await pool.query(
      `UPDATE vendors 
       SET store_name = $1, location_description = $2, profile_image_url = $3, cover_image_url = $4,
           description = $5, operating_hours = $6, latitude = $7, longitude = $8 
       WHERE id = $9 RETURNING *`,
      [store_name, location_description, profile_image_url, cover_image_url, description, operating_hours, latitude, longitude, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    res.json({ success: true, message: 'Profile updated successfully', vendor: result.rows[0] });
  } catch (error) {
    console.error('Error updating vendor profile:', error);
    res.status(500).json({ success: false, message: 'Server error updating profile' });
  }
});

// Image Upload Endpoint
app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    // Create the public URL for the database
    // Note: Make sure to construct this using your actual VPS IP in production
    const imageUrl = `/uploads/${req.file.filename}`;
    
    console.log(`✅ Image uploaded successfully: ${imageUrl}`);
    
    res.json({
      success: true,
      message: 'Image uploaded successfully!',
      imageUrl: imageUrl
    });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ success: false, message: 'Server error during upload' });
  }
});

// Add a New Menu Item Endpoint
app.post('/api/menu-items', async (req, res) => {
  const { vendor_id, name, price, category, image_url } = req.body;

  try {
    // 1. Basic validation
    if (!vendor_id || !name || !price || !category) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // 2. Insert into the PostgreSQL database
    const newMenuItem = await pool.query(
      'INSERT INTO menu_items (vendor_id, name, price, category, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [vendor_id, name, price, category, image_url]
    );

    console.log(`✅ New menu item saved: ${name}`);

    // 3. Send success response back to Flutter
    res.json({
      success: true,
      message: 'Menu item created successfully',
      item: newMenuItem.rows[0]
    });
    
  } catch (error) {
    console.error('Error saving menu item:', error);
    res.status(500).json({ success: false, message: 'Server error while saving menu item' });
  }
});

// Get Menu Items for a Specific Vendor
app.get('/api/menu-items/:vendorId', async (req, res) => {
  const { vendorId } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM menu_items WHERE vendor_id = $1 ORDER BY created_at DESC',
      [vendorId]
    );

    res.json({
      success: true,
      items: result.rows
    });
  } catch (error) {
    console.error('Error fetching menu items:', error);
    res.status(500).json({ success: false, message: 'Server error fetching menu items' });
  }
});

// Update an existing Menu Item
app.put('/api/menu-items/:id', async (req, res) => {
  const { id } = req.params;
  const { name, price, category, description, is_available, image_url } = req.body;

  try {
    const result = await pool.query(
      'UPDATE menu_items SET name = $1, price = $2, category = $3, description = $4, is_available = $5, image_url = $6 WHERE id = $7 RETURNING *',
      [name, price, category, description, is_available, image_url, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    res.json({ success: true, message: 'Item updated successfully', item: result.rows[0] });
  } catch (error) {
    console.error('Error updating menu item:', error);
    res.status(500).json({ success: false, message: 'Server error updating menu item' });
  }
});

// Delete a Menu Item
app.delete('/api/menu-items/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Fetch the item first so we know what image to delete
    const itemResult = await pool.query('SELECT image_url FROM menu_items WHERE id = $1', [id]);
    
    if (itemResult.rows.length > 0) {
      const imageUrl = itemResult.rows[0].image_url;
      
      if (imageUrl) {
        // Extract just the filename (e.g., 'image-123.jpg') and delete it from the hard drive
        const fileName = imageUrl.split('/').pop();
        const imagePath = path.join(__dirname, 'uploads', fileName);
        
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
          console.log(`🗑️ Deleted image file: ${fileName}`);
        }
      }
    }

    // 2. Delete the row from PostgreSQL
    await pool.query('DELETE FROM menu_items WHERE id = $1', [id]);

    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting menu item:', error);
    res.status(500).json({ success: false, message: 'Server error deleting menu item' });
  }
});

// --- GET ORDERS FOR A SPECIFIC VENDOR AND DATE ---
app.get('/api/vendors/:vendorId/orders', async (req, res) => {
  const { vendorId } = req.params;
  const { date } = req.query; // Expecting format YYYY-MM-DD

  try {
    // This query joins the orders, users (for customer name), and order_items tables
    const query = `
      SELECT 
          o.id, 
          o.total_amount AS total, 
          o.status, 
          u.full_name AS customer,
          COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') AS items
      FROM orders o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE o.vendor_id = $1 AND o.reservation_date = $2
      GROUP BY o.id, u.full_name
      ORDER BY o.created_at ASC;
    `;
    
    const result = await pool.query(query, [vendorId, date]);
    
    res.json({ success: true, orders: result.rows });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, message: 'Server error fetching orders' });
  }
});

// --- UPDATE ORDER STATUS ---
app.put('/api/orders/:orderId/status', async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  try {
    const result = await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [status, orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, message: 'Status updated successfully' });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ success: false, message: 'Server error updating status' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { user_id, vendor_id, total_amount, reservation_date, items } = req.body;

  // We use a database client directly to handle a "Transaction"
  const client = await pool.connect();

  try {
    // Start Transaction
    await client.query('BEGIN');

    // 1. Create the main Order record
    const orderResult = await client.query(
      `INSERT INTO orders (user_id, vendor_id, total_amount, reservation_date, status) 
       VALUES ($1, $2, $3, $4, 'Pending') RETURNING id`,
      [user_id, vendor_id, total_amount, reservation_date]
    );
    
    const orderId = orderResult.rows[0].id;

    // 2. Loop through the cart and insert each specific food item
    for (let item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, price_at_time) 
         VALUES ($1, $2, $3, $4)`,
        [orderId, item.menu_item_id, item.quantity, item.price]
      );
    }

    // If everything succeeded, save it permanently!
    await client.query('COMMIT');
    
    console.log(`✅ New order placed! Order ID: ${orderId}`);
    res.json({ success: true, message: 'Order placed successfully', orderId });

  } catch (error) {
    // If anything fails, undo all database changes
    await client.query('ROLLBACK');
    console.error('Checkout Error:', error);
    res.status(500).json({ success: false, message: 'Server error during checkout' });
  } finally {
    // Always release the client back to the pool
    client.release();
  }
});

// --- GET ORDERS FOR A SPECIFIC USER (STUDENT) AND DATE ---
app.get('/api/users/:userId/orders', async (req, res) => {
  const { userId } = req.params;
  const { date } = req.query; // Expecting format YYYY-MM-DD

  try {
    // This query joins orders, vendors (for store name), and order_items
    const query = `
      SELECT 
          o.id, 
          o.total_amount AS total, 
          o.status, 
          v.store_name AS vendor_name,
          COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') AS items
      FROM orders o
      JOIN vendors v ON o.vendor_id = v.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE o.user_id = $1 AND o.reservation_date = $2
      GROUP BY o.id, v.store_name
      ORDER BY o.created_at ASC;
    `;
    
    const result = await pool.query(query, [userId, date]);
    
    res.json({ success: true, orders: result.rows });
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ success: false, message: 'Server error fetching orders' });
  }
});

// ==========================================
// START SERVER
// ==========================================
app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});