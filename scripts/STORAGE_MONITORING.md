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

### 5. Set Up Automated Daily Checks

#### Option A: Manual Checks
Run the script manually whenever needed:
```bash
cd /home/dmsesbiz2005/afri_connect_api
node scripts/monitor-storage.js
```

#### Option B: PM2 Scheduled Task (Recommended)
Since your server uses PM2, you can schedule the monitoring script:

1. Install PM2 cron module:
```bash
pm2 install pm2-cron
```

2. Start the monitoring with cron schedule:
```bash
cd /home/dmsesbiz2005/afri_connect_api
pm2 start scripts/monitor-storage.js --name storage-monitor --cron "0 0 * * *" --no-autorestart
pm2 save
```

This runs daily at midnight. To check different times:
- Every 6 hours: `--cron "0 */6 * * *"`
- Every day at 2 AM: `--cron "0 2 * * *"`
- Twice daily (6 AM & 6 PM): `--cron "0 6,18 * * *"`

3. View monitoring logs:
```bash
pm2 logs storage-monitor
```

4. Check status:
```bash
pm2 list
```

#### Option C: Systemd Timer (Advanced)
If you prefer systemd over PM2 for monitoring, see advanced setup in docs.

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
