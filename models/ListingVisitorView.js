const mongoose = require("mongoose");

const listingVisitorViewSchema = new mongoose.Schema(
  {
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: true,
    },
    visitorId: {
      type: String,
      trim: true,
      required: true,
    },
  },
  { timestamps: true }
);

listingVisitorViewSchema.index({ listing: 1, visitorId: 1 }, { unique: true });

module.exports = mongoose.model("ListingVisitorView", listingVisitorViewSchema);
