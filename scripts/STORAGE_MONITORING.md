# Storage Monitoring Setup

## Overview
Automated monitoring script that alerts administrators when the uploads folder exceeds 1GB.

## Features
- ✅ Checks uploads folder size daily
- ✅ Sends email alerts when threshold is exceeded
- ✅ Logs alerts to `logs/storage-alerts.log`
- ✅ Configurable threshold (default: 1GB)
- ✅ Human-readable size formatting

## Setup Instructions

### 1. Install Dependencies (if using email alerts)
```bash
cd /home/dmsesbiz2005/afri_connect_api
npm install nodemailer --save
```

### 2. Configure Environment Variables (Optional - for email alerts)
Add to your `.env` file:
```env
# Admin email for storage alerts
ADMIN_EMAIL=support@dmclimited.net

# SMTP settings (optional - for email notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=AfriOnet Alerts <noreply@afrionet.com>
```

**Note:** If SMTP is not configured, the script will still run and log alerts to file.

### 3. Make Script Executable
```bash
chmod +x /home/dmsesbiz2005/afri_connect_api/scripts/monitor-storage.js
```

### 4. Test the Script
```bash
node /home/dmsesbiz2005/afri_connect_api/scripts/monitor-storage.js
```

Expected output:
```
🔍 Checking uploads folder size...
📊 Current size: 59 MB
⚖️  Threshold: 1 GB
✅ Size is within limits (5.7% of threshold)
```

### 5. Set Up Automated Daily Checks with Cron

Edit crontab:
```bash
crontab -e
```

Add this line to run daily at midnight:
```cron
0 0 * * * /usr/bin/node /home/dmsesbiz2005/afri_connect_api/scripts/monitor-storage.js >> /home/dmsesbiz2005/afri_connect_api/logs/storage-monitor.log 2>&1
```

Or run every 6 hours:
```cron
0 */6 * * * /usr/bin/node /home/dmsesbiz2005/afri_connect_api/scripts/monitor-storage.js >> /home/dmsesbiz2005/afri_connect_api/logs/storage-monitor.log 2>&1
```

Verify cron job:
```bash
crontab -l
```

## Configuration Options

### Change Alert Threshold
Edit `monitor-storage.js`:
```javascript
const THRESHOLD_GB = 2; // Alert at 2GB instead of 1GB
```

### Change Admin Email
Edit `.env`:
```env
ADMIN_EMAIL=admin@yourdomain.com
```

## Alert Email Example

When threshold is exceeded, admin receives an email with:
- Current upload folder size
- Configured threshold
- Server location
- Recommended cleanup actions

## Logs

- **Storage alerts:** `logs/storage-alerts.log`
- **Cron execution:** `logs/storage-monitor.log`

View recent alerts:
```bash
tail -f /home/dmsesbiz2005/afri_connect_api/logs/storage-alerts.log
```

## Manual Monitoring Commands

Check current uploads size:
```bash
du -sh /home/dmsesbiz2005/afri_connect_api/uploads/
```

Check disk space:
```bash
df -h
```

List largest files in uploads:
```bash
find /home/dmsesbiz2005/afri_connect_api/uploads/ -type f -exec du -h {} + | sort -rh | head -20
```

## Cleanup Recommendations

When alert is triggered:

1. **Review old files:**
   ```bash
   find /home/dmsesbiz2005/afri_connect_api/uploads/ -type f -mtime +180
   ```

2. **Backup before cleanup:**
   ```bash
   tar -czf uploads-backup-$(date +%Y%m%d).tar.gz uploads/
   ```

3. **Remove orphaned files** (files not referenced in database)
   - Manual review recommended
   - Consider implementing automated cleanup policy

## Troubleshooting

### Script not running
Check cron logs:
```bash
grep CRON /var/log/syslog | tail -20
```

### Email not sending
- Verify SMTP credentials in `.env`
- Check Gmail "App Passwords" if using Gmail
- Review script output in cron log

### Permission denied
```bash
chmod +x /home/dmsesbiz2005/afri_connect_api/scripts/monitor-storage.js
```

## Security Notes

- Store SMTP credentials securely in `.env` (not in git)
- Use app-specific passwords for Gmail
- Limit email recipients to trusted admins only
- Monitor logs regularly for unauthorized access attempts
