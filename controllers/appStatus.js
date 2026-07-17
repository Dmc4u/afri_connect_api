const { getClientFeatureFlags } = require("../utils/appContent");

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const getAppStatus = async (req, res, next) => {
  try {
    const { flags, mtimeMs } = getClientFeatureFlags();

    const membershipUiEnabled = Boolean(flags.MEMBERSHIP_UI_ENABLED);
    const membershipRouteEnabled = Boolean(flags.MEMBERSHIP_ROUTE_ENABLED);
    const forceProForAll = Boolean(flags.FORCE_PRO_MEMBERSHIP_FOR_ALL);
    const talentShowcaseEntryFeesEnabled = Boolean(flags.TALENT_SHOWCASE_ENTRY_FEES_ENABLED);

    const growthMode = !membershipUiEnabled && !membershipRouteEnabled;
    const freeEntryMode = !talentShowcaseEntryFeesEnabled;
    const latestAndroidVersionCode = toPositiveInt(process.env.APP_ANDROID_LATEST_VERSION_CODE, 16);
    const requiredAndroidVersionCode = toPositiveInt(
      process.env.APP_ANDROID_REQUIRED_VERSION_CODE,
      0
    );
    const latestAndroidVersionName = process.env.APP_ANDROID_LATEST_VERSION_NAME || "1.15";
    const androidUpdateEnabled = toBool(process.env.APP_ANDROID_UPDATE_ENABLED, true);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      source: {
        type: "client-featureFlags.js",
        mtimeMs,
      },
      flags: {
        MEMBERSHIP_UI_ENABLED: membershipUiEnabled,
        MEMBERSHIP_ROUTE_ENABLED: membershipRouteEnabled,
        FORCE_PRO_MEMBERSHIP_FOR_ALL: forceProForAll,
        TALENT_SHOWCASE_ENTRY_FEES_ENABLED: talentShowcaseEntryFeesEnabled,
      },
      modes: {
        growthMode,
        freeEntryMode,
      },
      appUpdate: {
        android: {
          enabled: androidUpdateEnabled,
          latestVersionCode: latestAndroidVersionCode,
          latestVersionName: latestAndroidVersionName,
          requiredVersionCode: requiredAndroidVersionCode,
          packageName: "com.afrionet.app",
          storeUrl: "https://play.google.com/store/apps/details?id=com.afrionet.app",
          title: "Update AfriOnet",
          message:
            "New update available. Update now to get the latest AfriOnet improvements from Google Play.",
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAppStatus,
};
