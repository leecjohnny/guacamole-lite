import EventEmitter from 'node:events';
import Server from './lib/Server.js';
import WebSocketShim from './lib/cloudflare/WebSocket.js';

/** Adapt the existing server to a Durable Object's fetch handler. */
export class GuacamoleAdapter extends Server {
    constructor(guacdOptions, clientOptions, callbacks, connectSocket) {
        const webSocketServer = new EventEmitter();
        webSocketServer.close = () => {};
        super({}, guacdOptions, clientOptions, callbacks, {
            webSocketServer, handleSignals: false, connect: connectSocket,
        });
    }

    async fetch(request) {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
            return new Response('WebSocket upgrade required', { status: 426 });
        }
        const [client, server] = Object.values(new WebSocketPair());
        server.accept();
        await this.newConnection(new WebSocketShim(server), request);
        const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(value => value.trim());
        return new Response(null, {
            status: 101,
            webSocket: client,
            headers: protocols?.includes('guacamole') ? { 'Sec-WebSocket-Protocol': 'guacamole' } : undefined,
        });
    }
}
