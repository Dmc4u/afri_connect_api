const mongoose = require("mongoose");

const pageViewSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
      maxlength: 120,
    },
    path: {
      type: String,
      required: true,
      index: true,
      maxlength: 500,
    },
    title: {
      type: String,
      default: "",
      maxlength: 250,
    },
    visitorLabel: {
      type: String,
      default: "Guest",
      maxlength: 120,
    },
    referrer: {
      type: String,
      default: "",
      maxlength: 1000,
    },
    device: {
      type: String,
      enum: ["mobile", "tablet", "desktop", "unknown"],
      default: "unknown",
    },
    viewedAt: {
      type: Date,
      default: Date.now,
      index: true,
      expires: 60 * 60 * 24,
    },
  },
  { timestamps: false },
);

pageViewSchema.index({ viewedAt: -1, path: 1 });
pageViewSchema.index({ sessionId: 1, viewedAt: -1 });

module.exports = mongoose.model("PageView", pageViewSchema);
