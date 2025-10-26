require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create router
const router = express.Router();

// Middleware functions
const validateSignup = (req, res, next) => {
  // TODO: Add signup validation logic
  const { email, password, username } = req.body;
  
  if (!email || !password || !username) {
    return res.status(400).json({ 
      error: 'Missing required fields: email, password, and username are required' 
    });
  }
  
  // Basic email validation using a safer approach
  // Check for @ symbol and basic structure without complex regex
  if (typeof email !== 'string' || !email.includes('@') || email.indexOf('@') === 0 || email.indexOf('@') === email.length - 1) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  const parts = email.split('@');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0 || !parts[1].includes('.')) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  // Password length check
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }
  
  next();
};

const createUser = (req, res) => {
  // TODO: Add user creation logic
  const { email, username } = req.body;
  
  res.status(201).json({ 
    message: 'User created successfully',
    user: {
      email,
      username
    }
  });
};

// Routes
router.post('/signup', validateSignup, createUser);

// Mount router
app.use('/api', router);

// Basic route for testing
app.get('/', (req, res) => {
  res.json({ message: 'AfriConnect API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
