const express = require('express');
const { sql, poolPromise } = require('./db'); // Import sql and poolPromise
const app = express();
const session = require('express-session');  // Import express-session
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const fetch = require('node-fetch');
const multer = require('multer');
const cors = require('cors');
const bodyParser = require('body-parser');



// Set up Multer for file uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const paymentsDir = path.join(__dirname, 'images', 'payments');
            if (!fs.existsSync(paymentsDir)) {
                fs.mkdirSync(paymentsDir, { recursive: true });
            }
            cb(null, paymentsDir);
        },
        filename: (req, file, cb) => {
            cb(null, `${Date.now()}-${file.originalname}`);
        },
    }),
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    },
});


const receiptsDir = path.join(__dirname, 'receipts');

// Ensure the receipts directory exists
if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir);
}


const bcrypt = require('bcrypt');

// Middleware to parse JSON request bodies
app.use(express.json());
app.use(bodyParser.json());

// Set up session management with express-session
app.use(session({
    secret: 'yourSecretKey',   // Replace with a strong, unique secret key
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }  // Set secure: true if using HTTPS in production
}));

// Allow requests from your GitHub Pages site
const corsOptions = {
    origin: 'https://mrdiegorobot.github.io', // Update with your GitHub Pages URL
    methods: 'GET,POST,PUT,DELETE',
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true, // Allow cookies if needed
};

app.use(cors(corsOptions));

// Set 'moody' as the public folder for static files
app.use(express.static('moody'));

// Serve the main HTML file in the 'moody' folder
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/moody/index.html');
});

app.post('/add-to-cart', async (req, res) => {
    const { productName, quantity, price, productImg } = req.body;
    const userId = req.session.userId; // Get userId from session

    if (!userId) {
        return res.status(400).send('User not logged in');
    }

    if (!productName || quantity === undefined || price === undefined || !productImg) {
        return res.status(400).send('Missing required fields');
    }

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('UserId', sql.Int, userId)  // Pass UserId to the query
            .input('ProductName', sql.NVarChar, productName)
            .input('Quantity', sql.Int, quantity)
            .input('Price', sql.Decimal(10, 2), price)
            .input('ProductImg', sql.NVarChar, productImg)
            .query(`
                INSERT INTO Cart (UserId, ProductName, Quantity, Price, ProductImg)
                VALUES (@UserId, @ProductName, @Quantity, @Price, @ProductImg)
            `);

        res.status(200).send('Product added to cart');
    } catch (err) {
        console.error('Error adding to cart:', err);
        res.status(500).send('An error occurred while adding to the cart.');
    }
});


app.get('/cart', async (req, res) => {
    const userId = req.session.userId; // Get userId from session

    if (!userId) {
        return res.status(400).send('User not logged in');
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserId', sql.Int, userId)
            .query('SELECT * FROM Cart WHERE UserId = @UserId');

        res.json(result.recordset);
    } catch (err) {
        console.error('Error retrieving cart items:', err);
        res.status(500).send('Error retrieving cart items from database');
    }
});



app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required.' });
        }

        const pool = await poolPromise;
        const userResult = await pool.request()
            .input('Username', sql.NVarChar, username)
            .query('SELECT UserId, PasswordHash FROM Users WHERE Username = @Username');

        if (userResult.recordset.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }

        const user = userResult.recordset[0];
        const isMatch = await bcrypt.compare(password, user.PasswordHash);

        if (isMatch) {
            req.session.userId = user.UserId;  // Store user ID in session
            res.status(200).json({ message: 'Login successful.' });
        } else {
            res.status(401).json({ message: 'Invalid username or password.' });
        }
    } catch (err) {
        console.error('Error during login:', err);
        res.status(500).json({ message: 'An error occurred during login.' });
    }
});


app.delete('/remove-from-cart', async (req, res) => {
    const { cartId } = req.body;
    const userId = req.session.userId; // Get userId from session

    if (!userId) {
        return res.status(400).send('User not logged in');
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserId', sql.Int, userId)
            .input('CartId', sql.Int, cartId)
            .query(`
                DELETE FROM Cart
                WHERE CartId = @CartId AND UserId = @UserId
            `);

        if (result.rowsAffected[0] > 0) {
            res.status(200).send('Item removed from cart');
        } else {
            res.status(404).send('Item not found in cart');
        }
    } catch (err) {
        console.error('Error removing item from cart:', err);
        res.status(500).send('An error occurred while removing the item from the cart');
    }
});


app.put('/update-cart-quantity', async (req, res) => {
    const { cartId, quantity } = req.body;
    const userId = req.session.userId; // Get userId from session

    if (!userId) {
        return res.status(400).send('User not logged in');
    }

    if (quantity < 1) {
        return res.status(400).send('Quantity must be at least 1');
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserId', sql.Int, userId)
            .input('CartId', sql.Int, cartId)
            .input('Quantity', sql.Int, quantity)
            .query(`
                UPDATE Cart
                SET Quantity = @Quantity
                WHERE CartId = @CartId AND UserId = @UserId
            `);

        if (result.rowsAffected[0] > 0) {
            res.status(200).send('Cart quantity updated');
        } else {
            res.status(404).send('Product not found in cart');
        }
    } catch (err) {
        console.error('Error updating cart quantity:', err);
        res.status(500).send('An error occurred while updating the cart quantity');
    }
});

app.post('/submit-order', upload.single('paymentImage'), async (req, res) => {
    const { orderType, totalAmount } = req.body;
    const userId = req.session.userId; // Ensure the user is logged in
    const paymentImage = req.file ? `/images/payments/${req.file.filename}` : null;

    if (!userId) {
        return res.status(400).send('User not logged in');
    }

    try {
        const cartItems = JSON.parse(req.body.cartItems); // Parse cart items from JSON
        if (!cartItems || cartItems.length === 0) {
            return res.status(400).json({ message: 'Cart is empty. Cannot place order.' });
        }

        const pool = await poolPromise;

        // Insert order details into Orders table
        const result = await pool.request()
            .input('UserId', sql.Int, userId)
            .input('TotalAmount', sql.Float, parseFloat(totalAmount))
            .input('OrderType', sql.VarChar, orderType)
            .input('PaymentImage', sql.VarChar, paymentImage)
            .input('CreatedAt', sql.DateTime, new Date())
            .query(`
                INSERT INTO Orders (UserId, TotalAmount, OrderType, PaymentImage, CreatedAt)
                OUTPUT INSERTED.OrderId
                VALUES (@UserId, @TotalAmount, @OrderType, @PaymentImage, @CreatedAt)
            `);

        const orderId = result.recordset[0].OrderId;

        // Insert order items into OrderItems table
        for (let item of cartItems) {
            await pool.request()
                .input('OrderId', sql.Int, orderId)
                .input('ProductName', sql.VarChar, item.ProductName)
                .input('Quantity', sql.Int, parseInt(item.Quantity))
                .input('Price', sql.Float, parseFloat(item.Price))
                .query(`
                    INSERT INTO OrderItems (OrderId, ProductName, Quantity, Price)
                    VALUES (@OrderId, @ProductName, @Quantity, @Price)
                `);
        }

        // Clear cart for the user
        await pool.request()
            .input('UserId', sql.Int, userId)
            .query('DELETE FROM Cart WHERE UserId = @UserId');

        res.status(200).json({
            message: 'Order placed successfully',
            orderId: orderId,
            paymentImage: paymentImage,
        });
    } catch (error) {
        console.error('Error saving order:', error);
        res.status(500).send('Error processing order');
    }
});




// Endpoint to download the receipt
app.get('/download-receipt', (req, res) => {
    const receiptPath = path.join(__dirname, 'receipts', 'receipt.pdf');
    res.download(receiptPath, 'receipt.pdf', (err) => {
        if (err) {
            console.error('Error downloading receipt:', err);
            res.status(500).send('Error downloading receipt');
        }
    });
});


app.post('/register', async (req, res) => {
    const { username, password, email } = req.body;

    if (!username || !password || !email) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        // Check if the username or email already exists
        const pool = await poolPromise;
        const checkUser = await pool.request()
            .input('Username', sql.VarChar, username)
            .input('Email', sql.VarChar, email)
            .query('SELECT * FROM Users WHERE Username = @Username OR Email = @Email');

        if (checkUser.recordset.length > 0) {
            return res.status(400).json({ message: 'Username or email already exists.' });
        }

        // Hash the password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert the new user into the database
        await pool.request()
            .input('Username', sql.VarChar, username)
            .input('PasswordHash', sql.VarChar, hashedPassword)
            .input('Email', sql.VarChar, email)
            .query('INSERT INTO Users (Username, PasswordHash, Email) VALUES (@Username, @PasswordHash, @Email)');

        res.status(201).json({ message: 'User registered successfully.' });
    } catch (err) {
        console.error('Error registering user:', err);
        res.status(500).json({ message: 'Internal server error.' });
    }
});


app.get('/orders', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM Orders ORDER BY CreatedAt DESC');
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).send('Error fetching orders');
    }
});


app.get('/orders/:orderId/items', async (req, res) => {
    const { orderId } = req.params;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('OrderId', sql.Int, orderId)
            .query('SELECT * FROM OrderItems WHERE OrderId = @OrderId');
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error('Error fetching order items:', error);
        res.status(500).send('Error fetching order items');
    }
});

app.post('/update-order-state/:orderId', async (req, res) => {
    const orderId = req.params.orderId;
    const { state } = req.body;

    try {
        // Get a connection from the pool
        const pool = await poolPromise;

        // Prepare and execute the query
        const result = await pool.request()
            .input('state', sql.VarChar(20), state)
            .input('orderId', sql.Int, orderId)
            .query('UPDATE Orders SET OrderState = @state WHERE OrderId = @orderId');

        res.json({ success: true });
    } catch (err) {
        console.error('Failed to update order state:', err);
        res.status(500).json({ success: false, message: 'Failed to update order state' });
    }
});


app.post('/admin/register', async (req, res) => {
    const { username, password, email } = req.body;

    if (!username || !password || !email) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        const pool = await poolPromise;
        const checkAdmin = await pool.request()
            .input('Username', sql.VarChar, username)
            .input('Email', sql.VarChar, email)
            .query('SELECT * FROM Admins WHERE Username = @Username OR Email = @Email');

        if (checkAdmin.recordset.length > 0) {
            return res.status(400).json({ message: 'Username or email already exists.' });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        await pool.request()
            .input('Username', sql.VarChar, username)
            .input('PasswordHash', sql.VarChar, hashedPassword)
            .input('Email', sql.VarChar, email)
            .query('INSERT INTO Admins (Username, PasswordHash, Email) VALUES (@Username, @PasswordHash, @Email)');

        res.status(201).json({ message: 'Admin registered successfully.' });
    } catch (err) {
        console.error('Error registering admin:', err);
        res.status(500).json({ message: 'Internal server error.' });
    }
});



app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        const pool = await poolPromise;
        const adminResult = await pool.request()
            .input('Username', sql.VarChar, username)
            .query('SELECT AdminId, PasswordHash FROM Admins WHERE Username = @Username');

        if (adminResult.recordset.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }

        const admin = adminResult.recordset[0];
        const isMatch = await bcrypt.compare(password, admin.PasswordHash);

        if (isMatch) {
            req.session.adminId = admin.AdminId;
            res.status(200).json({ message: 'Login successful.', adminId: admin.AdminId });
        } else {
            res.status(401).json({ message: 'Invalid username or password.' });
        }
    } catch (err) {
        console.error('Error during admin login:', err);
        res.status(500).json({ message: 'An error occurred during login.' });
    }
});


app.get('/users', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT UserId, Username, Email FROM Users');
        res.status(200).json(result.recordset);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ message: 'Internal server error.' });
    }
});


app.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { username, email } = req.body;

    if (!username || !email) {
        return res.status(400).json({ message: 'Username and email are required.' });
    }

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('UserId', sql.Int, id)
            .input('Username', sql.VarChar, username)
            .input('Email', sql.VarChar, email)
            .query('UPDATE Users SET Username = @Username, Email = @Email WHERE UserId = @UserId');
        
        res.status(200).json({ message: 'User updated successfully.' });
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ message: 'Internal server error.' });
    }
});


app.delete('/users/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const pool = await poolPromise;

        // Step 1: Delete related OrderItems
        await pool.request()
            .input('UserId', sql.Int, id) // Pass the UserId input here
            .query(`
                DELETE OrderItems
                FROM OrderItems
                INNER JOIN Orders ON OrderItems.OrderId = Orders.OrderId
                WHERE Orders.UserId = @UserId
            `);

        // Step 2: Delete related Orders
        await pool.request()
            .input('UserId', sql.Int, id) // Pass the UserId input again
            .query('DELETE FROM Orders WHERE UserId = @UserId');

        // Step 3: Delete the user
        await pool.request()
            .input('UserId', sql.Int, id) // Pass the UserId input again
            .query('DELETE FROM Users WHERE UserId = @UserId');

        res.status(200).json({ message: 'User and related orders and order items deleted successfully.' });
    } catch (err) {
        console.error('Error deleting user and related records:', err);
        res.status(500).json({ message: 'Internal server error.', error: err.message });
    }
});









const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
