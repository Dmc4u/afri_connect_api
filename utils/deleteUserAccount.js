const User = require("../models/User");
const Listing = require("../models/Listing");
const Payment = require("../models/Payment");
const ApiKey = require("../models/ApiKey");
const ApiUsage = require("../models/ApiUsage");
const ActivityLog = require("../models/ActivityLog");
const ForumPost = require("../models/ForumPost");
const MessageNotification = require("../models/MessageNotification");
const gcs = require("./gcs");

// Keep self-service deletion aligned with the permanent admin deletion cascade.
const deleteUserAccount = async (targetUser) => {
  const userListings = await Listing.find({ owner: targetUser._id });

  if (userListings.length > 0) {
    await Promise.allSettled(
      userListings.map((listing) => gcs.deleteListingMedia(listing)),
    );
  }

  const profilePhotoDeletions = [];
  if (targetUser.avatar) profilePhotoDeletions.push(gcs.deleteFromUrl(targetUser.avatar));
  if (targetUser.profilePhoto) {
    profilePhotoDeletions.push(gcs.deleteFromUrl(targetUser.profilePhoto));
  }
  await Promise.allSettled(profilePhotoDeletions);

  await Promise.all([
    Listing.deleteMany({ owner: targetUser._id }),
    Payment.deleteMany({ user: targetUser._id }),
    ApiKey.deleteMany({ user: targetUser._id }),
    ApiUsage.deleteMany({ userId: targetUser._id }),
    ActivityLog.deleteMany({ userId: targetUser._id }),
    ForumPost.deleteMany({ author: targetUser._id }),
    MessageNotification.deleteMany({
      $or: [{ sender: targetUser._id }, { recipient: targetUser._id }],
    }),
  ]);

  await User.findByIdAndDelete(targetUser._id);
};

module.exports = deleteUserAccount;
