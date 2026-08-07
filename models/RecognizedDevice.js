const mongoose = require("mongoose");

const recognizedDeviceSchema = new mongoose.Schema(
  {
    deviceHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
      minlength: 64,
      maxlength: 64,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    lastAuthenticatedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RecognizedDevice", recognizedDeviceSchema);
