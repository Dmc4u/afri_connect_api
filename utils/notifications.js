const nodemailer = require("nodemailer");
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  FROM_EMAIL,
  APP_NAME,
  FRONTEND_URL,
} = require("./config");

// Create reusable transporter object using SMTP transport
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: SMTP_HOST,
    port: SMTP_PORT || 587,
    secure: SMTP_PORT === 465, // true for 465, false for other ports
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates in development
    },
  });
};

// Email templates
const emailTemplates = {
  welcome: (user) => ({
    subject: `Welcome to ${APP_NAME}!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Welcome aboard, ${user.name}!</h2>
          <p>Thank you for joining ${APP_NAME}. We're excited to have you as part of our community.</p>
          <p>Your account has been successfully created with the email: <strong>${user.email}</strong></p>
          <p>Here's what you can do next:</p>
          <ul>
            <li>Complete your profile</li>
            <li>Create your first business listing</li>
            <li>Explore other businesses in your area</li>
            <li>Connect with other entrepreneurs</li>
          </ul>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/profile" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Complete Your Profile</a>
          </div>
          <p>If you have any questions, feel free to reach out to our support team.</p>
          <p>Best regards,<br>The ${APP_NAME} Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),

  passwordReset: (user, resetToken) => ({
    subject: `Password Reset Request - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Password Reset Request</h2>
          <p>Hello ${user.name},</p>
          <p>We received a request to reset your password for your ${APP_NAME} account.</p>
          <p>Click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/reset-password?token=${resetToken}" style="background-color: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Reset Password</a>
          </div>
          <p>This link will expire in 1 hour for security reasons.</p>
          <p>If you didn't request this password reset, please ignore this email or contact our support team if you have concerns.</p>
          <p>Best regards,<br>The ${APP_NAME} Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),

  paymentConfirmation: (user, payment) => ({
    subject: `Payment Confirmation - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Payment Confirmed!</h2>
          <p>Hello ${user.name},</p>
          <p>Thank you for your payment. Your subscription has been activated successfully!</p>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Payment Details:</h3>
            <p><strong>Order ID:</strong> ${payment.orderId}</p>
            <p><strong>Amount:</strong> ${payment.amount.currency} $${payment.amount.value}</p>
            <p><strong>Plan:</strong> ${payment.tierUpgrade.to} (${payment.tierUpgrade.duration})</p>
            <p><strong>Payment Date:</strong> ${new Date(payment.completedAt).toLocaleDateString()}</p>
            ${payment.expirationDate ? `<p><strong>Next Billing Date:</strong> ${new Date(payment.expirationDate).toLocaleDateString()}</p>` : ""}
          </div>
          <p>Your account has been upgraded to <strong>${payment.tierUpgrade.to}</strong> tier. You now have access to:</p>
          <ul>
            ${
              payment.tierUpgrade.to === "Premium"
                ? `
              <li>Up to 5 business listings</li>
              <li>Featured listing placement</li>
              <li>Priority customer support</li>
              <li>Advanced analytics</li>
            `
                : ""
            }
            ${
              payment.tierUpgrade.to === "Pro"
                ? `
              <li>Unlimited business listings</li>
              <li>Premium featured placement</li>
              <li>Priority customer support</li>
              <li>Advanced analytics</li>
              <li>API access</li>
              <li>Custom branding options</li>
            `
                : ""
            }
          </ul>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/profile" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Access Your Account</a>
          </div>
          <p>If you have any questions about your subscription, please don't hesitate to contact our support team.</p>
          <p>Best regards,<br>The ${APP_NAME} Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),

  subscriptionExpiring: (user, payment) => ({
    subject: `Subscription Expiring Soon - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Subscription Expiring Soon</h2>
          <p>Hello ${user.name},</p>
          <p>This is a friendly reminder that your ${payment.tierUpgrade.to} subscription will expire on <strong>${new Date(payment.expirationDate).toLocaleDateString()}</strong>.</p>
          <p>To continue enjoying all the benefits of your ${payment.tierUpgrade.to} membership, please renew your subscription.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/membership" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Renew Subscription</a>
          </div>
          <p>If your subscription expires, your account will be downgraded to the Free tier, and some features may become unavailable.</p>
          <p>Need help or have questions? Our support team is here to assist you.</p>
          <p>Best regards,<br>The ${APP_NAME} Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),

  listingApproved: (user, listing) => ({
    subject: `Listing Approved - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Your Listing Has Been Approved!</h2>
          <p>Hello ${user.name},</p>
          <p>Great news! Your business listing "<strong>${listing.title}</strong>" has been approved and is now live on ${APP_NAME}.</p>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Listing Details:</h3>
            <p><strong>Title:</strong> ${listing.title}</p>
            <p><strong>Category:</strong> ${listing.category}</p>
            <p><strong>Location:</strong> ${listing.location}</p>
            <p><strong>Status:</strong> Active</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/listings/${listing._id}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">View Your Listing</a>
          </div>
          <p>Your listing is now visible to potential customers. Start connecting with your audience!</p>
          <p>Best regards,<br>The ${APP_NAME} Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),

  newSavedSearchResults: (user, savedSearch, newListings) => ({
    subject: `New Results for "${savedSearch.name}" - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>New Search Results Available!</h2>
          <p>Hello ${user.name},</p>
          <p>We found <strong>${newListings.length}</strong> new listing(s) matching your saved search "<strong>${savedSearch.name}</strong>".</p>

          ${newListings
            .slice(0, 3)
            .map(
              (listing) => `
            <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px;">
              <h3 style="margin: 0 0 10px 0;">${listing.title}</h3>
              <p style="margin: 5px 0; color: #666;">${listing.category} • ${listing.location}</p>
              <p style="margin: 10px 0;">${listing.description.substring(0, 150)}...</p>
              <a href="${FRONTEND_URL}/listings/${listing._id}" style="color: #007bff; text-decoration: none;">View Details →</a>
            </div>
          `
            )
            .join("")}

          ${newListings.length > 3 ? `<p><em>And ${newListings.length - 3} more results...</em></p>` : ""}

          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}${savedSearch.searchUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">View All Results</a>
          </div>

          <p style="font-size: 12px; color: #666;">You're receiving this because you have alerts enabled for this saved search. You can manage your search alerts in your profile.</p>
          <p>Best regards,<br>The ${APP_NAME} Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),
  reviewApproved: (user, listing, review) => ({
    subject: `Your review was approved - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Your Review is Live!</h2>
          <p>Hello ${user.name || ''},</p>
          <p>Your review on <strong>${listing.title || 'a listing'}</strong> has been approved and is now publicly visible.</p>
          <blockquote style="margin:15px 0;padding:12px 16px;background:#f8f9fa;border-left:4px solid #4caf50;">
            <p style="margin:0; font-style:italic; color:#555;">${(review.text || '').substring(0,400)}</p>
            <p style="margin:8px 0 0 0; font-size:12px; color:#888;">Rating: ${review.rating} / 5</p>
          </blockquote>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/listings/${listing._id}" style="background-color: #4caf50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">View Listing</a>
          </div>
          <p>Thanks for contributing to our community.</p>
          <p>Best regards,<br/>The ${APP_NAME} Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),
  newReviewOnListing: (owner, listing, review, reviewer) => ({
    subject: `New review on your listing - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Your Listing Got a Review</h2>
          <p>Hello ${owner.name || ''},</p>
          <p><strong>${reviewer?.name || 'A user'}</strong> left a ${review.rating}/5 review on <strong>${listing.title}</strong>.</p>
          <blockquote style="margin:15px 0;padding:12px 16px;background:#f8f9fa;border-left:4px solid #2563eb;">
            <p style="margin:0; font-style:italic; color:#555;">${(review.text || '').substring(0,400)}</p>
          </blockquote>
          <p>Status: <strong>${review.status}</strong></p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/listings/${listing._id}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">View Listing</a>
          </div>
          <p>Moderate pending reviews in your dashboard if needed.</p>
          <p>Best regards,<br/>The ${APP_NAME} Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),
};

// Send email function
const sendEmail = async (to, template, data = {}) => {
  try {
    const transporter = createTransporter();
    const emailContent = emailTemplates[template](data);

    const mailOptions = {
      from: `"${APP_NAME}" <${FROM_EMAIL}>`,
      to: to,
      subject: emailContent.subject,
      html: emailContent.html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Error sending email:", error);
    return { success: false, error: error.message };
  }
};

// Notification functions
const notifications = {
  // Send welcome email to new users
  sendWelcomeEmail: async (user) => {
    return await sendEmail(user.email, "welcome", user);
  },

  // Send password reset email
  sendPasswordResetEmail: async (user, resetToken) => {
    return await sendEmail(user.email, "passwordReset", { user, resetToken });
  },

  // Send payment confirmation email
  sendPaymentConfirmation: async (user, payment) => {
    return await sendEmail(user.email, "paymentConfirmation", { user, payment });
  },

  // Send subscription expiring warning
  sendSubscriptionExpiringWarning: async (user, payment) => {
    return await sendEmail(user.email, "subscriptionExpiring", { user, payment });
  },

  // Send listing approval notification
  sendListingApproved: async (user, listing) => {
    return await sendEmail(user.email, "listingApproved", { user, listing });
  },

  // Send new saved search results
  sendSavedSearchResults: async (user, savedSearch, newListings) => {
    return await sendEmail(user.email, "newSavedSearchResults", { user, savedSearch, newListings });
  },

  // Send bulk notifications (for admin use)
  sendBulkNotification: async (users, template, data) => {
    const results = [];
    for (const user of users) {
      const result = await sendEmail(user.email, template, { user, ...data });
      results.push({ user: user._id, email: user.email, ...result });
    }
    return results;
  },
  // Notify reviewer that their review was approved
  sendReviewApproved: async (user, listing, review) => {
    return await sendEmail(user.email, 'reviewApproved', { user, listing, review });
  },

  // Notify listing owner of a new (pending or approved) review
  sendNewReviewOnListing: async (owner, listing, review, reviewer) => {
    return await sendEmail(owner.email, 'newReviewOnListing', { owner, listing, review, reviewer });
  },
};

// In-app notification system (for future use with WebSocket/real-time updates)
const inAppNotifications = {
  // Create in-app notification (would be stored in database)
  create: async (userId, type, title, message, data = {}) => {
    // This would typically save to a Notification model
    console.log(`In-app notification for user ${userId}: ${title}`);
    return {
      userId,
      type,
      title,
      message,
      data,
      createdAt: new Date(),
      read: false,
    };
  },

  // Notification types
  types: {
    PAYMENT_SUCCESS: "payment_success",
    PAYMENT_FAILED: "payment_failed",
    LISTING_APPROVED: "listing_approved",
    LISTING_REJECTED: "listing_rejected",
    SUBSCRIPTION_EXPIRING: "subscription_expiring",
    NEW_MESSAGE: "new_message",
    SYSTEM_ANNOUNCEMENT: "system_announcement",
  },
};

// Utility functions
const utils = {
  // Test email configuration
  testEmailConfig: async () => {
    try {
      const transporter = createTransporter();
      await transporter.verify();
      console.log("✅ Email configuration is valid");
      return { success: true, message: "Email configuration is valid" };
    } catch (error) {
      console.error("❌ Email configuration error:", error);
      return { success: false, error: error.message };
    }
  },

  // Format user-friendly date
  formatDate: (date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  },

  // Generate unsubscribe link
  generateUnsubscribeLink: (userId, notificationType) => {
    // This would typically use a signed token
    return `${FRONTEND_URL}/unsubscribe?user=${userId}&type=${notificationType}`;
  },
};

module.exports = {
  notifications,
  inAppNotifications,
  utils,
  sendEmail,
  emailTemplates,
};
