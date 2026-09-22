const { EVENT_RUN_END, EVENT_TEST_FAIL, EVENT_TEST_PASS, EVENT_SUITE_BEGIN, EVENT_SUITE_END } = Mocha.Runner.constants;

const { ok: passSymbol, err: failSymbol } = Mocha.reporters.Base.symbols;

class InMemoryMochaJUnitReporter extends MochaJUnitReporter {
  onGotReport;

  // Bit of a hack, we override this internal method of MochaJUnitReporter to
  // get access to the test report without trying to write it to disk (which we
  // can’t since we’re in browser)
  writeXmlToDisk(xml, filePath) {
    this.onGotReport(xml);
  }
}

class CustomEventReporter extends Mocha.reporters.HTML {
  jUnitReporter;
  jUnitReport;
  testResultStats;
  privateApiUsageData;

  constructor(runner) {
    super(runner);
    this.junitReporter = new InMemoryMochaJUnitReporter(runner);
    this.junitReporter.onGotReport = (report) => {
      this.jUnitReport = report;
      this.gotResults();
    };
    this.indents = 0;
    this.failedTests = [];

    runner
      .on(EVENT_SUITE_BEGIN, (suite) => {
        this.increaseIndent();
        this.logToNodeConsole(suite.title);
        this.increaseIndent();
      })
      .on(EVENT_SUITE_END, () => {
        this.decreaseIndent();
        this.decreaseIndent();
      })
      .on(EVENT_TEST_PASS, (test) => {
        this.logToNodeConsole(`${passSymbol}: ${test.title}`);
      })
      .on(EVENT_TEST_FAIL, (test, err) => {
        this.logToNodeConsole(`${failSymbol}: ${test.title} - error: ${err.message}`);
        this.failedTests.push(test.title);
      })
      .once(EVENT_RUN_END, () => {
        this.indents = 0;
        if (this.failedTests.length > 0) {
          this.logToNodeConsole('\nfailed tests: \n' + this.failedTests.map((x) => ' - ' + x).join('\n') + '\n');
        }
        this.testResultStats = runner.stats;
        this.gotResults();
      });

    window.addEventListener('privateApiUsageData', ({ detail }) => {
      this.privateApiUsageData = detail;
      this.gotResults();
    });
  }

  logToNodeConsole(text) {
    window.dispatchEvent(new CustomEvent('testLog', { detail: this.indent() + text }));
  }

  indent() {
    return Array(this.indents).join('  ');
  }

  increaseIndent() {
    this.indents++;
  }

  decreaseIndent() {
    this.indents--;
  }

  gotResults() {
    if (!this.testResultStats || !this.jUnitReport || !this.privateApiUsageData) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent('testResult', {
        detail: {
          pass: this.testResultStats && this.testResultStats.failures === 0,
          passes: this.testResultStats.passes,
          total: this.testResultStats.passes + this.testResultStats.failures,
          jUnitReport: this.jUnitReport,
          privateApiUsageData: this.privateApiUsageData,
        },
      }),
    );
  }
}

mocha.reporter(CustomEventReporter);
mocha.setup('bdd');
