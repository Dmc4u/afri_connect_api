# AfriOnet API - Backend Server# afri_onet_api



![License](https://img.shields.io/badge/license-ISC-blue.svg)How to Generate Them (Securely)

![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)

![Express](https://img.shields.io/badge/express-5.1.0-blue.svg)You can create both secrets easily in your terminal:



Backend API server for AfriOnet - A comprehensive business networking platform connecting professionals and businesses across Africa.✅ Option 1: Use Node.js



**Developed by:** Moses Ademola Aina  Run this in your terminal:

**Company:** DMC LIMITED

node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

---

This will print something like:

## 📋 Table of Contents

a3f94d57e13bb4e7e5a0e88a2c14b87e6b7f8d6e0a13ad5bbd6a02a7c5e45bce...

- [Features](#-features)

- [Tech Stack](#-tech-stack)Now you have a secure random key.

- [Project Structure](#-project-structure)

- [Prerequisites](#-prerequisites)Do this twice — one for each variable:

- [Installation](#-installation)

- [Environment Configuration](#-environment-configuration)JWT_SECRET

- [Running the Application](#-running-the-application)

- [API Endpoints](#-api-endpoints)JWT_SESSION_SECRET

- [Database Models](#-database-models)

- [Middleware](#-middleware)🧾 3. Add Them to .env

- [Testing](#-testing)
- [Deployment](#-deployment)

---

## ✨ Features

### Core Functionality
- 🔐 **JWT Authentication** - Secure user authentication and authorization
- 💬 **Real-time Messaging** - Socket.io powered instant messaging
- 📧 **Email Notifications** - Nodemailer integration
- 🖼️ **Image Upload** - Cloudinary integration for file storage
- 💳 **Payment Processing** - PayPal and 2Checkout integration
- 🔍 **Advanced Search** - Full-text search with MongoDB
- ⭐ **Reviews & Ratings** - User feedback system
- 📊 **Analytics & Logging** - Winston-based logging system

### Security Features
- 🛡️ **Rate Limiting** - Express rate limiter
- 🔒 **Helmet.js** - Security headers
- ✅ **Input Validation** - Celebrate and Express-validator
- 🤖 **reCAPTCHA** - Bot protection
- 📝 **Activity Logging** - User activity tracking

### Tier-Based Access Control
- **Free** - Basic features
- **Starter** - Enhanced visibility ($3/month)
- **Premium** - Forum + Advanced search ($7/month)
- **Pro** - Full API access ($20/month)

---

## 🛠 Tech Stack

### Core Technologies
- **Runtime:** Node.js >= 18.0.0
- **Framework:** Express.js 5.1.0
- **Database:** MongoDB (Mongoose 8.19.1)
- **Real-time:** Socket.io 4.7.2

### Authentication & Security
- **jsonwebtoken** 9.0.2 - JWT authentication
- **bcryptjs** 3.0.2 - Password hashing
- **helmet** 8.1.0 - Security headers
- **express-rate-limit** 8.1.0 - Rate limiting
- **cors** 2.8.5 - CORS handling

### Validation & Error Handling
- **celebrate** 15.0.3 - Request validation
- **express-validator** 7.3.0 - Input validation
- **validator** 13.15.15 - String validation

### File Upload & Storage
- **cloudinary** 1.41.3 - Cloud storage
- **multer** 2.0.2 - File upload middleware
- **multer-storage-cloudinary** 4.0.0 - Cloudinary integration

### Payment Integration
- **PayPal SDK** - Payment processing
- **2Checkout** - Alternative payment gateway

### Communication
- **nodemailer** 7.0.10 - Email service
- **node-fetch** 3.3.2 - HTTP requests

### Logging & Monitoring
- **winston** 3.18.3 - Logging framework
- **express-winston** 4.2.0 - Express integration

### Utilities
- **dotenv** 17.2.3 - Environment variables
- **uuid** 13.0.0 - Unique identifiers

---

## 📁 Project Structure

```
afri_connect_api/
├── app.js                    # Application entry point
├── package.json              # Dependencies and scripts
├── .env                      # Environment variables (create this)
├── controllers/              # Request handlers
│   ├── api.js               # API key management
│   ├── apiExport.js         # API export functionality
│   ├── checkout.js          # 2Checkout payment handling
│   ├── contact.js           # Contact messages
│   ├── contactThread.js     # Contact threads
│   ├── featured.js          # Featured placements
│   ├── forum.js             # Forum posts & replies
│   ├── listing.js           # Business listings
│   ├── membership.js        # Membership management
│   ├── messaging.js         # Real-time messaging
│   ├── paypal.js            # PayPal integration
│   ├── pricing.js           # Pricing settings
│   ├── reviews.js           # Review system
│   ├── search.js            # Search functionality
│   └── user.js              # User authentication & profile
├── middlewares/              # Custom middleware
│   ├── apiAuth.js           # API authentication
│   ├── auth.js              # User authentication
│   ├── cloudinaryLogger.js  # Cloudinary logging
│   ├── error-handler.js     # Global error handler
│   ├── logger.js            # Winston logger
│   ├── optionalAuth.js      # Optional authentication
│   ├── rateLimiter.js       # Rate limiting
│   ├── recaptcha.js         # reCAPTCHA verification
│   ├── tierCheck.js         # Tier access control
│   ├── upload.js            # File upload (listings)
│   ├── uploadProfile.js     # Profile image upload
│   └── validation.js        # Input validation
├── models/                   # MongoDB schemas
│   ├── ActivityLog.js       # User activity tracking
│   ├── Announcement.js      # System announcements
│   ├── ApiKey.js            # API key storage
│   ├── ApiUsage.js          # API usage tracking
│   ├── ContactMessage.js    # Contact messages
│   ├── Conversation.js      # Message conversations
│   ├── FeaturedPlacement.js # Featured listings
│   ├── ForumPost.js         # Forum posts
│   ├── LeadGeneration.js    # Lead tracking
│   ├── Listing.js           # Business listings
│   ├── Message.js           # Chat messages
│   ├── MessageNotification.js # Message notifications
│   ├── News.js              # News articles
│   ├── Payment.js           # Payment records
│   ├── PaypalTransaction.js # PayPal transactions
│   ├── PricingSettings.js   # Pricing configuration
│   ├── Review.js            # Reviews & ratings
│   ├── SavedSearch.js       # Saved searches
│   ├── TwoCheckoutTransaction.js # 2Checkout transactions
│   ├── User.js              # User accounts
│   └── Verification.js      # Email verification
├── routes/                   # API routes
│   ├── admin.js             # Admin routes
│   ├── advertising.js       # Advertising management
│   ├── analytics.js         # Analytics endpoints
│   ├── api.js               # API management
│   ├── checkout.js          # 2Checkout routes
│   ├── contact.js           # Contact routes
│   ├── contactThread.js     # Contact threads
│   ├── featured.js          # Featured listings
│   ├── forum.js             # Forum routes
│   ├── index.js             # Main router
│   ├── leads.js             # Lead generation
│   ├── listing.js           # Listing routes
│   ├── membership.js        # Membership routes
│   ├── messaging.js         # Messaging routes
│   ├── migration.js         # Database migration
│   ├── news.js              # News routes
│   ├── paypal.js            # PayPal routes
│   ├── pricing.js           # Pricing routes
│   ├── reviews.js           # Review routes
│   ├── search.js            # Search routes
│   ├── user.js              # User routes
│   └── verification.js      # Verification routes
├── utils/                    # Utility functions
│   ├── activityLogger.js    # Activity logging
│   ├── adminCheck.js        # Admin verification
│   ├── cloudinary.js        # Cloudinary config
│   ├── config.js            # App configuration
│   ├── notifications.js     # Notification system
│   ├── paypal.js            # PayPal utilities
│   ├── socket.js            # Socket.io setup
│   ├── twocheckout.js       # 2Checkout utilities
│   └── errors/              # Custom error classes
│       ├── BadRequestError.js
│       ├── ConflictError.js
│       ├── ForbiddenError.js
│       ├── NotFoundError.js
│       └── index.js
├── scripts/                  # Utility scripts
│   ├── check-replies.js     # Check forum replies
│   ├── migrate-replies.js   # Migrate replies
│   └── restore-replies.js   # Restore replies
├── uploads/                  # Local file storage
│   ├── listings/            # Listing images
│   └── profiles/            # Profile images
└── logs/                     # Application logs
```

---

## 📦 Prerequisites

- **Node.js** >= 18.0.0 ([Download](https://nodejs.org/))
- **npm** >= 9.0.0
- **MongoDB** >= 6.0 ([Download](https://www.mongodb.com/try/download/community))
  - Or MongoDB Atlas account ([Sign up](https://www.mongodb.com/cloud/atlas))

### Required External Services

- **Cloudinary Account** - Image storage ([Sign up](https://cloudinary.com/))
- **Gmail Account** - Email notifications (with App Password)

### Optional Services

- **PayPal Developer Account** ([Sign up](https://developer.paypal.com/))
- **2Checkout Account** ([Sign up](https://www.2checkout.com/))
- **Google reCAPTCHA** ([Get keys](https://www.google.com/recaptcha/))

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Dmc4u/afri_connect_api.git
cd afri_connect_api
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Verify Installation

```bash
npm list --depth=0
```

---

## ⚙️ Environment Configuration

### Create .env File

```bash
touch .env
```

### Environment Variables

Add the following to your `.env` file:

```env
# ============================================
# SERVER CONFIGURATION
# ============================================
NODE_ENV=development
PORT=5000

# ============================================
# DATABASE
# ============================================
# Local MongoDB
MONGO_URL=mongodb://localhost:27017/afrionet

# Or MongoDB Atlas (recommended for production)
# MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/afrionet?retryWrites=true&w=majority

# ============================================
# JWT AUTHENTICATION
# ============================================
# Generate secure secrets using:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

JWT_SECRET=your_super_secret_jwt_key_minimum_64_characters_long
JWT_SESSION_SECRET=your_super_secret_session_key_minimum_64_characters_long

# ============================================
# CLOUDINARY CONFIGURATION
# ============================================
# Get from: https://cloudinary.com/console
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# ============================================
# EMAIL CONFIGURATION (Gmail)
# ============================================
# Gmail App Password: https://myaccount.google.com/apppasswords
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-16-digit-app-password
EMAIL_FROM=AfriOnet <noreply@afrionet.com>

# ============================================
# PAYPAL CONFIGURATION
# ============================================
# Sandbox: https://developer.paypal.com/dashboard/
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_client_secret
PAYPAL_MODE=sandbox
# Change to 'live' for production

# ============================================
# 2CHECKOUT CONFIGURATION
# ============================================
TWOCHECKOUT_MERCHANT_CODE=your_merchant_code
TWOCHECKOUT_SECRET_KEY=your_secret_key
TWOCHECKOUT_BUY_LINK_SECRET=your_buy_link_secret

# ============================================
# RECAPTCHA
# ============================================
# Get from: https://www.google.com/recaptcha/admin
RECAPTCHA_SECRET_KEY=your_recaptcha_secret_key

# ============================================
# FRONTEND URL
# ============================================
CLIENT_URL=http://localhost:3001
# Production: https://afrionet.com

# ============================================
# ADMIN CONFIGURATION
# ============================================
ADMIN_EMAIL=admin@afrionet.com
```

### Generate JWT Secrets

Run this command twice to generate both secrets:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output to `JWT_SECRET` and run again for `JWT_SESSION_SECRET`.

### Setup Gmail App Password

1. Go to [Google Account Settings](https://myaccount.google.com/)
2. Enable 2-Factor Authentication
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Generate a new app password for "Mail"
5. Copy the 16-digit password to `EMAIL_PASS`

---

## 🏃 Running the Application

### Development Mode (with auto-reload)

```bash
npm run dev
```

Server will start on `http://localhost:5000` with nodemon watching for changes.

### Production Mode

```bash
npm start
```

### Verify Server is Running

```bash
curl http://localhost:5000
```

Or open `http://localhost:5000` in your browser.

---

## 📡 API Endpoints

### Base URL
```
Development: http://localhost:5000
Production: https://api.afrionet.com
```

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/signup` | Register new user | No |
| POST | `/signin` | Login user | No |
| GET | `/users/me` | Get current user | Yes |
| PUT | `/users/me` | Update profile | Yes |
| DELETE | `/users/me` | Delete account | Yes |

### Listing Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/listings` | Get all listings | No |
| POST | `/listings` | Create listing | Yes |
| GET | `/listings/:id` | Get single listing | No |
| PUT | `/listings/:id` | Update listing | Yes (Owner) |
| DELETE | `/listings/:id` | Delete listing | Yes (Owner) |
| GET | `/listings/user/:userId` | Get user's listings | No |

### Forum Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/forum` | Get all posts | No |
| POST | `/forum` | Create post | Yes (Premium+) |
| GET | `/forum/:id` | Get single post | No |
| POST | `/forum/:id/reply` | Reply to post | Yes |
| DELETE | `/forum/:id` | Delete post | Yes (Owner/Admin) |

### Messaging Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/messaging/conversations` | Get conversations | Yes |
| POST | `/messaging/send` | Send message | Yes |
| GET | `/messaging/:conversationId` | Get messages | Yes |
| PUT | `/messaging/:messageId/read` | Mark as read | Yes |

### Review Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/reviews/:listingId` | Create review | Yes |
| GET | `/reviews/:listingId` | Get listing reviews | No |
| PUT | `/reviews/:id` | Update review | Yes (Owner) |
| DELETE | `/reviews/:id` | Delete review | Yes (Owner) |

### Search Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/search?q=query` | Search listings | No |
| GET | `/search/advanced` | Advanced search | Yes (Premium+) |
| POST | `/search/save` | Save search | Yes |

### Payment Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/paypal/create-order` | Create PayPal order | Yes |
| POST | `/paypal/capture-order` | Capture payment | Yes |
| POST | `/checkout/process` | 2Checkout payment | Yes |
| GET | `/payments/history` | Payment history | Yes |

### Admin Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/admin/users` | Get all users | Yes (Admin) |
| GET | `/admin/analytics` | Get analytics | Yes (Admin) |
| PUT | `/admin/users/:id/tier` | Update user tier | Yes (Admin) |
| DELETE | `/admin/listings/:id` | Delete listing | Yes (Admin) |

### Authentication Header

For protected routes, include JWT token:

```
Authorization: Bearer <your_jwt_token>
```

### Rate Limits

- **General endpoints:** 100 requests per 15 minutes
- **Auth endpoints:** 5 requests per 15 minutes
- **Upload endpoints:** 20 requests per hour

---

## 🗄️ Database Models

### User Schema
```javascript
{
  name: String,
  email: String (unique),
  password: String (hashed),
  tier: String (Free/Starter/Premium/Pro),
  avatar: String,
  phone: String,
  about: String,
  createdAt: Date
}
```

### Listing Schema
```javascript
{
  title: String,
  description: String,
  category: String,
  images: [String],
  owner: ObjectId (User),
  location: String,
  price: Number,
  featured: Boolean,
  createdAt: Date
}
```

### Forum Post Schema
```javascript
{
  title: String,
  content: String,
  author: ObjectId (User),
  replies: [Reply],
  category: String,
  views: Number,
  createdAt: Date
}
```

### Review Schema
```javascript
{
  listing: ObjectId (Listing),
  author: ObjectId (User),
  rating: Number (1-5),
  comment: String,
  createdAt: Date
}
```

---

## 🛡️ Middleware

### Authentication (`auth.js`)
Verifies JWT token and attaches user to request.

### Optional Auth (`optionalAuth.js`)
Attempts authentication but doesn't fail if token is missing.

### Rate Limiter (`rateLimiter.js`)
Prevents abuse by limiting request rates.

### Tier Check (`tierCheck.js`)
Verifies user has required tier for premium features.

### Upload (`upload.js`)
Handles file uploads to Cloudinary for listings.

### Validation (`validation.js`)
Validates request data using Celebrate/Joi.

### Error Handler (`error-handler.js`)
Centralized error handling with custom error classes.

---

## 🧪 Testing

### Run Linter

```bash
npm run lint
```

### Format Code

```bash
npm run format
```

### Manual API Testing

Use tools like:
- **Postman** - Full-featured API client
- **Thunder Client** - VS Code extension
- **cURL** - Command line

Example cURL request:
```bash
curl -X POST http://localhost:5000/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

---

## 🌐 Deployment

### Environment Setup

1. Set `NODE_ENV=production`
2. Update `CLIENT_URL` to production frontend URL
3. Use MongoDB Atlas for production database
4. Change `PAYPAL_MODE=live` for live payments
5. Set secure JWT secrets (different from development)

### Deploy to Heroku

```bash
# Login to Heroku
heroku login

# Create app
heroku create afrionet-api

# Add MongoDB Atlas addon or use existing Atlas cluster
heroku addons:create mongocloud:free

# Set environment variables
heroku config:set JWT_SECRET=your_production_secret
heroku config:set CLOUDINARY_CLOUD_NAME=your_cloud_name
# ... set all other environment variables

# Deploy
git push heroku main

# View logs
heroku logs --tail
```

### Deploy to VPS/Digital Ocean

```bash
# SSH into server
ssh root@your-server-ip

# Clone repository
git clone https://github.com/Dmc4u/afri_connect_api.git
cd afri_connect_api

# Install dependencies
npm install --production

# Install PM2
npm install -g pm2

# Start application
pm2 start app.js --name afrionet-api

# Save PM2 configuration
pm2 save
pm2 startup
```

### Nginx Configuration

```nginx
server {
    listen 80;
    server_name api.afrionet.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📝 Scripts Reference

```bash
npm run dev      # Start development server with nodemon
npm start        # Start production server
npm run lint     # Run ESLint for code quality
npm run format   # Format code with Prettier
```

---

## 🐛 Troubleshooting

### MongoDB Connection Failed

```bash
# Check if MongoDB is running
sudo service mongod status

# Start MongoDB
sudo service mongod start

# Check connection string
echo $MONGO_URL
```

### Port Already in Use

```bash
# Find process using port 5000
lsof -i :5000

# Kill process
kill -9 <PID>
```

### Cloudinary Upload Issues

- Verify credentials in `.env`
- Check file size (max 10MB by default)
- Ensure internet connectivity
- Check Cloudinary dashboard for quota

### JWT Token Errors

- Ensure `JWT_SECRET` is set in `.env`
- Check token expiration (default 7 days)
- Verify Authorization header format: `Bearer <token>`

---

## 📚 Additional Resources

- [Express.js Documentation](https://expressjs.com/)
- [MongoDB Manual](https://docs.mongodb.com/)
- [Mongoose Docs](https://mongoosejs.com/docs/)
- [Socket.io Documentation](https://socket.io/docs/)
- [JWT.io](https://jwt.io/)
- [Cloudinary API Docs](https://cloudinary.com/documentation)

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/new-feature`)
3. Commit changes (`git commit -m 'Add new feature'`)
4. Push to branch (`git push origin feature/new-feature`)
5. Open Pull Request

---

## 📄 License

ISC License - See LICENSE file for details

---

## 👨‍💻 Author

**Moses Ademola Aina**  
DMC LIMITED

- GitHub: [@Dmc4u](https://github.com/Dmc4u)
- Email: admin@afrionet.com

---

## 📞 Support

- Email: admin@afrionet.com
- GitHub Issues: [Report Bug](https://github.com/Dmc4u/afri_connect_api/issues)

---

**Built with ❤️ for Africa**
