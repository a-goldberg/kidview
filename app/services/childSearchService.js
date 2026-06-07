const db = require('../db/database');

const CATEGORY_ICONS = {
  animals: '/icons/animals.svg',
  science: '/icons/science.svg',
  art: '/icons/art.svg',
  general: '/icons/general.svg'
};

const MOCK_RESULTS = [
  {
    title: 'Backyard Bird Watching for Beginners',
    channel: 'Curious Nest',
    categoryKey: 'animals',
    categoryLabel: 'Animals',
    duration: '8 min',
    summary: 'A calm look at common birds and how to notice their colors, calls, and habits.'
  },
  {
    title: 'Why Shadows Change During the Day',
    channel: 'Small Science Lab',
    categoryKey: 'science',
    categoryLabel: 'Science',
    duration: '6 min',
    summary: 'A simple explanation of sunlight, shadows, and careful observation.'
  },
  {
    title: 'Make a Paper City',
    channel: 'Tabletop Art Time',
    categoryKey: 'art',
    categoryLabel: 'Art',
    duration: '10 min',
    summary: 'A hands-on craft idea using paper, crayons, and a little imagination.'
  }
];

function search({ query, householdId, childProfileId }) {
  const safeQuery = query.trim();
  const results = MOCK_RESULTS.slice(0, 3).map((result) => ({
    ...result,
    iconPath: CATEGORY_ICONS[result.categoryKey] || CATEGORY_ICONS.general
  }));

  // Search logging stores the query and count only. Transcript text is not stored.
  if (safeQuery && householdId) {
    db.prepare(
      `INSERT INTO search_events (household_id, child_profile_id, query, result_count)
       VALUES (?, ?, ?, ?)`
    ).run(householdId, childProfileId || null, safeQuery, results.length);
  }

  return results;
}

module.exports = {
  search
};
