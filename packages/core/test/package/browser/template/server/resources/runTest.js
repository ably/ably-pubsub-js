(async () => {
  try {
    await testAblyPackage();
    onResult(null);
  } catch (error) {
    console.log('Caught error', error);
    onResult(error);
  }
})();
