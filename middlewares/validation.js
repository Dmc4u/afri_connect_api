const { Joi, celebrate } = require("celebrate");
const validator = require("validator");

// Custom URL validator using the 'validator' package
const validateURL = (value, helpers) => {
  if (validator.isURL(value)) {
    return value;
  }
  return helpers.error("string.uri");
};

// Middleware to log validation errors globally
module.exports.logValidationErrors = (err, req, res, next) => {
  if (err.joi) {
    console.error("Validation error details:", err.joi.details);
    // Respond with structured validation error in development to aid debugging
    // If headers already sent, pass to next
    if (!res.headersSent) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        details: err.joi.details.map((d) => ({ message: d.message, path: d.path })),
      });
    }
  }
  return next(err);
};

// Validate clothing item creation
module.exports.validateCardBody = celebrate({
  body: Joi.object().keys({
    name: Joi.string().required().min(2).max(30).messages({
      "string.min": 'The minimum length of the "name" field is 2',
      "string.max": 'The maximum length of the "name" field is 30',
      "string.empty": 'The "name" field must be filled in',
    }),
    imageUrl: Joi.string().required().custom(validateURL).messages({
      "string.empty": 'The "imageUrl" field must be filled in',
      "string.uri": 'The "imageUrl" field must be a valid URL',
    }),
    weather: Joi.string().required().valid("hot", "warm", "cold").messages({
      "string.empty": 'The "weather" field must be filled in',
    }),
  }),
});

// Validate user creation (signup)
module.exports.validateUserBody = celebrate({
  body: Joi.object().keys({
    name: Joi.string().required().min(2).max(30).messages({
      "string.min": 'The minimum length of the "name" field is 2',
      "string.max": 'The maximum length of the "name" field is 30',
      "string.empty": 'The "name" field must be filled in',
    }),
    email: Joi.string().required().email().messages({
      "string.empty": 'The "email" field must be filled in',
      "string.email": 'The "email" field must be a valid email',
    }),
    phone: Joi.string().required().messages({
      "string.empty": 'The "phone" field must be filled in',
    }),
    country: Joi.string().required().messages({
      "string.empty": 'The "country" field must be filled in',
      "any.required": 'The "country" field is required',
    }),
    password: Joi.string().required().min(6).messages({
      "string.empty": 'The "password" field must be filled in',
      "string.min": 'The minimum length of the "password" field is 6',
    }),
  }),
});

// Validate user signup (alias for routes compatibility)
module.exports.validateSignup = celebrate({
  body: Joi.object().keys({
    name: Joi.string().required().min(2).max(30).messages({
      "string.min": 'The minimum length of the "name" field is 2',
      "string.max": 'The maximum length of the "name" field is 30',
      "string.empty": 'The "name" field must be filled in',
    }),
    email: Joi.string().required().email().messages({
      "string.empty": 'The "email" field must be filled in',
      "string.email": 'The "email" field must be a valid email',
    }),
    phone: Joi.string().required().messages({
      "string.empty": 'The "phone" field must be filled in',
    }),
    country: Joi.string().required().messages({
      "string.empty": 'The "country" field must be filled in',
      "any.required": 'The "country" field is required',
    }),
    password: Joi.string().required().min(6).messages({
      "string.empty": 'The "password" field must be filled in',
      "string.min": 'The minimum length of the "password" field is 6',
    }),
  }),
});

// Validate login credentials (signin)
module.exports.validateLogin = celebrate({
  body: Joi.object().keys({
    email: Joi.string().required().email().messages({
      "string.empty": 'The "email" field must be filled in',
      "string.email": 'The "email" field must be a valid email',
    }),
    password: Joi.string().required().messages({
      "string.empty": 'The "password" field must be filled in',
    }),
  }),
});

// Validate signin (alias for routes compatibility)
module.exports.validateSignin = celebrate({
  body: Joi.object().keys({
    email: Joi.string().required().email().messages({
      "string.empty": 'The "email" field must be filled in',
      "string.email": 'The "email" field must be a valid email',
    }),
    password: Joi.string().required().messages({
      "string.empty": 'The "password" field must be filled in',
    }),
  }),
});

// Validate IDs in request parameters
module.exports.validateId = celebrate({
  params: Joi.object().keys({
    itemId: Joi.string().length(24).hex().required().messages({
      "string.empty": 'The "itemId" field must be filled in',
      "string.length": 'The "itemId" field must be 24 characters long',
      "string.hex": 'The "itemId" field must be a hexadecimal value',
    }),
  }),
});

// Validate listing IDs in request parameters
module.exports.validateListingId = celebrate({
  params: Joi.object().keys({
    listingId: Joi.string().length(24).hex().required().messages({
      "string.empty": 'The "listingId" field must be filled in',
      "string.length": 'The "listingId" field must be 24 characters long',
      "string.hex": 'The "listingId" field must be a hexadecimal value',
    }),
  }),
});

// Validate user IDs in request parameters
module.exports.validateUserId = celebrate({
  params: Joi.object().keys({
    userId: Joi.string().length(24).hex().required().messages({
      "string.empty": 'The "userId" field must be filled in',
      "string.length": 'The "userId" field must be 24 characters long',
      "string.hex": 'The "userId" field must be a hexadecimal value',
    }),
  }),
});

// Validate updating user profile (PATCH /users/me)
module.exports.validateUpdateUser = celebrate({
  body: Joi.object().keys({
    name: Joi.string().min(2).max(30).messages({
      "string.min": 'The minimum length of the "name" field is 2',
      "string.max": 'The maximum length of the "name" field is 30',
    }),
    avatar: Joi.string().custom(validateURL).messages({
      "string.uri": 'The "avatar" field must be a valid URL',
    }),
    phone: Joi.string().messages({
      "string.base": 'The "phone" field must be a string',
    }),
    bio: Joi.string().max(500).messages({
      "string.max": 'The maximum length of the "bio" field is 500',
    }),
    country: Joi.string().messages({
      "string.base": 'The "country" field must be a string',
    }),
    tier: Joi.string().valid("basic", "premium", "admin").messages({
      "any.only": 'The "tier" field must be one of: basic, premium, admin',
    }),
  }),
});

// Validate business listing creation
module.exports.validateListingBody = celebrate({
  body: Joi.object().keys({
    businessName: Joi.string().required().min(2).max(100).messages({
      "string.min": 'The minimum length of the "businessName" field is 2',
      "string.max": 'The maximum length of the "businessName" field is 100',
      "string.empty": 'The "businessName" field must be filled in',
    }),
    category: Joi.string().required().messages({
      "string.empty": 'The "category" field must be filled in',
    }),
    description: Joi.string().required().min(10).max(1000).messages({
      "string.min": 'The minimum length of the "description" field is 10',
      "string.max": 'The maximum length of the "description" field is 1000',
      "string.empty": 'The "description" field must be filled in',
    }),
    location: Joi.object()
      .keys({
        country: Joi.string().required().messages({
          "string.empty": 'The "country" field must be filled in',
        }),
        city: Joi.string().required().messages({
          "string.empty": 'The "city" field must be filled in',
        }),
        address: Joi.string().allow("").messages({
          "string.base": 'The "address" field must be a string',
        }),
      })
      .required(),
    contactInfo: Joi.object()
      .keys({
        phone: Joi.string().allow("").messages({
          "string.base": 'The "phone" field must be a string',
        }),
        email: Joi.string().email().allow("").messages({
          "string.email": 'The "email" field must be a valid email',
        }),
        website: Joi.string()
          .allow("")
          .custom((value, helpers) => {
            if (!value) return value;
            if (validator.isURL(value)) return value;
            return helpers.error("string.uri");
          })
          .messages({
            "string.uri": 'The "website" field must be a valid URL',
          }),
      })
      .optional(),
    businessHours: Joi.string().allow("").optional(),
    tier: Joi.string().valid("Free", "Starter", "Premium", "Pro").optional(),
    images: Joi.array().items(Joi.string().custom(validateURL)).optional().messages({
      "string.uri": "Each image URL must be a valid URL",
    }),
    tags: Joi.array().items(Joi.string()).optional(),
    socialMedia: Joi.object()
      .keys({
        facebook: Joi.string().custom(validateURL).messages({
          "string.uri": 'The "facebook" field must be a valid URL',
        }),
        twitter: Joi.string().custom(validateURL).messages({
          "string.uri": 'The "twitter" field must be a valid URL',
        }),
        instagram: Joi.string().custom(validateURL).messages({
          "string.uri": 'The "instagram" field must be a valid URL',
        }),
        linkedin: Joi.string().custom(validateURL).messages({
          "string.uri": 'The "linkedin" field must be a valid URL',
        }),
      })
      .optional(),
    operatingHours: Joi.object()
      .keys({
        monday: Joi.string(),
        tuesday: Joi.string(),
        wednesday: Joi.string(),
        thursday: Joi.string(),
        friday: Joi.string(),
        saturday: Joi.string(),
        sunday: Joi.string(),
      })
      .optional(),
  }),
});

// Validate forum post creation
module.exports.validateForumPost = celebrate({
  body: Joi.object().keys({
    title: Joi.string().required().min(5).max(200).messages({
      "string.min": 'The minimum length of the "title" field is 5',
      "string.max": 'The maximum length of the "title" field is 200',
      "string.empty": 'The "title" field must be filled in',
    }),
    content: Joi.string().required().min(10).max(5000).messages({
      "string.min": 'The minimum length of the "content" field is 10',
      "string.max": 'The maximum length of the "content" field is 5000',
      "string.empty": 'The "content" field must be filled in',
    }),
    category: Joi.string().required().messages({
      "string.empty": 'The "category" field must be filled in',
    }),
    tags: Joi.array().items(Joi.string()),
  }),
});

// Validate comment creation
module.exports.validateComment = celebrate({
  body: Joi.object().keys({
    content: Joi.string().required().min(1).max(1000).messages({
      "string.min": 'The minimum length of the "content" field is 1',
      "string.max": 'The maximum length of the "content" field is 1000',
      "string.empty": 'The "content" field must be filled in',
    }),
  }),
});

// Validate search parameters
module.exports.validateSearch = celebrate({
  query: Joi.object().keys({
    q: Joi.string().min(1).messages({
      "string.min": "The minimum length of the search query is 1",
    }),
    category: Joi.string(),
    location: Joi.string(),
    country: Joi.string(),
    city: Joi.string(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10),
    sortBy: Joi.string().valid("createdAt", "businessName", "category").default("createdAt"),
    sortOrder: Joi.string().valid("asc", "desc").default("desc"),
  }),
});

// Validate API key creation
module.exports.validateApiKey = celebrate({
  body: Joi.object().keys({
    name: Joi.string().required().min(2).max(50).messages({
      "string.min": 'The minimum length of the "name" field is 2',
      "string.max": 'The maximum length of the "name" field is 50',
      "string.empty": 'The "name" field must be filled in',
    }),
    permissions: Joi.array()
      .items(Joi.string().valid("read", "write", "admin"))
      .default(["read"]),
  }),
});

// Validate payment data
module.exports.validatePayment = celebrate({
  body: Joi.object().keys({
    amount: Joi.number().positive().required().messages({
      "number.positive": 'The "amount" field must be a positive number',
      "any.required": 'The "amount" field is required',
    }),
    currency: Joi.string().required().valid("USD", "EUR", "GBP").default("USD").messages({
      "any.only": 'The "currency" field must be one of: USD, EUR, GBP',
      "any.required": 'The "currency" field is required',
    }),
    tier: Joi.string().required().valid("basic", "premium").messages({
      "any.only": 'The "tier" field must be one of: basic, premium',
      "any.required": 'The "tier" field is required',
    }),
  }),
});

