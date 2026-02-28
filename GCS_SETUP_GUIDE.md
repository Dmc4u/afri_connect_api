# Google Cloud Storage Setup for Listing Media

## Environment Variables Required

Add these to your `.env` file in `afri_connect_api/`:

```bash
# Google Cloud Storage Configuration
GCS_BUCKET=afrionet-media-sacred
GCS_PROJECT_ID=your-project-id
GCS_UPLOAD_PREFIX=afrionet
UPLOAD_PROVIDER=gcs
USE_GCS=true
GCS_MAKE_PUBLIC=true

# Optional: Custom CDN URL (if using Cloud CDN)
# GCS_PUBLIC_BASE_URL=https://cdn.yourdomain.com

# Google Application Credentials (path to service account JSON)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

## Changes Implemented

### 1. ✅ All New Users Get Pro Tier Automatically

- File: `controllers/user.js`
- All new signups now get `tier: "Pro"` by default
- Existing users keep their current tier

### 2. ✅ Listing Media Uploads to Google Cloud Storage

- File: `controllers/listing.js`
- Uses your existing `utils/gcs.js` functions
- Falls back to local storage if GCS upload fails
- Automatically deletes local files after successful GCS upload

## Folder Structure in GCS Bucket

```
afrionet-media-sacred/
├── afrionet/
│   ├── images/
│   │   └── listing-files-{timestamp}-{nonce}.jpg
│   └── videos/
│       └── listing-files-{timestamp}-{nonce}.mp4
```

## How It Works

1. **File Upload**: User uploads listing media via frontend
2. **Temp Storage**: File temporarily saved to `uploads/listings/`
3. **GCS Upload**: File uploaded to `afrionet-media-sacred` bucket
4. **Public URL**: Returns GCS public URL (or CDN URL if configured)
5. **Cleanup**: Local temp file deleted after successful upload
6. **Fallback**: If GCS fails, uses local storage with console warning

## Testing

1. Restart backend:

   ```bash
   pm2 restart app
   ```

2. Check logs for GCS status:

   ```bash
   pm2 logs app | grep GCS
   ```

3. Create a new listing with image/video
4. Verify file appears in GCS bucket console
5. Check that the URL returned is from GCS

## Troubleshooting

**If uploads still go to local storage:**

- Check `.env` has `USE_GCS=true`
- Verify `GCS_BUCKET=afrionet-media-sacred`
- Ensure service account JSON path is correct
- Check PM2 logs for GCS errors

**Permission Issues:**

- Service account needs `Storage Object Creator` role
- Bucket needs public access or custom IAM policy
- Check `GCS_MAKE_PUBLIC=true` in `.env`

## Existing Users

To upgrade existing users to Pro tier, run in MongoDB:

```javascript
// Upgrade all non-admin users to Pro
db.users.updateMany({ role: { $ne: "admin" } }, { $set: { tier: "Pro" } });

// Verify update
db.users.find({}, { email: 1, tier: 1, role: 1 });
```
