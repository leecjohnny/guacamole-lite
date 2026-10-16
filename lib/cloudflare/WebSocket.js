const EventEmitter = require('events');

// The ws surface used by ClientConnection, backed by a Workers WebSocket.
class WebSocketShim extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
        socket.binaryType = 'arraybuffer';
        this.OPEN = 1;
        this.CLOSING = 2;
        this.CLOSED = 3;
        socket.addEventListener('message', event => this.emit('message',
            typeof event.data === 'string' ? event.data : Buffer.from(event.data)));
        socket.addEventListener('close', () => this.emit('close'));
        socket.addEventListener('error', () => this.emit('close'));
    }

    get readyState() { return this.socket.readyState; }

    send(data, options, callback) {
        try {
            this.socket.send(data);
            if (callback) callback();
        } catch (error) {
            if (callback) callback(error);
            else throw error;
        }
    }

    close(code, reason) { this.socket.close(code, reason); }
}

module.exports = WebSocketShim;
