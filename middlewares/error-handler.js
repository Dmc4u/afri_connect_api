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

  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? "Internal Server Error" : message,
    ...(details && { details }),
  });

  next();
};
