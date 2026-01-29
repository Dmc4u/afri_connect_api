const nodemailer = require("nodemailer");
const geoip = require("geoip-lite");
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  FROM_EMAIL,
  APP_NAME,
  FRONTEND_URL,
  BRAND_LOGO_URL,
} = require("./config");

// Create reusable transporter object using SMTP transport
const createTransporter = () => {
  const smtpPort = Number(SMTP_PORT) || 587;
  const secure = smtpPort === 465;

  if (!SMTP_HOST) {
    throw new Error(
      "SMTP_HOST is not configured. Set SMTP_HOST/SMTP_PORT (and optionally SMTP_USER/SMTP_PASS) in .env to send emails."
    );
  }

  const transportOptions = {
    host: SMTP_HOST,
    port: smtpPort,
    secure,
  };

  // Support SMTP servers that don't require auth (common in dev: MailHog/Mailpit).
  if (SMTP_USER && SMTP_PASS) {
    transportOptions.auth = {
      user: SMTP_USER,
      pass: SMTP_PASS,
    };
  }

  // Allow self-signed certs only in non-production.
  if (process.env.NODE_ENV !== "production") {
    transportOptions.tls = { rejectUnauthorized: false };
  }

  return nodemailer.createTransport(transportOptions);
};

const isEmailOptedOut = (userLike) => {
  // Default is opt-in.
  return userLike && userLike.settings && userLike.settings.emailNotifications === false;
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

  loginNotification: (user, loginDetails) => ({
    subject: `New Login to Your ${APP_NAME} Account`,
    html: `
      <div style="background:#f3f4f6; padding:24px 12px;">
        <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 640px; margin: 0 auto; background:#ffffff; border-radius: 14px; overflow:hidden; border:1px solid #e5e7eb;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; border-collapse:collapse;" bgcolor="#0b1220">
            <tr>
              <td style="padding:20px 22px;" bgcolor="#0b1220">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; border-collapse:collapse;">
                  <tr>
                    <td valign="middle" style="vertical-align:middle;">
                      <div style="display:flex; align-items:center; gap:10px;">
                        <img src="${BRAND_LOGO_URL}" width="28" height="28" alt="${APP_NAME} logo" style="display:block; width:28px; height:28px; border:0; outline:none; text-decoration:none;" />
                        <div style="color:#ffffff; font-size:18px; font-weight:700; letter-spacing:0.2px; line-height:1.1;">${APP_NAME}</div>
                      </div>
                      <div style="color:rgba(255,255,255,0.78); font-size:13px; margin-top:6px;">New sign-in detected</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <div style="padding:22px; color:#111827;">
            <h2 style="margin:0 0 10px; font-size:18px;">New Login Notification</h2>
            <p style="margin:0 0 12px; color:#374151;">Hey ${user.name || "there"},</p>
            <p style="margin:0 0 16px; color:#374151;">We noticed a login to <strong>${user.email}</strong>.</p>

            <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; padding:14px 14px;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%; border-collapse:collapse; font-size:14px; color:#111827;">
                <tr>
                  <td style="padding:6px 0; color:#6b7280; width:42%;">Date</td>
                  <td style="padding:6px 0; font-weight:600;">${loginDetails.date}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#6b7280;">Time</td>
                  <td style="padding:6px 0; font-weight:600;">${loginDetails.time}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#6b7280;">IP</td>
                  <td style="padding:6px 0; font-weight:600;">${loginDetails.ip}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#6b7280;">Approx. location</td>
                  <td style="padding:6px 0; font-weight:600;">${loginDetails.location}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#6b7280;">Device</td>
                  <td style="padding:6px 0; font-weight:600;">${loginDetails.device}</td>
                </tr>
                ${
                  loginDetails.network
                    ? `
                <tr>
                  <td style="padding:6px 0; color:#6b7280;">Network</td>
                  <td style="padding:6px 0; font-weight:600;">${loginDetails.network}</td>
                </tr>
                `
                    : ""
                }
              </table>
            </div>

            <div style="margin-top:16px; padding:12px 14px; border-radius:12px; background:#ecfeff; border:1px solid #a5f3fc; color:#155e75;">
              <div style="font-weight:700; margin-bottom:4px;">Wasn’t you?</div>
              <div style="font-size:14px;">Secure your account immediately.
                <a href="${FRONTEND_URL}/contact" style="color:#0e7490; font-weight:700; text-decoration:underline;">Contact support</a>
              </div>
            </div>

            <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">If this was you, you can safely ignore this email.</p>
          </div>

          <div style="padding:14px 22px; background:#f9fafb; border-top:1px solid #e5e7eb; color:#6b7280; font-size:12px;">
            <div>Best regards,<br/>The ${APP_NAME} Team</div>
          </div>
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

  listingRejected: (user, listing, reason) => ({
    subject: `Listing Requires Changes - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Your Listing Needs Revision</h2>
          <p>Hello ${user.name},</p>
          <p>Thank you for submitting your listing "<strong>${listing.title}</strong>" to ${APP_NAME}.</p>
          <p>Unfortunately, your listing requires some changes before it can be approved and published.</p>
          <div style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #856404;">Reason for Rejection:</h3>
            <p style="color: #856404; margin: 0;">${reason || "Please review our listing guidelines and ensure your listing meets all requirements."}</p>
          </div>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>What to do next:</h3>
            <ul>
              <li>Review the feedback above</li>
              <li>Update your listing with the necessary changes</li>
              <li>Resubmit for review</li>
            </ul>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/profile" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Edit Your Listing</a>
          </div>
          <p>If you have any questions, please don't hesitate to contact our support team.</p>
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

  // Advertisement Notifications
  adRequestReceived: (advertiser, ad) => ({
    subject: `Advertisement Request Received - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Thank You for Your Advertising Request!</h2>
          <p>Hello ${advertiser.name},</p>
          <p>We've received your advertising request for "<strong>${ad.title}</strong>" and our team is reviewing it.</p>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Request Details:</h3>
            <p><strong>Ad Title:</strong> ${ad.title}</p>
            <p><strong>Placement:</strong> ${ad.placement}</p>
            <p><strong>Plan:</strong> ${ad.pricing?.plan || "N/A"}</p>
            <p><strong>Total Amount:</strong> $${ad.pricing?.amount || 0} ${ad.pricing?.currency || "USD"}</p>
          </div>
          <div style="background-color: #d1ecf1; padding: 15px; border-left: 4px solid #17a2b8; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #0c5460;">What Happens Next?</h3>
            <ul style="color: #0c5460; margin: 0;">
              <li>Our team will review your request within 24 hours</li>
              <li>We'll verify your ad content meets our guidelines</li>
              <li>You'll receive an approval/revision email</li>
              <li>Once approved, you'll complete payment to activate</li>
            </ul>
          </div>
          <p>If you have any questions, please reply to this email or contact our advertising team.</p>
          <p>Best regards,<br>The ${APP_NAME} Advertising Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),

  adApproved: (advertiser, ad) => ({
    subject: `Advertisement Approved - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>🎉 Your Advertisement Has Been Approved!</h2>
          <p>Hello ${advertiser.name},</p>
          <p>Great news! Your advertisement "<strong>${ad.title}</strong>" has been approved and is ready to go live.</p>
          <div style="background-color: #d4edda; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #155724;">✓ Approval Confirmed</h3>
            <p style="color: #155724; margin: 0;">Your ad content has been reviewed and meets our advertising standards.</p>
          </div>
          <div style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #856404;">💳 Payment Required</h3>
            <p style="color: #856404; margin: 0;">To activate your advertisement, please complete payment by logging into your dashboard.</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/advertiser/dashboard" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Complete Payment & Activate</a>
          </div>
          <p>Once payment is confirmed, your ad will begin displaying according to your selected schedule.</p>
          <p>Best regards,<br>The ${APP_NAME} Advertising Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),

  adRejected: (advertiser, ad, reason) => ({
    subject: `Advertisement Requires Revision - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Advertisement Needs Revision</h2>
          <p>Hello ${advertiser.name},</p>
          <p>After reviewing your advertisement "<strong>${ad.title}</strong>", we need you to make some changes before we can approve it.</p>
          <div style="background-color: #f8d7da; padding: 15px; border-left: 4px solid #dc3545; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #721c24;">Reason for Revision Request:</h3>
            <p style="color: #721c24; margin: 0;">${reason || "Please review our advertising guidelines and ensure your ad meets all requirements."}</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/advertiser/dashboard" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Go to Dashboard</a>
          </div>
          <p>Best regards,<br>The ${APP_NAME} Advertising Team</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666;">
          <p>&copy; 2025 ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  }),

  adActivated: (advertiser, ad) => ({
    subject: `Your Ad is Now Live! - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #333;">${APP_NAME}</h1>
        </div>
        <div style="padding: 20px;">
          <h2>🚀 Your Advertisement is Live!</h2>
          <p>Hello ${advertiser.name},</p>
          <p>Excellent news! Your advertisement "<strong>${ad.title}</strong>" is now active and displaying to our audience.</p>
          <div style="background-color: #d4edda; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #155724;">✓ Campaign Active</h3>
            <p style="color: #155724; margin: 0;">Your ad is now being shown across ${APP_NAME}.</p>
          </div>
          <div style="background-color: #d1ecf1; padding: 15px; border-left: 4px solid #17a2b8; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #0c5460;">📊 Track Your Performance</h3>
            <p style="color: #0c5460; margin: 0;">Monitor impressions, clicks, and engagement in real-time through your advertiser dashboard.</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/advertiser/dashboard" style="background-color: #17a2b8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">View Analytics Dashboard</a>
          </div>
          <p>Thank you for choosing ${APP_NAME} to grow your brand!</p>
          <p>Best regards,<br>The ${APP_NAME} Advertising Team</p>
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
          <p>Hello ${user.name || ""},</p>
          <p>Your review on <strong>${listing.title || "a listing"}</strong> has been approved and is now publicly visible.</p>
          <blockquote style="margin:15px 0;padding:12px 16px;background:#f8f9fa;border-left:4px solid #4caf50;">
            <p style="margin:0; font-style:italic; color:#555;">${(review.text || "").substring(0, 400)}</p>
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
          <p>Hello ${owner.name || ""},</p>
          <p><strong>${reviewer?.name || "A user"}</strong> left a ${review.rating}/5 review on <strong>${listing.title}</strong>.</p>
          <blockquote style="margin:15px 0;padding:12px 16px;background:#f8f9fa;border-left:4px solid #2563eb;">
            <p style="margin:0; font-style:italic; color:#555;">${(review.text || "").substring(0, 400)}</p>
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
// Supports two call patterns:
// 1) sendEmail(to, templateKey, data)
// 2) sendEmail(to, subject, html)
const sendEmail = async (to, templateOrSubject, dataOrHtml = {}) => {
  try {
    const transporter = createTransporter();

    let subject;
    let html;

    if (
      typeof templateOrSubject === "string" &&
      typeof dataOrHtml === "object" &&
      emailTemplates[templateOrSubject]
    ) {
      const emailContent = emailTemplates[templateOrSubject](dataOrHtml);
      subject = emailContent.subject;
      html = emailContent.html;
    } else {
      subject = String(templateOrSubject || "");
      html = String(dataOrHtml || "");
    }

    const mailOptions = {
      from: `"${APP_NAME}" <${FROM_EMAIL || SMTP_USER}>`,
      to: to,
      subject,
      html,
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
    if (isEmailOptedOut(user))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
    return await sendEmail(user.email, "welcome", user);
  },

  // Send password reset email
  sendPasswordResetEmail: async (user, resetToken) => {
    return await sendEmail(user.email, "passwordReset", { user, resetToken });
  },

  // Send payment confirmation email
  sendPaymentConfirmation: async (user, payment) => {
    if (isEmailOptedOut(user))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
    return await sendEmail(user.email, "paymentConfirmation", { user, payment });
  },

  // Send subscription expiring warning
  sendSubscriptionExpiringWarning: async (user, payment) => {
    if (isEmailOptedOut(user))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
    return await sendEmail(user.email, "subscriptionExpiring", { user, payment });
  },

  // Send listing approval notification
  sendListingApproved: async (user, listing) => {
    if (isEmailOptedOut(user))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
    return await sendEmail(user.email, "listingApproved", { user, listing });
  },

  // Send new saved search results
  sendSavedSearchResults: async (user, savedSearch, newListings) => {
    if (isEmailOptedOut(user))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
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
    if (isEmailOptedOut(user))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
    return await sendEmail(user.email, "reviewApproved", { user, listing, review });
  },

  // Notify listing owner of a new (pending or approved) review
  sendNewReviewOnListing: async (owner, listing, review, reviewer) => {
    if (isEmailOptedOut(owner))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
    return await sendEmail(owner.email, "newReviewOnListing", { owner, listing, review, reviewer });
  },

  // Advertisement Notification Functions
  sendAdRequestReceived: async (advertiser, ad) => {
    if (isEmailOptedOut(advertiser))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
    return await sendEmail(advertiser.email, "adRequestReceived", { advertiser, ad });
  },

  sendAdApproved: async (advertiser, ad) => {
    if (isEmailOptedOut(advertiser))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
    return await sendEmail(advertiser.email, "adApproved", { advertiser, ad });
  },

  sendAdRejected: async (advertiser, ad, reason) => {
    if (isEmailOptedOut(advertiser))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
    return await sendEmail(advertiser.email, "adRejected", { advertiser, ad, reason });
  },

  sendAdActivated: async (advertiser, ad) => {
    if (isEmailOptedOut(advertiser))
      return { success: true, skipped: true, reason: "emailNotifications disabled" };
    return await sendEmail(advertiser.email, "adActivated", { advertiser, ad });
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

  // Extract login details from request
  extractLoginDetails: (req) => {
    const userAgent = req.get("user-agent") || "";
    const forwardedFor = req.get("x-forwarded-for");
    const forwardedIp = forwardedFor ? String(forwardedFor).split(",")[0].trim() : "";
    const rawIp = forwardedIp || req.ip || req.connection.remoteAddress || "Unknown";
    const cleanIp = String(rawIp).replace("::ffff:", ""); // Clean IPv6 prefix
    const now = new Date();

    // Parse device info from user-agent
    let device = "Unknown Device";
    if (userAgent.includes("iPhone")) {
      const match = userAgent.match(/iPhone OS (\d+)_(\d+)/);
      device = match ? `iPhone (iOS ${match[1]}.${match[2]})` : "iPhone";
    } else if (userAgent.includes("iPad")) {
      device = "iPad";
    } else if (userAgent.includes("Android")) {
      const match = userAgent.match(/Android (\d+(\.\d+)?)/);
      device = match ? `Android ${match[1]}` : "Android Device";
    } else if (userAgent.includes("Windows")) {
      device = "Windows PC";
    } else if (userAgent.includes("Macintosh")) {
      device = "Mac";
    } else if (userAgent.includes("Linux")) {
      device = "Linux PC";
    }

    // Get geolocation from IP
    let location = "Unknown";
    let network = null;
    const lowerIp = String(cleanIp).toLowerCase();
    const isLocal = lowerIp === "::1" || lowerIp === "127.0.0.1" || lowerIp === "localhost";
    if (isLocal) {
      location = "Local development";
    } else {
      const geo = geoip.lookup(cleanIp);
      if (geo) {
        const city = geo.city || null;
        const country = geo.country || null;
        location = [city, country].filter(Boolean).join(", ") || "Unknown";
      }
    }

    return {
      date: now.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      time: now.toLocaleTimeString("en-US", { hour: "numeric", minute: "numeric", hour12: true }),
      ip: isLocal ? "Localhost" : cleanIp,
      location,
      device,
      network,
      userAgent,
    };
  },
};

module.exports = {
  // Primary grouped exports
  notifications,
  inAppNotifications,
  utils,
  sendEmail,
  emailTemplates,

  // Backwards-compatible named exports (some controllers import these directly)
  sendWelcomeEmail: notifications.sendWelcomeEmail,
  sendPasswordResetEmail: notifications.sendPasswordResetEmail,
  sendPaymentConfirmation: notifications.sendPaymentConfirmation,
  sendSubscriptionExpiringWarning: notifications.sendSubscriptionExpiringWarning,
  sendListingApproved: notifications.sendListingApproved,
  sendSavedSearchResults: notifications.sendSavedSearchResults,
  sendReviewApproved: notifications.sendReviewApproved,
  sendNewReviewOnListing: notifications.sendNewReviewOnListing,
  sendAdRequestReceived: notifications.sendAdRequestReceived,
  sendAdApproved: notifications.sendAdApproved,
  sendAdRejected: notifications.sendAdRejected,
  sendAdActivated: notifications.sendAdActivated,
};
