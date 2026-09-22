let port;

self.addEventListener('push', (event) => {
  const res = event.data.json();
  port.postMessage({ payload: res });
});

self.addEventListener('message', (event) => {
  if (event.data.type === 'INIT_PORT') {
    port = event.ports[0];
  }
});
