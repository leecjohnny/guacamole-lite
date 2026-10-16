const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { once } = require('node:events');
const WebSocket = require('ws');
const Crypt = require('../../../lib/Crypt');
const Parser = require('../../../lib/vendor/GuacamoleParser');

// Explicit live test: node run.cjs <Worker URL> <private secrets JSON file>
async function main() {
    const [base, secretsFile] = process.argv.slice(2);
    assert(base && secretsFile, 'Usage: node run.cjs <Worker URL> <secrets JSON file>');
    const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
    const headers = { Authorization: `Bearer ${secrets.TEST_SECRET}` };
    const post = async path => {
        const response = await fetch(new URL(path, base), { method: 'POST', headers, signal: path === '/stop' ? AbortSignal.timeout(15000) : controller.signal });
        const text = await response.text();
        assert.equal(response.status, 200, text);
        return text;
    };
    let socket;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort(new Error('Live integration test timed out'));
        if (socket) socket.terminate();
    }, 600000);
    try {
        assert.equal((await fetch(base)).status, 401);
        console.log('Installing and starting guacd and TigerVNC in managed Debian...');
        const setup = await post('/setup');
        console.log(setup.split('\n').filter(line => /Guacamole proxy|TigerVNC|Xvnc version/i.test(line)).join('\n'));
        const token = new Crypt('AES-256-CBC', secrets.GUACAMOLE_KEY).encrypt({
            connection: { type: 'vnc', settings: { hostname: '127.0.0.1', port: '5901' } },
        });
        const url = new URL('/desktop', base);
        url.protocol = 'wss:';
        url.searchParams.set('token', token);
        socket = new WebSocket(url, 'guacamole', { headers });
        const parser = new Parser();
        const received = [];
        const waiters = [];
        const next = (opcode, matches = () => true) => {
            const index = received.findIndex(item => item.opcode === opcode && matches(item.params));
            if (index >= 0) return Promise.resolve(received.splice(index, 1)[0].params);
            return new Promise((resolve, reject) => waiters.push({ opcode, matches, resolve, reject }));
        };
        parser.oninstruction = (opcode, params) => {
            if (opcode === 'error') {
                for (const waiter of waiters.splice(0)) waiter.reject(new Error(params.join(': ')));
            }
            if (opcode === 'sync') socket.send(Parser.toInstruction(['sync', ...params]));
            if (opcode === 'blob') socket.send(Parser.toInstruction(['ack', params[0], 'OK', '0']));
            const index = waiters.findIndex(item => item.opcode === opcode && item.matches(params));
            if (index >= 0) waiters.splice(index, 1)[0].resolve(params);
            else received.push({ opcode, params });
        };
        socket.on('message', data => parser.receive(data.toString()));
        socket.on('close', () => {
            for (const waiter of waiters.splice(0)) waiter.reject(new Error('Desktop socket closed'));
        });
        await once(socket, 'open');
        assert.equal(socket.protocol, 'guacamole');
        const [id] = await next('');
        assert(id.startsWith('$'));
        assert.deepEqual(await next('size', params => params[0] === '0'), ['0', '800', '600']);
        const firstImage = await next('blob');
        assert(Buffer.from(firstImage[1], 'base64').length > 0);
        await next('sync');
        received.length = 0;
        const painted = next('cfill', params => params[1] === '0' && params.slice(2, 5).join(',') === '32,96,160');
        await post('/paint');
        await painted;
        socket.send(Parser.toInstruction(['mouse', '100', '100', '0']));
        socket.send(Buffer.from(Parser.toInstruction(['key', '65', '1'])));
        socket.send(Parser.toInstruction(['key', '65', '0']));
        await next('sync');
        const closed = once(socket, 'close');
        socket.close(1000);
        assert.equal((await closed)[0], 1000);
        console.log('PASS: real VNC handshake, 800x600 display, background color update, text/binary input and close');
    } finally {
        clearTimeout(timeout);
        if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
        await post('/stop');
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
