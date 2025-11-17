#!/usr/bin/env node

/**
 * Storage Monitor Script
 * Checks uploads folder size and sends email alert if it exceeds threshold
 * Run via cron: 0 0 * * * /usr/bin/node /home/dmsesbiz2005/afri_connect_api/scripts/monitor-storage.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const THRESHOLD_GB = 1; // Alert when uploads exceed 1GB
const THRESHOLD_BYTES = THRESHOLD_GB * 1024 * 1024 * 1024;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Admin notification settings
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'support@dmclimited.net';
const SMTP_ENABLED = process.env.SMTP_HOST && process.env.SMTP_USER;

/**
 * Get directory size in bytes
 */
function getDirectorySize(dirPath) {
  try {
    const output = execSync(`du -sb "${dirPath}"`, { encoding: 'utf8' });
    const size = parseInt(output.split('\t')[0]);
    return size;
  } catch (error) {
    console.error('Error calculating directory size:', error.message);
    return 0;
  }
}

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Send email notification using nodemailer (if configured)
 */
async function sendEmailAlert(size, threshold) {
  if (!SMTP_ENABLED) {
    console.log('⚠️  SMTP not configured - email alert skipped');
    return;
  }

  try {
    const nodemailer = require('nodemailer');

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: ADMIN_EMAIL,
      subject: '⚠️ AfriOnet Storage Alert: Uploads Folder Exceeds Threshold',
      html: `
        <h2>Storage Alert - AfriOnet Platform</h2>
        <p>The uploads folder has exceeded the configured threshold.</p>

        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Current Size:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${formatBytes(size)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Threshold:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${formatBytes(threshold)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Location:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${UPLOADS_DIR}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Server:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${process.env.API_URL || 'api.afrionet.com'}</td>
          </tr>
        </table>

        <h3>Recommended Actions:</h3>
        <ul>
          <li>Review and clean up old/unused media files</li>
          <li>Check for duplicate uploads</li>
          <li>Monitor disk space: <code>df -h</code></li>
          <li>Consider implementing automatic cleanup policies</li>
          <li>Backup uploads folder before cleanup</li>
        </ul>

        <p><small>This is an automated alert from AfriOnet Storage Monitor</small></p>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email alert sent to ${ADMIN_EMAIL}`);
  } catch (error) {
    console.error('❌ Failed to send email alert:', error.message);
  }
}

/**
 * Log alert to file
 */
function logAlert(size, threshold) {
  const logFile = path.join(__dirname, '..', 'logs', 'storage-alerts.log');
  const logDir = path.dirname(logFile);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ALERT: Uploads folder size ${formatBytes(size)} exceeds threshold ${formatBytes(threshold)}\n`;

  fs.appendFileSync(logFile, logEntry, 'utf8');
  console.log(`📝 Alert logged to ${logFile}`);
}

/**
 * Main monitoring function
 */
async function monitorStorage() {
  console.log('🔍 Checking uploads folder size...');

  if (!fs.existsSync(UPLOADS_DIR)) {
    console.log('⚠️  Uploads directory does not exist yet');
    return;
  }

  const currentSize = getDirectorySize(UPLOADS_DIR);
  const currentSizeFormatted = formatBytes(currentSize);
  const thresholdFormatted = formatBytes(THRESHOLD_BYTES);

  console.log(`📊 Current size: ${currentSizeFormatted}`);
  console.log(`⚖️  Threshold: ${thresholdFormatted}`);

  if (currentSize > THRESHOLD_BYTES) {
    console.log('🚨 ALERT: Size exceeds threshold!');

    // Log the alert
    logAlert(currentSize, THRESHOLD_BYTES);

    // Send email notification
    await sendEmailAlert(currentSize, THRESHOLD_BYTES);

    // Exit with code 1 to indicate alert condition
    process.exit(1);
  } else {
    const percentUsed = ((currentSize / THRESHOLD_BYTES) * 100).toFixed(1);
    console.log(`✅ Size is within limits (${percentUsed}% of threshold)`);
    process.exit(0);
  }
}

// Run the monitor
monitorStorage().catch(error => {
  console.error('❌ Monitoring error:', error);
  process.exit(1);
});
