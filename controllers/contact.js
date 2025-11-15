const nodemailer = require('nodemailer');
const BadRequestError = require('../utils/errors/BadRequestError');

/**
 * Contact Support Form Handler
 * Sends email to support@dmclimited.net
 */

const sendSupportMessage = async (req, res, next) => {
  try {
    const { name, email, subject, message } = req.body;

    // Validate required fields
    if (!name || !email || !subject || !message) {
      throw new BadRequestError('All fields are required');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestError('Invalid email address');
    }

    // Validate message length
    if (message.length < 10) {
      throw new BadRequestError('Message must be at least 10 characters');
    }

    if (message.length > 4000) {
      throw new BadRequestError('Message is too long (max 4000 characters)');
    }

    // Helper function to escape HTML
    const esc = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    // Create email transporter with PrivateEmail SMTP
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'mail.privateemail.com',
      port: parseInt(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.ADMIN_EMAIL,
        pass: process.env.ADMIN_EMAIL_PASSWORD,
      },
    });

    console.log('📧 SMTP Configuration:', {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE,
      user: process.env.ADMIN_EMAIL,
      passExists: !!process.env.ADMIN_EMAIL_PASSWORD,
    });

    // Admin email content
    const adminHtml = `
      <div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6">
        <h3 style="margin:0 0 .5rem">New message from AfriOnet contact form</h3>
        <p><b>Name:</b> ${esc(name)}</p>
        <p><b>Email:</b> ${esc(email)}</p>
        <p><b>Subject:</b> ${esc(subject)}</p>
        <p style="white-space:pre-wrap"><b>Message:</b>\n${esc(message)}</p>
      </div>
    `;

    console.log('📤 Attempting to send email to:', process.env.ADMIN_EMAIL);

    // Send email to support
    try {
      await transporter.sendMail({
        from: `"AfriOnet Contact Form" <${process.env.ADMIN_EMAIL}>`,
        to: process.env.ADMIN_EMAIL,
        replyTo: email,
        subject: `[AfriOnet Contact] ${subject}`,
        html: adminHtml,
      });
      console.log('✅ Admin email sent successfully');
    } catch (emailError) {
      console.error('❌ Failed to send admin email:', emailError);
      throw emailError;
    }

    // Acknowledgment email content
    const ackText =
      `Hi ${name || ""},\n\n` +
      `Thanks for reaching out to AfriOnet! We've received your message and will get back to you as soon as possible.\n\n` +
      `If this wasn't you, just ignore this email.\n\n` +
      `Best,\nAfriOnet Support`;

    const ackHtml = `
      <div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6">
        <p>Hi${name ? ` ${esc(name)}` : ""},</p>
        <p>Thanks for reaching out to <b>AfriOnet</b>! We've received your message and will get back to you as soon as possible.</p>
        <p style="color:#666;font-size:12px;">If this wasn't you, just ignore this email.</p>
        <p style="margin-top:2em;">Best,<br />AfriOnet Support</p>
      </div>
    `;

    // Send confirmation email to sender
    try {
      await transporter.sendMail({
        from: `"AfriOnet Support" <${process.env.ADMIN_EMAIL}>`,
        to: email,
        subject: 'Thanks for contacting AfriOnet',
        text: ackText,
        html: ackHtml,
      });
    } catch (confirmError) {
      console.warn('⚠️ Failed to send confirmation email:', confirmError.message);
      // Don't fail the request if confirmation email fails
    }

    res.status(200).json({
      success: true,
      message: 'Your message has been sent successfully. We will respond within 24-48 hours.',
    });
  } catch (error) {
    console.error('❌ Contact form error:', error);
    next(error);
  }
};

module.exports = {
  sendSupportMessage,
};
