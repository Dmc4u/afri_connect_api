require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const { createServer } = require("http");
const { Server: IOServer } = require("socket.io");
const { errors } = require("celebrate");
// Fixed: Added _id to sender populate in messaging controller
const rateLimiter = require("./middlewares/rateLimiter");
const mainRouter = require("./routes/index");
const auth = require("./middlewares/auth");
const errorHandler = require("./middlewares/error-handler");
const { requestLogger, errorLogger } = require("./middlewares/logger");
const { logValidationErrors, validateSignup, validateSignin } = require("./middlewares/validation");
const { PORT, MONGO_URL, PAYPAL_CLIENT_ID, PAYPAL_MODE } = require("./utils/config");
const { createUser, login } = require("./controllers/user");
const { initializeSocket } = require("./utils/socket");
const PricingSettings = require("./models/PricingSettings");

const app = express();
const httpServer = createServer(app);
const io = new IOServer(httpServer, {
  cors: {
    origin: [
      "http://localhost:3001",
      "https://afrionet.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// MongoDB connection
mongoose
  .connect(MONGO_URL)
  .then(async () => {
    console.log("✅ Connected to MongoDB");
    // Initialize default pricing settings
    await initializeDefaultPricing();
  })
  .catch((err) => console.error("❌ MongoDB connection error:", err));

mongoose.connection.on("error", (err) => console.error("MongoDB connection lost:", err));

// Initialize default pricing
async function initializeDefaultPricing() {
  try {
    const defaultPrices = [
      { tier: "Free", basePrice: 0, billingPeriod: "forever", currency: "$" },
      { tier: "Starter", basePrice: 3, billingPeriod: "month", currency: "$" },
      { tier: "Premium", basePrice: 7, billingPeriod: "month", currency: "$" },
      { tier: "Pro", basePrice: 20, billingPeriod: "month", currency: "$" },
    ];

    for (const price of defaultPrices) {
      await PricingSettings.findOneAndUpdate({ tier: price.tier }, price, {
        upsert: true,
        new: true,
      });
    }
    console.log("✅ Pricing settings initialized");
  } catch (error) {
    console.error("⚠️  Error initializing pricing settings:", error.message);
  }
}

// Capture raw body for webhook verification (e.g., 2Checkout INS)
function rawBodySaver(req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || "utf8");
  }
}

app.use(express.json({ verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true, verify: rawBodySaver }));

// Configure helmet first with cross-origin policy
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
}));

app.use(
  cors({
    origin: [
      "http://localhost:3001",
      "https://afrionet.com",
      "https://www.afrionet.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(rateLimiter);

// Serve static files from uploads directory with explicit CORS headers
app.use("/uploads", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
}, express.static(path.join(__dirname, "uploads")));

// Request logging
app.use(requestLogger);

// Authentication routes (no auth middleware needed)
app.post("/signup", validateSignup, createUser);
// Signin without reCAPTCHA
app.post("/signin", validateSignin, login);

// Public PayPal client-id endpoint (no auth required)
app.get("/paypal/client-id", (req, res) => {
  res.json({
    clientId: PAYPAL_CLIENT_ID,
    mode: PAYPAL_MODE || "sandbox",
    currency: "USD",
  });
});

// Public exchange rates endpoint
const exchangeRatesRouter = require("./routes/exchangeRates");
app.use("/exchange-rates", exchangeRatesRouter);

// Public endpoint to get unique user countries (for exchange rate display)
app.get("/users/countries", async (req, res) => {
  try {
    const User = require("./models/User");
    // Get distinct countries from users, excluding null/undefined
    const countries = await User.distinct("country", { country: { $exists: true, $ne: null } });
    res.json({ success: true, countries });
  } catch (error) {
    console.error("Error fetching user countries:", error);
    res.status(500).json({ success: false, message: "Failed to fetch countries" });
  }
});

// Routes (auth middleware applied per route as needed in individual route files)
app.use("/", mainRouter);

// Initialize Socket.io
initializeSocket(io);

// Error handling
app.use(errors());
app.use(logValidationErrors);
app.use(errorLogger);
app.use(errorHandler);

// Make io accessible to routes
app.locals.io = io;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`💬 WebSocket server initialized`);
});
