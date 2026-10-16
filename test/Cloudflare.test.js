const { Miniflare } = require('miniflare');
const { build } = require('esbuild');
const { builtinModules } = require('module');
const { once } = require('events');
const WebSocket = require('ws');
const MockGuacdServer = require('./helpers/MockGuacdServer');
const Crypt = require('../lib/Crypt');
const Parser = require('../lib/vendor/GuacamoleParser');

const key = 'MySuperSecretKeyForParamsToken12';
const crypt = new Crypt('AES-256-CBC', key);

// Queue actual wire instructions so assertions do not depend on event timing.
function instructions(socket) {
    const parser = new Parser();
    const pending = [];
    const received = [];
    parser.oninstruction = (opcode, params) => {
        const index = pending.findIndex(waiter => waiter.opcode === opcode);
        if (index >= 0) pending.splice(index, 1)[0].resolve(params);
        else received.push({ opcode, params });
    };
    socket.on('message', data => parser.receive(data.toString()));
    return opcode => {
        const index = received.findIndex(instruction => instruction.opcode === opcode);
        if (index >= 0) return Promise.resolve(received.splice(index, 1)[0].params);
        return new Promise(resolve => pending.push({ opcode, resolve }));
    };
}

jest.setTimeout(15000);
describe('Cloudflare Durable Object adapter', () => {
    let mf, guacd, url;
    const sockets = [];
    beforeAll(async () => {
        guacd = new MockGuacdServer();
        // Ask the OS for a free port instead of sharing the upstream default.
        guacd.port = 0;
        await guacd.start();
        const bundle = await build({
            entryPoints: [require.resolve('./cloudflare/worker.mjs')],
            bundle: true, write: false, format: 'esm', platform: 'node',
            external: ['cloudflare:*', ...builtinModules, ...builtinModules.map(name => `node:${name}`)],
            banner: { js: "import { createRequire } from 'node:module'; const require = createRequire('/');" },
        });
        mf = new Miniflare({
            name: 'test', modules: true, script: bundle.outputFiles[0].text,
            compatibilityDate: '2026-07-30', compatibilityFlags: ['nodejs_compat'],
            durableObjects: { SESSIONS: { className: 'TestSession', useSQLite: true } },
            bindings: { GUACD_PORT: guacd.server.address().port, KEY: key },
        });
        url = (await mf.ready).toString().replace('http:', 'ws:');
    });
    afterEach(async () => {
        await Promise.all(sockets.splice(0).map(socket => {
            if (socket.readyState === WebSocket.CLOSED) return;
            const closed = once(socket, 'close');
            socket.close();
            return closed;
        }));
    });
    afterAll(async () => {
        if (mf) await mf.dispose();
        if (guacd) await guacd.stop();
    });

    function connect(connection = { type: 'vnc', settings: { hostname: 'desktop' } }, path = 'session') {
        const token = typeof connection === 'string' ? connection : crypt.encrypt({ connection });
        const socket = new WebSocket(`${url}${path}?token=${encodeURIComponent(token)}`, 'guacamole');
        sockets.push(socket);
        return { socket, next: instructions(socket) };
    }

    test('requires a WebSocket upgrade', async () => {
        const response = await mf.dispatchFetch('http://test/session');
        expect(response.status).toBe(426);
    });

    test('negotiates guacamole, completes handshake, and forwards text and binary input', async () => {
        const { socket, next } = connect();
        const [session] = await next('');
        expect(socket.protocol).toBe('guacamole');
        expect(await next('size')).toEqual(['0', '1024', '768']);
        socket.send('4.sync,3.123;');
        expect(await next('sync')).toHaveLength(1);
        socket.send(Buffer.from('4.sync,3.456;'));
        // An ack is produced by the existing mock only after input crosses TCP.
        socket.send('4.file,1.0,10.text/plain,4.test;');
        expect(await next('ack')).toEqual(['0', 'OK', 'SUCCESS']);
        expect(guacd.getClientConnections(session)[0].receivedInstructions).toEqual(expect.arrayContaining([
            { opcode: 'sync', params: ['123'] }, { opcode: 'sync', params: ['456'] },
        ]));
    });

    test('uses encrypted dynamic guacd routing and routes joins to that host', async () => {
        const routed = new MockGuacdServer();
        routed.port = 0;
        await routed.start();
        try {
            const first = connect({ type: 'vnc', guacdHost: '127.0.0.1', guacdPort: routed.server.address().port,
                settings: { hostname: 'desktop' } }, 'shared');
            const [session] = await first.next('');
            const joined = connect({ join: session }, 'shared');
            expect(await joined.next('')).toEqual([session]);
            expect(routed.getClientConnections(session)).toHaveLength(2);
            expect(guacd.getClientConnections(session)).toHaveLength(0);
        } finally {
            await routed.stop();
        }
    });

    test('rejects invalid tokens without opening a TCP connection', async () => {
        const accepted = jest.fn();
        guacd.server.on('connection', accepted);
        const { socket, next } = connect('invalid');
        const closed = once(socket, 'close');
        expect(await next('error')).toEqual(['Token validation failed', 'INVALID_TOKEN']);
        expect((await closed)[0]).toBe(1011);
        expect(accepted).not.toHaveBeenCalled();
        guacd.server.off('connection', accepted);
    });

    test('closes TCP when the browser disconnects', async () => {
        const { socket, next } = connect();
        const [session] = await next('');
        const closed = once(guacd.getClientConnections(session)[0].socket, 'close');
        socket.close();
        await closed;
        expect(guacd.getClientConnections(session)).toHaveLength(0);
    });

    test('closes the browser when guacd disconnects', async () => {
        const { socket, next } = connect();
        const [session] = await next('');
        const closed = once(socket, 'close');
        guacd.getClientConnections(session)[0].destroy();
        expect((await closed)[0]).toBe(1000);
    });
});
