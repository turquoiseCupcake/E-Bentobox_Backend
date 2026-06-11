# 🍱 E-Bentobox: Backend API & WebSocket Server

Welcome to the E-Bentobox backend repository! This server powers the cross-platform Flutter application, handling everything from user authentication and relational data management to secure image uploads and real-time WebSocket notifications.

This document is designed to onboard new developers. Please read through the architecture and setup instructions before submitting pull requests.

---

## 🛠 Tech Stack

* **Runtime:** Node.js
* **Framework:** Express.js
* **Database:** PostgreSQL (using the `pg` driver)
* **Real-Time:** Socket.IO
* **File Uploads:** Multer (Local storage)
* **Deployment:** AWS Lightsail (Ubuntu Linux) + PM2

---

## 🧠 System Architecture Notes for Developers

Before diving into the code, here are the core engineering concepts we use in this backend:

1.  **RESTful Design:** We strictly adhere to REST principles. URLs represent nouns (`/api/vendors`, `/api/orders`) and HTTP methods denote actions (GET, POST, PUT, DELETE).
2.  **Atomic Transactions:** The checkout route (`POST /api/orders`) uses PostgreSQL `BEGIN` and `COMMIT` transaction blocks. This ensures that if a student orders 3 items and the database crashes on the 2nd item, the entire order rolls back to prevent corrupted/partial bento boxes.
3.  **Local Image Storage:** Menu and profile images are parsed using `multer` and saved physically to the `/uploads` directory. The database only stores the string URL path (e.g., `/uploads/image_123.jpg`).
4.  **Decoupled Real-Time Logic:** WebSockets (`Socket.IO`) are *only* used for live status notifications (pushing "Order Ready" alerts to the student). Core data (like fetching menus or placing orders) remains over standard HTTP.

---

## 🚀 Local Setup & Installation

Follow these steps to get the server running on your local machine.

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v16 or higher)
* [PostgreSQL](https://www.postgresql.org/) installed and running locally.

### 2. Clone and Install
```bash
git clone https://github.com/yourusername/e-bentobox-backend.git
cd e-bentobox-backend
npm install
```

### 3. Database Setup
1. Open your local PostgreSQL CLI (`psql`) or a GUI like pgAdmin/DBeaver.
2. Create the database: `CREATE DATABASE ebentobox;`
3. Run the SQL script provided in the repository to generate the schema:
   ```bash
   psql -U postgres -d ebentobox -f database_schema.sql
   ```

### 4. Environment Variables
Create a `.env` file in the root directory and add your local configurations:
```env
# Server Config
PORT=3000

# PostgreSQL Database Config
DB_USER=postgres
DB_PASSWORD=your_local_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ebentobox
```

### 5. Start the Server
For development (auto-restarts on save):
```bash
npm run dev
```
For production:
```bash
npm start
```

---

## 🗄️ Database Schema Overview

We use a highly normalized relational database. Here is how the tables interact:

* `users`: Stores student/customer profiles and tracks their `strike_count` (for the anti-spam ban system).
* `vendors`: Stores carenderia profiles, map coordinates (`latitude`/`longitude`), and branding images.
* `menu_items`: Food items linked to a `vendor_id`. Includes the `is_available` and `is_available_tomorrow` toggles.
* `orders`: The main reservation receipt. Links a `user_id` to a `vendor_id`. Stores the `qr_sticker_id` used for physical box claiming.
* `order_items`: The bridge table. A single `order_id` can have multiple `order_items` (e.g., 1 Rice, 2 Ulam).

---

## 📡 Core API Routes

Here is a high-level overview of our primary endpoints. 

### Authentication
* `POST /api/register` - Create User/Vendor
* `POST /api/login` - Authenticate and return user object
* `PUT /api/change-password` - Update password

### Vendor & Menu Management
* `GET /api/vendors` - Fetch all active vendors
* `GET /api/vendors/:id` - Get specific vendor profile
* `PUT /api/vendors/:id` - Update vendor profile & map coordinates
* `GET /api/menu-items/:vendorId` - Fetch vendor's menu
* `POST /api/menu-items` - Add new food item
* `PUT /api/menu-items/:id` - Edit food item
* `DELETE /api/menu-items/:id` - Delete food item (Throws 400 if part of an existing order history)

### Order Fulfillment (The QR Loop)
* `POST /api/orders` - Submit cart (Atomic Transaction)
* `GET /api/users/:userId/orders` - Fetch student reservations
* `GET /api/vendors/:vendorId/orders` - Fetch incoming vendor orders
* `PUT /api/orders/:orderId/status` - Update status (`Accepted`, `Ready`, `Claimed`) and assign `qr_sticker_id`.

### File Uploads
* `POST /api/upload` - Expects `multipart/form-data` with a key of `image`. Returns the public URL path.

---

## 🔔 WebSocket Events (Socket.IO)

The backend runs a Socket.IO instance on the same port as the Express server.

* **Connection:** Clients connect automatically on app launch.
* **Event Emitted (`order_status_update`):** When a vendor hits `PUT /api/orders/:orderId/status`, the Express route triggers a global socket broadcast:
    ```json
    {
      "orderId": "uuid-string",
      "userId": "uuid-string",
      "status": "Ready for Pickup"
    }
    ```
    *Note for Frontend Devs: The Flutter client listens to this global broadcast and filters by `userId` to show the notification bell.*

---

## 🤝 Contributing Guidelines

1.  **Branch Naming:** Use `feature/your-feature-name` or `bugfix/issue-description`.
2.  **No `console.log` in Production:** Clean up debugging logs before making a Pull Request.
3.  **Database Changes:** If you need to alter a table, please share the raw `ALTER TABLE` SQL snippet in your PR description so the DevOps lead can apply it to the AWS production server.
