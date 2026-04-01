const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../utils/config");
const { isAdminEmail } = require("../utils/adminCheck");
const { syncAdminProvisioning } = require("../utils/adminProvisioning");
const { logActivity } = require("../utils/activityLogger");

// Configure Google OAuth Strategy
const configureGoogleStrategy = () => {
  const callbackURL =
    process.env.GOOGLE_CALLBACK_URL ||
    `${process.env.API_URL || "http://localhost:3001"}/auth/google/callback`;

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL,
        scope: ["profile", "email"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Extract user information from Google profile
          const email = profile.emails?.[0]?.value;
          const name =
            profile.displayName ||
            `${profile.name?.givenName || ""} ${profile.name?.familyName || ""}`.trim();
          const googleId = profile.id;
          const avatar = profile.photos?.[0]?.value;

          if (!email) {
            return done(new Error("No email found in Google profile"), null);
          }

          // Check if user exists by email or googleId
          let user = await User.findOne({
            $or: [{ email }, { googleId }],
          });

          if (user) {
            // Update existing user with Google ID if not already set
            if (!user.googleId) {
              user.googleId = googleId;
            }
            // Update avatar if available and not set
            if (avatar && !user.avatar) {
              user.avatar = avatar;
            }
            await user.save();
          } else {
            // Create new user from Google profile
            const isProvisionedAdmin = isAdminEmail(email);

            user = await User.create({
              name,
              email,
              googleId,
              avatar,
              // Google users don't need password-based auth
              password: null,
              // Set default values for required fields
              phone: "",
              city: "",
              country: "",
              location: "",
              role: isProvisionedAdmin ? "admin" : "user",
              tier: isProvisionedAdmin ? "Pro" : "Free",
              adminProvisioned: isProvisionedAdmin,
              profileComplete: isProvisionedAdmin ? true : false, // Admins skip onboarding
              accountType: isProvisionedAdmin ? "business" : null, // Default for admins
              emailVerified: true, // Google emails are pre-verified
              settings: {
                emailNotifications: true,
                profileVisibility: true,
                phoneVisibility: false,
                twoFactorAuth: false, // Disabled by default
              },
            });

            // Sync admin permissions if needed
            if (isProvisionedAdmin) {
              await syncAdminProvisioning(user._id, email);
            }

            // Log account creation
            await logActivity({
              action: "user_registered",
              userId: user._id,
              metadata: {
                method: "google",
                email,
                name,
              },
            });
          }

          // Log successful login
          await logActivity({
            action: "user_login",
            userId: user._id,
            metadata: {
              method: "google",
              email,
            },
          });

          return done(null, user);
        } catch (error) {
          console.error("Google OAuth error:", error);
          return done(error, null);
        }
      }
    )
  );

  // Serialize and deserialize user for session management
  passport.serializeUser((user, done) => {
    done(null, user._id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
};

// Middleware to initiate Google OAuth
const googleAuth = passport.authenticate("google", {
  scope: ["profile", "email"],
  session: false,
});

// Middleware to handle Google OAuth callback
const googleAuthCallback = (req, res, next) => {
  passport.authenticate("google", { session: false }, (err, user, info) => {
    if (err) {
      console.error("Google callback error:", err);
      // Redirect to frontend with error
      const frontendURL = process.env.FRONTEND_URL || "http://localhost:5173";
      return res.redirect(
        `${frontendURL}/?auth=error&message=${encodeURIComponent(
          err.message || "Authentication failed"
        )}`
      );
    }

    if (!user) {
      const frontendURL = process.env.FRONTEND_URL || "http://localhost:5173";
      return res.redirect(
        `${frontendURL}/?auth=error&message=${encodeURIComponent("User not found")}`
      );
    }

    try {
      // Generate JWT token
      const token = jwt.sign({ _id: user._id }, JWT_SECRET, { expiresIn: "7d" });

      // Prepare user object (remove sensitive data)
      const userObj = user.toObject();
      delete userObj.password;

      // Redirect to frontend with token and user data
      const frontendURL = process.env.FRONTEND_URL || "http://localhost:5173";
      const userData = encodeURIComponent(JSON.stringify(userObj));

      return res.redirect(`${frontendURL}/?auth=success&token=${token}&user=${userData}`);
    } catch (error) {
      console.error("Token generation error:", error);
      const frontendURL = process.env.FRONTEND_URL || "http://localhost:5173";
      return res.redirect(
        `${frontendURL}/?auth=error&message=${encodeURIComponent("Token generation failed")}`
      );
    }
  })(req, res, next);
};

module.exports = {
  configureGoogleStrategy,
  googleAuth,
  googleAuthCallback,
};
