const ForumPost = require("../models/ForumPost");
const User = require("../models/User");
const { BadRequestError, NotFoundError, ForbiddenError } = require("../utils/errors");

// Get all forum posts (public)
const getAllPosts = async (req, res, next) => {
  try {
    const {
      category,
      search,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
      status = "published",
    } = req.query;

    const query = { status };

    if (category && category !== "all") {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { content: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }

    const skip = (page - 1) * limit;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const posts = await ForumPost.find(query)
      .populate("author", "name email tier role avatar settings")
      .populate("replies.author", "name email tier role avatar settings")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Add user-specific data if authenticated
    const userId = req.user?._id;
    const postsWithUserData = posts.map((post) => ({
      ...post,
      likes: post.likes?.length || 0,
      hasLiked: userId
        ? post.likes?.some((like) => like.user.toString() === userId.toString())
        : false,
      repliesCount: post.replies?.length || 0,
    }));

    const total = await ForumPost.countDocuments(query);

    res.json({
      success: true,
      posts: postsWithUserData,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        hasNext: skip + posts.length < total,
        hasPrev: page > 1,
        totalItems: total,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get single forum post (public)
const getPostById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const post = await ForumPost.findOne({
      _id: id,
      status: "published",
    })
      .populate("author", "name email tier role avatar settings")
      .populate("replies.author", "name email tier role avatar settings")
      .lean();

    if (!post) {
      throw new NotFoundError("Forum post not found");
    }

    // Increment views (don't await to avoid slowing response)
    ForumPost.findByIdAndUpdate(id, { $inc: { views: 1 } }).exec();

    res.json({
      success: true,
      post,
    });
  } catch (error) {
    next(error);
  }
};

// Create new forum post (protected)
const createPost = async (req, res, next) => {
  try {
    const { title, content, category, tags } = req.body;

    // Check user tier for forum access
    const user = await User.findById(req.user._id);
    if (!["Starter", "Premium", "Pro"].includes(user.tier) && user.role !== "admin") {
      throw new ForbiddenError(
        "Forum access requires a paid membership (Starter, Premium, or Pro)"
      );
    }

    // Get author display name - User model only has 'name' field
    const authorName = user.name || "Unknown User";

    const postData = {
      title,
      content,
      category,
      tags: tags || [],
      author: req.user._id,
      authorName, // Store author name for persistence after user deletion
      status: "published", // Auto-publish for now, can add moderation later
    };

    const post = await ForumPost.create(postData);
    await post.populate("author", "name email tier role avatar settings");

    res.status(201).json({
      success: true,
      message: "Forum post created successfully",
      post,
    });
  } catch (error) {
    next(error);
  }
};

// Update forum post (protected - author only)
const updatePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const post = await ForumPost.findById(id);

    if (!post) {
      throw new NotFoundError("Forum post not found");
    }

    // Check ownership or admin
    if (post.author.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      throw new ForbiddenError("You can only update your own posts");
    }

    // Remove fields that shouldn't be updated directly
    delete updates.author;
    delete updates.views;
    delete updates.replies;
    delete updates.createdAt;

    const updatedPost = await ForumPost.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).populate("author", "name email tier role avatar settings");

    res.json({
      success: true,
      message: "Forum post updated successfully",
      post: updatedPost,
    });
  } catch (error) {
    next(error);
  }
};

// Delete forum post (protected - author or admin only)
const deletePost = async (req, res, next) => {
  try {
    const { id } = req.params;

    const post = await ForumPost.findById(id);

    if (!post) {
      throw new NotFoundError("Forum post not found");
    }

    // Check ownership or admin
    if (post.author.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      throw new ForbiddenError("You can only delete your own posts");
    }

    // Soft delete - change status instead of removing
    await ForumPost.findByIdAndUpdate(id, { status: "deleted" });

    res.json({
      success: true,
      message: "Forum post deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Add reply to forum post (protected)
const addReply = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    // Check user tier for forum access
    const user = await User.findById(req.user._id);
    if (!["Starter", "Premium", "Pro"].includes(user.tier) && !user.isAdmin) {
      throw new ForbiddenError(
        "Forum access requires a paid membership (Starter, Premium, or Pro)"
      );
    }

    const post = await ForumPost.findOne({
      _id: id,
      status: "published",
    });

    if (!post) {
      throw new NotFoundError("Forum post not found");
    }

    // Get reply author display name - User model only has 'name' field
    const authorName = user.name || "Unknown User";

    const reply = {
      content,
      author: req.user._id,
      authorName, // Store author name for persistence after user deletion
      createdAt: new Date(),
    };

    post.replies.push(reply);
    await post.save();

    // Populate the new reply
    await post.populate("replies.author", "name email tier role avatar settings");

    const newReply = post.replies[post.replies.length - 1];

    res.status(201).json({
      success: true,
      message: "Reply added successfully",
      reply: newReply,
    });
  } catch (error) {
    next(error);
  }
};

// Like/Unlike forum post (protected)
const toggleLike = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    // Check user tier for forum access
    const user = await User.findById(req.user._id);
    if (!["Starter", "Premium", "Pro"].includes(user.tier) && user.role !== "admin") {
      throw new ForbiddenError(
        "Forum access requires a paid membership (Starter, Premium, or Pro)"
      );
    }

    const post = await ForumPost.findOne({
      _id: id,
      status: "published",
    });

    if (!post) {
      throw new NotFoundError("Forum post not found");
    }

    const likeIndex = post.likes.findIndex((like) => like.user.toString() === userId.toString());
    let action;

    if (likeIndex > -1) {
      // Unlike
      post.likes.splice(likeIndex, 1);
      action = "unliked";
    } else {
      // Like
      post.likes.push({ user: userId, createdAt: new Date() });
      action = "liked";
    }

    await post.save();

    res.json({
      success: true,
      message: `Post ${action} successfully`,
      likesCount: post.likes.length,
      isLiked: action === "liked",
    });
  } catch (error) {
    next(error);
  }
};

// Get user's own forum posts (protected)
const getMyPosts = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = "all" } = req.query;

    const query = { author: req.user._id };

    if (status !== "all") {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const posts = await ForumPost.find(query)
      .populate("author", "name email tier role avatar settings")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await ForumPost.countDocuments(query);

    res.json({
      success: true,
      posts,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        hasNext: skip + posts.length < total,
        hasPrev: page > 1,
        totalItems: total,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Delete reply from forum post (protected - reply author or admin only)
const deleteReply = async (req, res, next) => {
  try {
    const { id, replyId } = req.params;

    const post = await ForumPost.findById(id);

    if (!post) {
      throw new NotFoundError("Forum post not found");
    }

    // Find the reply
    const reply = post.replies.id(replyId);

    if (!reply) {
      throw new NotFoundError("Reply not found");
    }

    // Check ownership or admin
    if (reply.author.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      throw new ForbiddenError("You can only delete your own replies");
    }

    // Remove reply from replies array
    post.replies.id(replyId).deleteOne();
    await post.save();

    res.json({
      success: true,
      message: "Reply deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  addReply,
  deleteReply,
  toggleLike,
  getMyPosts,
};
