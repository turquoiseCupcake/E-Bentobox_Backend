const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

// NEW: Add HTTP and Socket.IO imports
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');

const app = express();

// NEW: Wrap the Express app with a standard HTTP server
const server = http.createServer(app);

// NEW: Initialize Socket.IO with CORS enabled so Flutter can connect
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

// Listen for live connections
io.on('connection', (socket) => {
  console.log('📱 A user connected to live notifications: ' + socket.id);
  
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
      const result = await pool.query('SELECT * FROM vendors WHERE LOWER(email) = LOWER($1)', [email]);
      userRecord = result.rows[0];
    } else {
      const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
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
      'SELECT id, store_name, location_description, profile_image_url, cover_image_url, description, operating_hours, latitude, longitude FROM vendors WHERE is_active = true'
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
    // Updated query: Now checks BOTH availability columns to be safe!
    const query = `
      SELECT m.*, v.store_name 
      FROM menu_items m 
      JOIN vendors v ON m.vendor_id = v.id 
      WHERE m.is_available = true 
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
    // 1. Delete the row from PostgreSQL FIRST.
    // If it fails here (because of existing orders), it will jump to catch BEFORE deleting the image.
    await pool.query('DELETE FROM menu_items WHERE id = $1', [id]);

    // 2. If the delete succeeded, fetch the image URL to delete the physical file
    const itemResult = await pool.query('SELECT image_url FROM menu_items WHERE id = $1', [id]);
    
    if (itemResult.rows.length > 0) {
      const imageUrl = itemResult.rows[0].image_url;
      
      if (imageUrl) {
        const fileName = imageUrl.split('/').pop();
        const imagePath = path.join(__dirname, 'uploads', fileName);
        
        const fs = require('fs');
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
          console.log(`🗑️ Deleted image file: ${fileName}`);
        }
      }
    }

    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    // Catch the specific Foreign Key Violation error!
    if (error.code === '23503') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete: This item is part of a student\'s order history. Please toggle "Available Today" off instead.' 
      });
    }
    
    console.error('Error deleting menu item:', error);
    res.status(500).json({ success: false, message: 'Server error deleting menu item' });
  }
});

// --- GET ORDERS FOR A SPECIFIC VENDOR AND DATE (WITH OVERDUE / BACKLOG SUPPORT) ---
app.get('/api/vendors/:vendorId/orders', async (req, res) => {
  const { vendorId } = req.params;
  const { date, filter } = req.query;

  try {
    // 1. Calculate how many unresolved orders exist from previous days (< CURRENT_DATE)
    const backlogCountRes = await pool.query(`
      SELECT COUNT(id) as count 
      FROM orders 
      WHERE vendor_id = $1 
        AND reservation_date < CURRENT_DATE 
        AND status IN ('Pending', 'Accepted', 'Ready')
    `, [vendorId]);
    const backlogCount = parseInt(backlogCountRes.rows[0].count, 10) || 0;

    let query = '';
    let params = [];

    if (filter === 'backlog' || filter === 'overdue') {
      // Query all past orders that are still Pending, Accepted, or Ready
      query = `
        SELECT o.id, o.total_amount AS total, o.status, o.qr_sticker_id, 
               TO_CHAR(o.reservation_date, 'YYYY-MM-DD') AS reservation_date,
               TO_CHAR(o.reservation_date, 'Mon DD, YYYY') AS formatted_date,
               (CURRENT_DATE - o.reservation_date) AS days_overdue,
               u.id AS user_id,
               u.full_name AS customer, 
               COALESCE(u.strike_count, 0) AS customer_strikes,
               COALESCE(u.is_banned, false) AS customer_is_banned,
               COALESCE(o.strike_issued, false) AS strike_issued,
               COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') AS items
        FROM orders o
        JOIN users u ON o.user_id = u.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE o.vendor_id = $1 
          AND o.reservation_date < CURRENT_DATE 
          AND o.status IN ('Pending', 'Accepted', 'Ready')
        GROUP BY o.id, u.id, u.full_name, u.strike_count, u.is_banned
        ORDER BY o.reservation_date ASC, o.created_at ASC;
      `;
      params = [vendorId];
    } else if (filter === 'all') {
      query = `
        SELECT o.id, o.total_amount AS total, o.status, o.qr_sticker_id, 
               TO_CHAR(o.reservation_date, 'YYYY-MM-DD') AS reservation_date,
               TO_CHAR(o.reservation_date, 'Mon DD, YYYY') AS formatted_date,
               (CURRENT_DATE - o.reservation_date) AS days_overdue,
               u.id AS user_id,
               u.full_name AS customer, 
               COALESCE(u.strike_count, 0) AS customer_strikes,
               COALESCE(u.is_banned, false) AS customer_is_banned,
               COALESCE(o.strike_issued, false) AS strike_issued,
               COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') AS items
        FROM orders o
        JOIN users u ON o.user_id = u.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE o.vendor_id = $1
        GROUP BY o.id, u.id, u.full_name, u.strike_count, u.is_banned
        ORDER BY o.reservation_date DESC, o.created_at DESC
        LIMIT 50;
      `;
      params = [vendorId];
    } else if (date) {
      query = `
        SELECT o.id, o.total_amount AS total, o.status, o.qr_sticker_id, 
               TO_CHAR(o.reservation_date, 'YYYY-MM-DD') AS reservation_date,
               TO_CHAR(o.reservation_date, 'Mon DD, YYYY') AS formatted_date,
               (CURRENT_DATE - o.reservation_date) AS days_overdue,
               u.id AS user_id,
               u.full_name AS customer, 
               COALESCE(u.strike_count, 0) AS customer_strikes,
               COALESCE(u.is_banned, false) AS customer_is_banned,
               COALESCE(o.strike_issued, false) AS strike_issued,
               COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') AS items
        FROM orders o
        JOIN users u ON o.user_id = u.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE o.vendor_id = $1 AND o.reservation_date = $2
        GROUP BY o.id, u.id, u.full_name, u.strike_count, u.is_banned
        ORDER BY o.created_at ASC;
      `;
      params = [vendorId, date];
    } else {
      query = `
        SELECT o.id, o.total_amount AS total, o.status, o.qr_sticker_id, 
               TO_CHAR(o.reservation_date, 'YYYY-MM-DD') AS reservation_date,
               TO_CHAR(o.reservation_date, 'Mon DD, YYYY') AS formatted_date,
               (CURRENT_DATE - o.reservation_date) AS days_overdue,
               u.id AS user_id,
               u.full_name AS customer, 
               COALESCE(u.strike_count, 0) AS customer_strikes,
               COALESCE(u.is_banned, false) AS customer_is_banned,
               COALESCE(o.strike_issued, false) AS strike_issued,
               COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') AS items
        FROM orders o
        JOIN users u ON o.user_id = u.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE o.vendor_id = $1 AND o.reservation_date >= CURRENT_DATE
        GROUP BY o.id, u.id, u.full_name, u.strike_count, u.is_banned
        ORDER BY o.reservation_date ASC, o.created_at ASC;
      `;
      params = [vendorId];
    }

    const result = await pool.query(query, params);
    res.json({ success: true, orders: result.rows, backlogCount });
  } catch (error) {
    console.error('Error fetching vendor orders:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// --- FIND YOUR ORDER STATUS UPDATE ROUTE AND MODIFY IT ---
app.put('/api/orders/:orderId/status', async (req, res) => {
  const { orderId } = req.params;
  const { status, qr_sticker_id } = req.body;

  try {
    if (status === 'No-Show') {
      // 1. Mark order as No-Show and flag strike_issued
      const orderResult = await pool.query(
        'UPDATE orders SET status = $1, strike_issued = true, qr_sticker_id = COALESCE($2, qr_sticker_id) WHERE id = $3 RETURNING *',
        ['No-Show', qr_sticker_id, orderId]
      );

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      const updatedOrder = orderResult.rows[0];

      // 2. Increment customer strike count and apply One-Strike ban
      const userResult = await pool.query(
        `UPDATE users 
         SET strike_count = COALESCE(strike_count, 0) + 1,
             is_banned = true
         WHERE id = $1 
         RETURNING id, full_name, email, strike_count, is_banned`,
        [updatedOrder.user_id]
      );

      const updatedUser = userResult.rows[0];

      // 3. Broadcast real-time WebSocket alert
      io.emit('order_status_update', {
        orderId: updatedOrder.id,
        userId: updatedOrder.user_id,
        status: 'No-Show',
        strikeCount: updatedUser ? updatedUser.strike_count : 1,
        isBanned: updatedUser ? updatedUser.is_banned : true,
        message: 'Account received a strike for failing to claim bento box. Account suspended.'
      });

      console.log(`⚠️ [One-Strike Enforcement] Order ${orderId} marked No-Show. Strike recorded against user ${updatedOrder.user_id}.`);

      return res.json({ 
        success: true, 
        message: 'Order marked as No-Show. Strike successfully issued to customer.',
        strikeCount: updatedUser ? updatedUser.strike_count : 1,
        isBanned: updatedUser ? updatedUser.is_banned : true
      });
    }

    const result = await pool.query(
      'UPDATE orders SET status = $1, qr_sticker_id = COALESCE($2, qr_sticker_id) WHERE id = $3 RETURNING *',
      [status, qr_sticker_id, orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const updatedOrder = result.rows[0];

    // NEW: Broadcast this update instantly to all connected Flutter apps!
    io.emit('order_status_update', {
      orderId: updatedOrder.id,
      userId: updatedOrder.user_id,
      status: updatedOrder.status,
    });

    res.json({ success: true, message: 'Status updated successfully' });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ success: false, message: 'Server error updating status' });
  }
});

// --- GET USER ACCOUNT STANDING & STRIKE COUNT ---
app.get('/api/users/:userId/standing', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, full_name, email, COALESCE(strike_count, 0) AS strike_count, COALESCE(is_banned, false) AS is_banned FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error fetching user standing:', error);
    res.status(500).json({ success: false, message: 'Server error fetching user standing' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { user_id, vendor_id, total_amount, reservation_date, items } = req.body;

  // 0. Verify customer standing (One-Strike Anti-Abandonment rule)
  try {
    const userCheck = await pool.query('SELECT is_banned, strike_count FROM users WHERE id = $1', [user_id]);
    if (userCheck.rows.length > 0 && userCheck.rows[0].is_banned) {
      return res.status(403).json({
        success: false,
        message: 'Account suspended due to an uncollected meal strike. Advance meal reservations are blocked.'
      });
    }
  } catch (err) {
    console.error('Error checking user ban standing:', err);
  }

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

// --- GET ORDERS FOR A SPECIFIC USER (STUDENT) AND DATE (WITH OVERDUE / BACKLOG SUPPORT) ---
app.get('/api/users/:userId/orders', async (req, res) => {
  const { userId } = req.params;
  const { date, filter } = req.query;

  try {
    // 1. Backlog count for user: past uncollected orders (< CURRENT_DATE, status in Pending, Accepted, Ready)
    const backlogCountRes = await pool.query(`
      SELECT COUNT(id) as count 
      FROM orders 
      WHERE user_id = $1 
        AND reservation_date < CURRENT_DATE 
        AND status IN ('Pending', 'Accepted', 'Ready')
    `, [userId]);
    const backlogCount = parseInt(backlogCountRes.rows[0].count, 10) || 0;

    let query = '';
    let params = [];

    if (filter === 'backlog' || filter === 'overdue') {
      query = `
        SELECT o.id, o.total_amount AS total, o.status, o.qr_sticker_id, 
               TO_CHAR(o.reservation_date, 'YYYY-MM-DD') AS reservation_date,
               TO_CHAR(o.reservation_date, 'Mon DD, YYYY') AS formatted_date,
               (CURRENT_DATE - o.reservation_date) AS days_overdue,
               v.store_name AS vendor_name, v.latitude AS vendor_latitude, v.longitude AS vendor_longitude, v.location_description, 
               COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') AS items
        FROM orders o
        JOIN vendors v ON o.vendor_id = v.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE o.user_id = $1 
          AND o.reservation_date < CURRENT_DATE 
          AND o.status IN ('Pending', 'Accepted', 'Ready')
        GROUP BY o.id, v.store_name, v.latitude, v.longitude, v.location_description
        ORDER BY o.reservation_date ASC, o.created_at ASC;
      `;
      params = [userId];
    } else if (filter === 'all') {
      query = `
        SELECT o.id, o.total_amount AS total, o.status, o.qr_sticker_id, 
               TO_CHAR(o.reservation_date, 'YYYY-MM-DD') AS reservation_date,
               TO_CHAR(o.reservation_date, 'Mon DD, YYYY') AS formatted_date,
               (CURRENT_DATE - o.reservation_date) AS days_overdue,
               v.store_name AS vendor_name, v.latitude AS vendor_latitude, v.longitude AS vendor_longitude, v.location_description, 
               COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') AS items
        FROM orders o
        JOIN vendors v ON o.vendor_id = v.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE o.user_id = $1
        GROUP BY o.id, v.store_name, v.latitude, v.longitude, v.location_description
        ORDER BY o.reservation_date DESC, o.created_at DESC
        LIMIT 50;
      `;
      params = [userId];
    } else if (date) {
      query = `
        SELECT o.id, o.total_amount AS total, o.status, o.qr_sticker_id, 
               TO_CHAR(o.reservation_date, 'YYYY-MM-DD') AS reservation_date,
               TO_CHAR(o.reservation_date, 'Mon DD, YYYY') AS formatted_date,
               (CURRENT_DATE - o.reservation_date) AS days_overdue,
               v.store_name AS vendor_name, v.latitude AS vendor_latitude, v.longitude AS vendor_longitude, v.location_description, 
               COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') AS items
        FROM orders o
        JOIN vendors v ON o.vendor_id = v.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE o.user_id = $1 AND o.reservation_date = $2
        GROUP BY o.id, v.store_name, v.latitude, v.longitude, v.location_description
        ORDER BY o.created_at ASC;
      `;
      params = [userId, date];
    } else {
      query = `
        SELECT o.id, o.total_amount AS total, o.status, o.qr_sticker_id, 
               TO_CHAR(o.reservation_date, 'YYYY-MM-DD') AS reservation_date,
               TO_CHAR(o.reservation_date, 'Mon DD, YYYY') AS formatted_date,
               (CURRENT_DATE - o.reservation_date) AS days_overdue,
               v.store_name AS vendor_name, v.latitude AS vendor_latitude, v.longitude AS vendor_longitude, v.location_description, 
               COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') AS items
        FROM orders o
        JOIN vendors v ON o.vendor_id = v.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE o.user_id = $1 AND o.reservation_date >= CURRENT_DATE
        GROUP BY o.id, v.store_name, v.latitude, v.longitude, v.location_description
        ORDER BY o.reservation_date ASC, o.created_at ASC;
      `;
      params = [userId];
    }

    const result = await pool.query(query, params);
    res.json({ success: true, orders: result.rows, backlogCount });
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ success: false, message: 'Server error fetching orders' });
  }
});

// --- CHANGE PASSWORD ROUTE (For both Users and Vendors) ---
app.put('/api/change-password', async (req, res) => {
  const { userId, role, oldPassword, newPassword } = req.body;

  try {
    // Determine which table to check based on the role
    const tableName = role === 'Vendor' ? 'vendors' : 'users';

    // 1. Fetch the current password to verify it matches
    const userRes = await pool.query(`SELECT password_hash FROM ${tableName} WHERE id = $1`, [userId]);
    
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    const currentPassword = userRes.rows[0].password_hash;

    // 2. Verify old password
    if (currentPassword !== oldPassword) {
      return res.status(401).json({ success: false, message: 'Incorrect old password.' });
    }

    // 3. Update to the new password
    await pool.query(`UPDATE ${tableName} SET password_hash = $1 WHERE id = $2`, [newPassword, userId]);

    res.json({ success: true, message: 'Password updated successfully!' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ success: false, message: 'Server error changing password.' });
  }
});



// --- GET VENDOR SALES ANALYTICS & INSIGHTS ---
app.get('/api/vendors/:vendorId/analytics', async (req, res) => {
  const { vendorId } = req.params;

  try {
    // 1. Overall Key Performance Indicators (KPIs)
    const kpiQuery = `
      SELECT 
        COUNT(id) as total_orders,
        COALESCE(SUM(CASE WHEN status IN ('Claimed', 'Ready', 'Accepted') THEN total_amount ELSE 0 END), 0) as total_revenue,
        COALESCE(COUNT(CASE WHEN status = 'Claimed' THEN 1 END), 0) as claimed_count,
        COALESCE(COUNT(CASE WHEN status = 'Ready' THEN 1 END), 0) as ready_count,
        COALESCE(COUNT(CASE WHEN status = 'Accepted' THEN 1 END), 0) as accepted_count,
        COALESCE(COUNT(CASE WHEN status = 'Pending' THEN 1 END), 0) as pending_count,
        COALESCE(COUNT(CASE WHEN status = 'Rejected' THEN 1 END), 0) as rejected_count,
        COALESCE(AVG(CASE WHEN status IN ('Claimed', 'Ready', 'Accepted') THEN total_amount END), 0) as avg_order_value
      FROM orders
      WHERE vendor_id = $1;
    `;
    const kpiRes = await pool.query(kpiQuery, [vendorId]);
    const kpi = kpiRes.rows[0];

    // 2. Daily Sales Trend (Grouped by reservation date)
    const trendQuery = `
      SELECT 
        TO_CHAR(reservation_date, 'YYYY-MM-DD') as date,
        TO_CHAR(reservation_date, 'Mon DD') as date_label,
        TO_CHAR(reservation_date, 'Dy') as day_label,
        COALESCE(SUM(total_amount), 0) as revenue,
        COUNT(id) as order_count
      FROM orders
      WHERE vendor_id = $1 AND status IN ('Claimed', 'Ready', 'Accepted')
      GROUP BY reservation_date
      ORDER BY reservation_date ASC
      LIMIT 14;
    `;
    const trendRes = await pool.query(trendQuery, [vendorId]);

    // 3. Top-Selling Menu Dishes (Uses price_at_time to ensure Invariant 2 Price Immutability)
    const topDishesQuery = `
      SELECT 
        m.name,
        m.category,
        COALESCE(SUM(oi.quantity), 0) as total_qty,
        COALESCE(SUM(oi.quantity * oi.price_at_time), 0) as total_earned
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE o.vendor_id = $1 AND o.status IN ('Claimed', 'Ready', 'Accepted')
      GROUP BY m.id, m.name, m.category
      ORDER BY total_qty DESC
      LIMIT 5;
    `;
    const topDishesRes = await pool.query(topDishesQuery, [vendorId]);

    // 4. Recent Sales History Log
    const recentSalesQuery = `
      SELECT 
        o.id,
        o.total_amount,
        o.status,
        TO_CHAR(o.reservation_date, 'Mon DD, YYYY') as formatted_date,
        u.full_name as customer_name,
        COALESCE(string_agg(oi.quantity || 'x ' || m.name, ', '), 'No items') as items_summary,
        o.created_at
      FROM orders o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE o.vendor_id = $1
      GROUP BY o.id, u.full_name
      ORDER BY o.reservation_date DESC, o.created_at DESC
      LIMIT 15;
    `;
    const recentSalesRes = await pool.query(recentSalesQuery, [vendorId]);

    res.json({
      success: true,
      summary: {
        totalRevenue: parseFloat(kpi.total_revenue) || 0,
        totalOrders: parseInt(kpi.total_orders, 10) || 0,
        claimedOrders: parseInt(kpi.claimed_count, 10) || 0,
        readyOrders: parseInt(kpi.ready_count, 10) || 0,
        acceptedOrders: parseInt(kpi.accepted_count, 10) || 0,
        pendingOrders: parseInt(kpi.pending_count, 10) || 0,
        rejectedOrders: parseInt(kpi.rejected_count, 10) || 0,
        avgOrderValue: parseFloat(kpi.avg_order_value) || 0,
      },
      dailyTrend: trendRes.rows.map(r => ({
        date: r.date,
        dateLabel: r.date_label,
        dayLabel: r.day_label,
        revenue: parseFloat(r.revenue) || 0,
        orderCount: parseInt(r.order_count, 10) || 0,
      })),
      topDishes: topDishesRes.rows.map(r => ({
        name: r.name,
        category: r.category,
        totalQty: parseInt(r.total_qty, 10) || 0,
        totalEarned: parseFloat(r.total_earned) || 0,
      })),
      recentSales: recentSalesRes.rows,
    });
  } catch (error) {
    console.error('Analytics Error:', error);
    res.status(500).json({ success: false, message: 'Server error generating sales analytics' });
  }
});


// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server and WebSockets are running on port ${PORT}`);
});