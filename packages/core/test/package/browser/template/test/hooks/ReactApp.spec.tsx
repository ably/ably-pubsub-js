import { expect, test } from '@playwright/experimental-ct-react';

import { App } from '../../src/ReactApp';

test.describe('NPM package', () => {
  for (const scenario of [{ name: 'react export' }]) {
    test.describe(scenario.name, () => {
      /** @nospec */
      test('can be imported and provides access to Ably functionality', async ({ mount, page }) => {
        page.on('console', (message) => {
          if (['error', 'warning'].includes(message.type())) {
            console.log(`Console ${message.type()}:`, message);
          }
        });

        page.on('pageerror', (err) => {
          console.log('Uncaught exception:', err);
        });

        const pageResultPromise = new Promise<void>((resolve, reject) => {
          page.exposeFunction('onResult', (error: Error | null) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });

        const component = await mount(<App />);
        await expect(pageResultPromise).resolves.not.toThrow();
        await expect(component).toContainText('Ably NPM package test (react export)');
      });
    });
  }
});
