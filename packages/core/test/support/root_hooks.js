define(['shared_helper'], function (Helper) {
  after(function (done) {
    const helper = Helper.forHook(this);
    this.timeout(10 * 1000);
    helper.tearDownApp(function (err) {
      if (err) {
        done(err);
        return;
      }
      done();
    });
    helper.dumpPrivateApiUsage();
  });

  afterEach(function () {
    this.currentTest.helper.closeActiveClients();
  });
  afterEach(function () {
    this.currentTest.helper.logTestResults(this);
  });
  afterEach(function () {
    this.currentTest.helper.flushTestLogs();
  });
  beforeEach(function () {
    this.currentTest.helper = Helper.forTest(this);
    this.currentTest.helper.recordTestStart();
  });
  beforeEach(function () {
    this.currentTest.helper.clearTransportPreference();
  });
});
