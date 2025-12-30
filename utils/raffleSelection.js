const crypto = require('crypto');

/**
 * Transparent Raffle Selection System
 *
 * This system ensures:
 * 1. Fairness - Every contestant has equal chance
 * 2. Transparency - All random numbers and seed are publicly visible
 * 3. Verifiability - Anyone can verify the selection using the seed
 * 4. Auditability - Complete audit trail of selection process
 */

/**
 * Generate a cryptographically secure random seed
 * This seed is used to generate all random numbers for the raffle
 */
function generateRaffleSeed() {
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `${timestamp}-${randomBytes}`;
}

/**
 * Generate a deterministic random number based on seed and index
 * This allows anyone to verify the raffle results
 */
function generateDeterministicRandom(seed, index) {
  const hash = crypto.createHash('sha256');
  hash.update(`${seed}-${index}`);
  const hexHash = hash.digest('hex');
  // Convert first 8 hex chars to a number between 0 and 1
  return parseInt(hexHash.substring(0, 8), 16) / 0xffffffff;
}

/**
 * Perform transparent raffle selection
 *
 * @param {Array} contestants - Array of contestant objects with _id
 * @param {Number} maxContestants - Number of contestants to select
 * @param {String} customSeed - Optional custom seed (for verification/testing)
 * @returns {Object} - Raffle results with selected, waitlist, and audit info
 */
function performRaffle(contestants, maxContestants = 5, customSeed = null) {
  if (!contestants || contestants.length === 0) {
    throw new Error('No contestants provided for raffle');
  }

  if (maxContestants < 1) {
    throw new Error('maxContestants must be at least 1');
  }

  // Generate or use provided seed
  const raffleSeed = customSeed || generateRaffleSeed();
  const raffleTimestamp = new Date();

  // Assign random number to each contestant
  const contestantsWithRandom = contestants.map((contestant, index) => ({
    contestant: contestant._id || contestant,
    originalIndex: index,
    randomNumber: generateDeterministicRandom(raffleSeed, index),
    userData: contestant // Keep original data for reference
  }));

  // Sort by random number (ascending)
  const sorted = contestantsWithRandom.sort((a, b) => a.randomNumber - b.randomNumber);

  // Select top N contestants
  const selected = sorted.slice(0, maxContestants).map((item, index) => ({
    contestant: item.contestant,
    position: index + 1,
    randomNumber: item.randomNumber,
    selectedAt: raffleTimestamp,
    userData: item.userData
  }));

  // Remaining contestants go to waitlist
  const waitlist = sorted.slice(maxContestants).map((item, index) => ({
    contestant: item.contestant,
    position: index + 1,
    randomNumber: item.randomNumber,
    userData: item.userData
  }));

  // Create audit trail
  const auditTrail = {
    totalApplicants: contestants.length,
    selectedCount: selected.length,
    waitlistCount: waitlist.length,
    raffleSeed: raffleSeed,
    raffleTimestamp: raffleTimestamp,
    algorithm: 'SHA-256 Deterministic Random',
    verification: {
      instructions: 'To verify this raffle, use the raffleSeed with SHA-256 hashing on each contestant index',
      seedUsed: raffleSeed,
      expectedSelectedIds: selected.map(s => s.contestant.toString())
    }
  };

  return {
    selected,
    waitlist,
    raffleSeed,
    raffleTimestamp,
    auditTrail
  };
}

/**
 * Verify raffle results
 * Allows anyone to independently verify that the raffle was conducted fairly
 *
 * @param {Array} contestants - Original contestants array
 * @param {String} raffleSeed - Seed used in the raffle
 * @param {Array} expectedSelected - Expected selected contestant IDs
 * @param {Number} maxContestants - Number of contestants that should be selected
 * @returns {Boolean} - Whether the raffle is valid
 */
function verifyRaffle(contestants, raffleSeed, expectedSelected, maxContestants) {
  try {
    const results = performRaffle(contestants, maxContestants, raffleSeed);
    const selectedIds = results.selected.map(s => s.contestant.toString());
    const expectedIds = expectedSelected.map(id => id.toString());

    console.log('Verification Debug:');
    console.log('Expected:', expectedIds);
    console.log('Actual:', selectedIds);
    console.log('Total contestants:', contestants.length);

    // Check if selected contestants match
    if (selectedIds.length !== expectedIds.length) {
      console.log('Length mismatch:', selectedIds.length, 'vs', expectedIds.length);
      return false;
    }

    // Compare in order (position matters)
    for (let i = 0; i < selectedIds.length; i++) {
      if (selectedIds[i] !== expectedIds[i]) {
        console.log(`Position ${i} mismatch:`, selectedIds[i], 'vs', expectedIds[i]);
        return false;
      }
    }

    console.log('Verification successful!');
    return true;
  } catch (error) {
    console.error('Verification error:', error);
    return false;
  }
}

/**
 * Generate public raffle report
 * Creates a transparent, human-readable report of the raffle
 */
function generatePublicReport(raffleResults, showcaseTitle) {
  const { selected, waitlist, auditTrail } = raffleResults;

  const report = {
    event: showcaseTitle,
    raffleDate: auditTrail.raffleTimestamp,
    statistics: {
      totalApplicants: auditTrail.totalApplicants,
      selected: auditTrail.selectedCount,
      waitlisted: auditTrail.waitlistCount
    },
    selectedContestants: selected.map(s => ({
      position: s.position,
      contestantId: s.contestant.toString(),
      randomNumber: s.randomNumber.toFixed(8)
    })),
    waitlist: waitlist.slice(0, 10).map(w => ({ // Show top 10 waitlist
      position: w.position,
      contestantId: w.contestant.toString(),
      randomNumber: w.randomNumber.toFixed(8)
    })),
    transparency: {
      raffleSeed: auditTrail.raffleSeed,
      algorithm: auditTrail.algorithm,
      verificationNote: 'This raffle used cryptographically secure random number generation. Anyone can verify the results using the provided seed.',
      howToVerify: [
        '1. Use the raffle seed provided above',
        '2. Apply SHA-256 hash to "seed-contestantIndex" for each contestant',
        '3. Sort contestants by their random numbers (ascending)',
        '4. Top N contestants are selected'
      ]
    },
    generatedAt: new Date()
  };

  return report;
}

module.exports = {
  generateRaffleSeed,
  performRaffle,
  verifyRaffle,
  generatePublicReport,
  generateDeterministicRandom
};
