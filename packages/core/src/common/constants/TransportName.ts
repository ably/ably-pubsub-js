export namespace TransportNames {
  export const WebSocket = 'web_socket' as const;
  export const Comet = 'comet' as const;
  export const XhrPolling = 'xhr_polling' as const;
}

type TransportName = typeof TransportNames.WebSocket | typeof TransportNames.Comet | typeof TransportNames.XhrPolling;

export default TransportName;
