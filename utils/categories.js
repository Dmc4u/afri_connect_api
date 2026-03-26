/**
 * Single source of truth for all categories across the application
 * Used by: models, routes (Joi validation), controllers, and frontend
 */

// Business categories for general business listings
const BUSINESS_CATEGORIES = [
  "Technology",
  "Creative",
  "Professional Services",
  "Retail",
  "Food & Beverage",
  "Healthcare",
  "Education",
  "Finance",
  "Real Estate",
  "Transportation",
  "Entertainment",
  "Nollywood",
  "Construction",
  "Agriculture",
  "Manufacturing",
  "Marketing",
  "Fashion",
  "Consulting",
  "Logistics",
  "Podcasts & Radio",
  "Sports & Fitness",
  "Non-profit & NGOs",
  "Other",
];

// Talent-specific categories
const TALENT_CATEGORIES = [
  "Talent", // General talent
  "Music",
  "Comedy",
  "Instrumentalist",
  "Artist",
  "Dancer",
  "Singer",
  "Rapper",
  "DJ",
  "Producer",
  "Web Developer",
  "Mobile Developer",
  "UI/UX Design",
  "Graphic Design",
  "Digital Marketing",
  "IT Support",
  "Cybersecurity",
  "Content Writing",
  "Photography",
  "Videography",
  "Afrobeats & Music",
  "Content Creators",
  "Actor/Actress",
  "Voice Over Artist",
  "Other Talent",
];

// All categories combined (for enums and validation)
const ALL_CATEGORIES = [...BUSINESS_CATEGORIES, ...TALENT_CATEGORIES];

/**
 * Check if a category is a talent category
 * @param {string} category - Category to check
 * @returns {boolean} - True if talent category
 */
function isTalentCategory(category) {
  if (!category) return false;
  return TALENT_CATEGORIES.includes(category);
}

module.exports = {
  BUSINESS_CATEGORIES,
  TALENT_CATEGORIES,
  ALL_CATEGORIES,
  isTalentCategory,
};
