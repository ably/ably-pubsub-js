module.exports = {
  // mocha-junit-reporter calls this to check whether a report file already
  // exists (so it can delete it if so), so just return false since we’re not
  // going to write the report to the filesystem anyway
  existsSync: () => false,
};
