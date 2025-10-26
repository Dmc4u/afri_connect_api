# AfriConnect API

A Node.js/Express API for AfriConnect.

## Setup

1. Clone the repository:
```bash
git clone https://github.com/Dmc4u/afri_connect_api.git
cd afri_connect_api
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file by copying the example:
```bash
cp .env.example .env
```

4. Edit the `.env` file with your configuration values.

## Running the Application

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The server will start on the port specified in your `.env` file (default: 3000).

## API Endpoints

### POST /api/signup
Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "username",
  "password": "password123"
}
```

**Response (Success - 201):**
```json
{
  "message": "User created successfully",
  "user": {
    "email": "user@example.com",
    "username": "username"
  }
}
```

**Response (Error - 400):**
```json
{
  "error": "Missing required fields: email, password, and username are required"
}
```

## Project Structure

```
afri_connect_api/
├── app.js              # Main application file
├── package.json        # Dependencies and scripts
├── .env.example        # Environment variables template
├── .env                # Environment variables (not committed)
└── README.md           # This file
```

## Fix for "router is not defined" Error

This repository demonstrates the correct way to define and use Express Router. The key fix is:

```javascript
// Create router BEFORE using it
const router = express.Router();

// Then use the router
router.post('/signup', validateSignup, createUser);
```

Make sure to:
1. Import express: `const express = require('express');`
2. Create the router: `const router = express.Router();`
3. Define your routes on the router
4. Mount the router to your app: `app.use('/api', router);`

## License

MIT