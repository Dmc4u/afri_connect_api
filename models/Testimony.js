// Import mongoose - the MongoDB ODM (Object Data Modeling) library
// ODM helps us define schemas and interact with MongoDB in a structured way
const mongoose = require("mongoose");

// Define the schema for testimonies
// A schema is like a blueprint that defines the structure and rules for our data
const testimonySchema = new mongoose.Schema(
  {
    // Reference to the User who submitted the testimony
    // This creates a relationship between Testimony and User collections
    user: {
      type: mongoose.Schema.Types.ObjectId, // Special type for referencing other documents
      ref: "User", // Name of the model this references
      required: [true, "User is required"], // Validation: testimony must have a user
    },

    // The actual testimony text content
    content: {
      type: String, // Data type
      required: [true, "Testimony content is required"], // Cannot be empty
      trim: true, // Automatically removes whitespace from beginning and end
      minlength: [10, "Testimony must be at least 10 characters"], // Minimum length validation
      maxlength: [1000, "Testimony cannot exceed 1000 characters"], // Maximum length validation
    },

    // User's name (stored directly for display purposes)
    // This duplicates the user data but makes queries faster (denormalization)
    userName: {
      type: String,
      required: [true, "User name is required"],
      trim: true,
    },

    // Optional: User's profile image URL
    // Stored here so we don't have to lookup the User document every time
    userImage: {
      type: String,
      default: null, // If not provided, defaults to null
    },

    // User's company or title (e.g., "CEO at TechCorp")
    userTitle: {
      type: String,
      trim: true,
      maxlength: [100, "User title cannot exceed 100 characters"],
      default: "", // Empty string if not provided
    },

    // Rating given by the user (1-5 stars)
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1"], // Minimum value
      max: [5, "Rating cannot exceed 5"], // Maximum value
      validate: {
        // Custom validation to ensure rating is a whole number
        validator: function (value) {
          return Number.isInteger(value);
        },
        message: "Rating must be a whole number",
      },
    },

    // Whether the testimony is approved to be displayed publicly
    // Admin needs to approve testimonies before they appear on the site
    isApproved: {
      type: Boolean,
      default: false, // New testimonies start as unapproved
    },

    // Whether the testimony is currently featured/highlighted
    // Featured testimonies can be shown prominently on the homepage
    isFeatured: {
      type: Boolean,
      default: false,
      index: true, // Creates a database index for faster queries
    },

    // Date when the testimony was approved (if approved)
    approvedAt: {
      type: Date,
      default: null,
    },

    // Reference to the admin who approved the testimony
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // References the admin user
      default: null,
    },

    // Order/position for displaying testimonies
    // Lower numbers appear first (useful for manual ordering)
    displayOrder: {
      type: Number,
      default: 0,
    },

    // Soft delete flag - marks testimony as deleted without actually removing it
    // This allows for recovery and maintains data integrity
    isDeleted: {
      type: Boolean,
      default: false,
      index: true, // Index for faster queries filtering out deleted items
    },
  },
  {
    // Mongoose options object

    // Automatically adds createdAt and updatedAt timestamps
    // createdAt: when the document was first created
    // updatedAt: automatically updated whenever the document is modified
    timestamps: true,

    // Include virtuals when converting document to JSON
    // Virtuals are computed properties that aren't stored in the database
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Create indexes for better query performance
// Compound index for common queries (approved, not deleted, sorted by date)
testimonySchema.index({ isApproved: 1, isDeleted: 1, createdAt: -1 });
// This makes queries like "get all approved, non-deleted testimonies" much faster

// Index for featured testimonies query
testimonySchema.index({ isFeatured: 1, isApproved: 1, isDeleted: 1 });

// Virtual property: Get the user's full testimony summary
// Virtuals are computed properties that are generated dynamically
testimonySchema.virtual("summary").get(function () {
  // 'this' refers to the current testimony document
  // Return first 100 characters of content as a summary
  return this.content.length > 100 ? this.content.substring(0, 100) + "..." : this.content;
});

// Instance method: Mark testimony as approved
// Instance methods are available on individual documents
testimonySchema.methods.approve = async function (adminId) {
  // 'this' refers to the specific testimony document
  this.isApproved = true;
  this.approvedAt = new Date();
  this.approvedBy = adminId;
  // Save the changes to the database
  return await this.save();
};

// Instance method: Mark testimony as featured
testimonySchema.methods.feature = async function () {
  this.isFeatured = true;
  return await this.save();
};

// Instance method: Soft delete the testimony
testimonySchema.methods.softDelete = async function () {
  this.isDeleted = true;
  return await this.save();
};

// Static method: Get all approved testimonies
// Static methods are available on the model itself (not individual documents)
testimonySchema.statics.getApproved = function (limit = 10) {
  // 'this' refers to the Testimony model
  return this.find({
    isApproved: true,
    isDeleted: false,
  })
    .sort({ createdAt: -1 }) // Sort by newest first (-1 = descending)
    .limit(limit)
    .populate("user", "name email profileImage") // Include user details
    .exec(); // Execute the query
};

// Static method: Get featured testimonies
testimonySchema.statics.getFeatured = function () {
  return this.find({
    isFeatured: true,
    isApproved: true,
    isDeleted: false,
  })
    .sort({ displayOrder: 1, createdAt: -1 }) // Sort by displayOrder, then date
    .populate("user", "name email profileImage")
    .exec();
};

// Static method: Get pending testimonies (for admin review)
testimonySchema.statics.getPending = function () {
  return this.find({
    isApproved: false,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .populate("user", "name email profileImage")
    .exec();
};

// Pre-save hook: Runs before saving a document
// Useful for data validation, modification, or side effects
testimonySchema.pre("save", function (next) {
  // If testimony is being approved and approvedAt is not set, set it now
  if (this.isApproved && !this.approvedAt) {
    this.approvedAt = new Date();
  }
  // Call next() to continue with the save operation
  next();
});

// Create and export the Testimony model
// The model is a constructor function for creating and querying documents
// First argument: name of the model (used in ref fields)
// Second argument: the schema
const Testimony = mongoose.model("Testimony", testimonySchema);

// Export the model so it can be used in other files
module.exports = Testimony;
