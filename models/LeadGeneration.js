const mongoose = require("mongoose");

const leadGenerationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      default: null,
    },
    leadName: {
      type: String,
      required: true,
    },
    leadEmail: {
      type: String,
      required: true,
    },
    leadPhone: {
      type: String,
      default: "",
    },
    message: {
      type: String,
      default: "",
    },
    source: {
      type: String,
      enum: ["website", "app", "social", "email", "phone", "other"],
      default: "app",
    },
    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "converted", "lost"],
      default: "new",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    notes: {
      type: String,
      default: "",
    },
    tags: [
      {
        type: String,
      },
    ],
    followUpDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
leadGenerationSchema.index({ userId: 1, createdAt: -1 });
leadGenerationSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("LeadGeneration", leadGenerationSchema);
