const ActivityLog = require("../models/ActivityLog");

/**
 * Log an activity to the activity log
 * @param {Object} activityData - Activity data to log
 */
const logActivity = async (activityData) => {
  try {
    const {
      type,
      description,
      userId,
      userName,
      userEmail,
      action,
      targetType,
      targetId,
      details = {},
      ipAddress = null,
      userAgent = null,
    } = activityData;

    const activity = new ActivityLog({
      type,
      description,
      userId,
      userName,
      userEmail,
      action,
      targetType,
      targetId,
      details,
      ipAddress,
      userAgent,
      timestamp: new Date(),
    });

    await activity.save();
    return activity;
  } catch (error) {
    console.error("Error logging activity:", error);
    // Don't throw error - activity logging should not break main operations
  }
};

module.exports = { logActivity };
