// Central error handling middleware
module.exports = (err, req, res, next) => {
  console.error("Error:", err);

  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";
  let details = null;

  // Handle Celebrate/Joi validation errors
  if (err.joi && err.details) {
    statusCode = 400;
    details = err.details.map((detail) => `${detail.context.key}: ${detail.message}`);
    message = "Validation Error: " + details.join(", ");
  }

  // Handle Multer upload errors
  // https://github.com/expressjs/multer#error-handling
  if (err && err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      statusCode = 413;
      const maxMb = Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 250);
      message = `File too large. Maximum allowed size is ${maxMb}MB.`;
    } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
      statusCode = 400;
      message = "Unexpected file field.";
    } else {
      statusCode = 400;
      message = err.message || "Upload failed";
    }
  }

  // Handle Mongoose validation errors
  if (err.name === "ValidationError") {
    statusCode = 400;
    details = Object.values(err.errors).map((e) => e.message);
    message = "Validation Error: " + details.join(", ");
  }

  // Handle Mongoose cast errors
  if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid ID format";
  }

  // Handle duplicate key errors
  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyPattern)[0];
    message = `${field} already exists`;
  }

  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? "Internal Server Error" : message,
    ...(details && { details }),
  });
};
