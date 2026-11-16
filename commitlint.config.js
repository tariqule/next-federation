module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subjects often start with a proper noun or acronym (Next, SPA, RSC, ES256),
    // which the conventional preset's case rule rejects.
    'subject-case': [0],
  },
}
