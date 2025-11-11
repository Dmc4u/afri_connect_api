const mongoose = require("mongoose");

const forumPostSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Post title is required"],
      trim: true,
      minlength: [3, "Title must be at least 3 characters"],
      maxlength: [150, "Title cannot exceed 150 characters"],
      index: true,
    },
    content: {
      type: String,
      required: [true, "Post content is required"],
      trim: true,
      minlength: [10, "Content must be at least 10 characters"],
      maxlength: [10000, "Content cannot exceed 10,000 characters"],
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    authorName: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: [
        "general",
        "business",
        "technology",
        "marketing",
        "networking",
        "advice",
        "showcase",
        "feedback",
        "support",
        "announcements",
      ],
      index: true,
    },
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 30,
      },
    ],
    status: {
      type: String,
      enum: ["draft", "published", "archived", "deleted", "flagged"],
      default: "published",
      index: true,
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    views: {
      type: Number,
      default: 0,
      min: 0,
    },
    likes: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    replies: [
      {
        author: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        authorName: {
          type: String,
          required: true,
          trim: true,
        },
        content: {
          type: String,
          required: true,
          trim: true,
          minlength: 1,
          maxlength: 5000,
        },
        likes: [
          {
            user: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
              required: true,
            },
            createdAt: {
              type: Date,
              default: Date.now,
            },
          },
        ],
        isEdited: {
          type: Boolean,
          default: false,
        },
        editHistory: [
          {
            content: String,
            editedAt: {
              type: Date,
              default: Date.now,
            },
          },
        ],
        status: {
          type: String,
          enum: ["active", "deleted", "flagged"],
          default: "active",
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    attachments: [
      {
        filename: String,
        originalname: String,
        mimetype: String,
        size: Number,
        url: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    lastActivity: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastReplyAt: {
      type: Date,
      default: null,
    },
    replyCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    likeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    moderationFlags: [
      {
        reporter: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        reason: {
          type: String,
          required: true,
          enum: ["spam", "inappropriate", "harassment", "off-topic", "duplicate", "other"],
        },
        description: {
          type: String,
          maxlength: 500,
        },
        status: {
          type: String,
          enum: ["pending", "reviewed", "dismissed"],
          default: "pending",
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
forumPostSchema.index({ category: 1, status: 1, lastActivity: -1 });
forumPostSchema.index({ author: 1, status: 1, createdAt: -1 });
forumPostSchema.index({ tags: 1, status: 1 });
forumPostSchema.index({ isPinned: -1, lastActivity: -1 });
forumPostSchema.index({ title: "text", content: "text" }); // Text search

// Virtual for total engagement (likes + replies)
forumPostSchema.virtual("engagementScore").get(function () {
  return this.likeCount + this.replyCount;
});

// Virtual to check if user liked the post
forumPostSchema.methods.isLikedBy = function (userId) {
  return this.likes.some((like) => like.user.toString() === userId.toString());
};

// Method to add a like
forumPostSchema.methods.addLike = function (userId) {
  if (!this.isLikedBy(userId)) {
    this.likes.push({ user: userId });
    this.likeCount = this.likes.length;
    this.lastActivity = new Date();
  }
  return this;
};

// Method to remove a like
forumPostSchema.methods.removeLike = function (userId) {
  this.likes = this.likes.filter((like) => like.user.toString() !== userId.toString());
  this.likeCount = this.likes.length;
  return this;
};

// Method to add a reply
forumPostSchema.methods.addReply = function (replyData) {
  this.replies.push(replyData);
  this.replyCount = this.replies.length;
  this.lastReplyAt = new Date();
  this.lastActivity = new Date();
  return this;
};

// Method to increment view count
forumPostSchema.methods.incrementViews = function () {
  this.views += 1;
  return this.save();
};

// Pre-save middleware
forumPostSchema.pre("save", function (next) {
  if (this.isModified("replies")) {
    this.replyCount = this.replies.filter((reply) => reply.status === "active").length;
  }
  if (this.isModified("likes")) {
    this.likeCount = this.likes.length;
  }
  this.updatedAt = Date.now();
  next();
});

// Static method to get trending posts
forumPostSchema.statics.getTrending = function (timeframe = "week", limit = 10) {
  const now = new Date();
  let startDate;

  switch (timeframe) {
    case "day":
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "week":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "month":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  return this.find({
    status: "published",
    createdAt: { $gte: startDate },
  })
    .populate("author", "name tier")
    .sort({ engagementScore: -1, views: -1 })
    .limit(limit);
};

module.exports = mongoose.model("ForumPost", forumPostSchema);
