const { getClientFeatureFlags } = require("../utils/appContent");

const getAppStatus = async (req, res, next) => {
  try {
    const { flags, mtimeMs } = getClientFeatureFlags();

    const membershipUiEnabled = Boolean(flags.MEMBERSHIP_UI_ENABLED);
    const membershipRouteEnabled = Boolean(flags.MEMBERSHIP_ROUTE_ENABLED);
    const forceProForAll = Boolean(flags.FORCE_PRO_MEMBERSHIP_FOR_ALL);
    const talentShowcaseEntryFeesEnabled = Boolean(flags.TALENT_SHOWCASE_ENTRY_FEES_ENABLED);

    const growthMode = !membershipUiEnabled && !membershipRouteEnabled;
    const freeEntryMode = !talentShowcaseEntryFeesEnabled;

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
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAppStatus,
};
