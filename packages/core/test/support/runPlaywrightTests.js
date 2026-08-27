const playwright = require('playwright');
const path = require('path');
const MochaServer = require('../web_server');
const fs = require('fs');
const outputDirectoryPaths = require('./output_directory_paths');

const port = process.env.PORT || 3000;
const host = 'localhost';
const playwrightBrowsers = ['chromium', 'firefox', 'webkit'];
const mochaServer = new MochaServer(/* playwrightTest: */ true);

const runTests = async (browserType) => {
  await mochaServer.listen();
  const browser = await browserType.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://${host}:${port}`);

  console.log(`\nrunning tests in ${browserType.name()}`);

  await new Promise((resolve, reject) => {
    // Expose a function inside the playwright browser to log to the NodeJS process stdout
    page.exposeFunction('onTestLog', ({ detail }) => {
      console.log(detail);
    });

    page.on('console', (msg) => {
      console.log(msg.text());
    });

    // Expose a function inside the playwright browser to exit with the right status code when tests pass/fail
    page.exposeFunction('onTestResult', ({ detail }) => {
      console.log(`${browserType.name()} tests complete: ${detail.passes}/${detail.total} passed`);

      try {
        if (!fs.existsSync(outputDirectoryPaths.jUnit)) {
          fs.mkdirSync(outputDirectoryPaths.jUnit);
        }
        const filename = `playwright-${browserType.name()}.junit`;
        fs.writeFileSync(path.join(outputDirectoryPaths.jUnit, filename), detail.jUnitReport, { encoding: 'utf-8' });
      } catch (err) {
        console.log('Failed to write JUnit report, exiting with code 2: ', err);
        process.exit(2);
      }

      try {
        if (!fs.existsSync(outputDirectoryPaths.privateApiUsage)) {
          fs.mkdirSync(outputDirectoryPaths.privateApiUsage);
        }
        const filename = `playwright-${browserType.name()}.json`;
        fs.writeFileSync(
          path.join(outputDirectoryPaths.privateApiUsage, filename),
          JSON.stringify(detail.privateApiUsageData),
          { encoding: 'utf-8' },
        );
      } catch (err) {
        console.log('Failed to write private API usage data, exiting with code 2: ', err);
        process.exit(2);
      }

      if (detail.pass) {
        browser.close();
        resolve();
      } else {
        reject(new Error(`${browserType.name()} tests failed, exiting with code 1`));
      }
    });

    // Use page.evaluate to add these functions as event listeners to the 'testLog' and 'testResult' Custom Events.
    // These events are fired by the custom mocha reporter in playwrightSetup.js
    const grep = process.env.MOCHA_GREP;
    page.evaluate((grep) => {
      window.addEventListener('testLog', ({ type, detail }) => {
        onTestLog({ type, detail });
      });
      window.addEventListener('testResult', ({ type, detail }) => {
        onTestResult({ type, detail });
      });
      // Set grep pattern in the browser context
      // allows easy filtering of tests.
      if (grep) {
        window.mocha.grep(new RegExp(grep));
      }
    }, grep);
  });
};

(async () => {
  let caughtError;

  try {
    const browserEnv = process.env.PLAYWRIGHT_BROWSER;

    if (!playwrightBrowsers.includes(browserEnv)) {
      throw new Error(
        `PLAYWRIGHT_BROWSER environment variable must be one of: ${playwrightBrowsers.join(
          ', ',
        )}. Currently: ${browserEnv}`,
      );
    }

    await runTests(playwright[browserEnv]);
  } catch (error) {
    // save error for now, we must ensure we end mocha web server first.
    // if we end current process too early, mocha web server will be left running,
    // causing problems when launching tests the second time.
    caughtError = error;
  }

  mochaServer.close();

  // now when mocha web server is terminated, if there was an error, we can log it and exit with a failure code
  if (caughtError) {
    console.log(caughtError.message);
    process.exit(1);
  }
})();
