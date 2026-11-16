module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subjects often start with a proper noun or acronym (Next, SPA, RSC, ES256),
    // which the conventional preset's case rule rejects.
    'subject-case': [0],
    // Dependabot bodies carry long release-note links.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
}
