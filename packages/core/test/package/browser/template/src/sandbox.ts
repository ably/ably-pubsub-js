import testAppSetup from '../../../../common/ably-common/test-resources/test-app-setup.json';

export async function createSandboxAblyAPIKey(withOptions?: object) {
  const postData = {
    ...testAppSetup.post_apps,
    ...(withOptions ?? {}),
  };
  const response = await fetch('https://sandbox.realtime.ably-nonprod.net/apps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(postData),
  });

  if (!response.ok) {
    throw new Error(`Response not OK (${response.status})`);
  }

  const testApp = await response.json();
  return testApp.keys[0].keyStr;
}
