import { DurableObject } from 'cloudflare:workers';
import { Duplex } from 'node:stream';
import { GuacamoleAdapter } from '../../../cloudflare.mjs';

export class Desktop extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.server = new GuacamoleAdapter(
            { host: 'desktop', port: 4822 },
            { crypt: { key: env.GUACAMOLE_KEY }, log: { level: 'ERRORS' } },
            undefined,
            port => {
                const socket = ctx.container.getTcpPort(port).connect(`127.0.0.1:${port}`);
                const stream = Duplex.fromWeb(socket);
                socket.opened.then(() => stream.emit('connect'), error => stream.destroy(error));
                return stream;
            },
        );
    }

    async command(argv) {
        const process = await this.ctx.container.exec(argv, { stderr: 'combined' });
        const result = await process.output();
        if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stdout));
        return new TextDecoder().decode(result.stdout);
    }

    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/setup' && request.method === 'POST') {
            this.ctx.container.start({
                image: 'cloudflare/debian-trixie', instance: 'standard-1', entrypoint: ['sleep', 'infinity'], enableInternet: true,
            });
            await this.ctx.container.setInactivityTimeout(15 * 60 * 1000);
            await this.command(['sh', '-ec', `
                apt-get update -qq
                DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
                    build-essential pkg-config uuid-dev libcairo2-dev libjpeg62-turbo-dev libpng-dev \
                    libvncserver-dev libssl-dev libtool-bin curl ca-certificates \
                    tigervnc-standalone-server x11-xserver-utils
                mkdir -p /opt/guacamole
                cd /opt/guacamole
                curl -fsSLO https://downloads.apache.org/guacamole/1.6.0/source/guacamole-server-1.6.0.tar.gz
                curl -fsSLO https://downloads.apache.org/guacamole/1.6.0/source/guacamole-server-1.6.0.tar.gz.sha256
                sha256sum -c guacamole-server-1.6.0.tar.gz.sha256
                tar -xzf guacamole-server-1.6.0.tar.gz
                cd guacamole-server-1.6.0
                ./configure --disable-guacenc --disable-guaclog
                make -j2
                make install
                ldconfig
            `]);
            await this.ctx.container.exec(
                ['Xtigervnc', ':1', '-geometry', '800x600', '-depth', '24', '-SecurityTypes', 'None', '-localhost', 'yes'],
                { stdout: 'ignore', stderr: 'ignore' },
            );
            await this.ctx.container.exec(['guacd', '-f', '-b', '0.0.0.0'], { stdout: 'ignore', stderr: 'ignore' });
            const output = await this.command(['sh', '-c', 'guacd -v; Xtigervnc -version 2>&1']);
            return new Response(output);
        }
        if (path === '/paint' && request.method === 'POST') {
            await this.command(['xsetroot', '-display', ':1', '-solid', '#2060a0']);
            return new Response('Painted');
        }
        if (path === '/stop' && request.method === 'POST') {
            this.server.close();
            await this.ctx.container.destroy();
            return new Response('Stopped');
        }
        return this.server.fetch(request);
    }
}

export default {
    async fetch(request, env, ctx) {
        if (request.headers.get('Authorization') !== `Bearer ${env.TEST_SECRET}`) {
            return new Response('Unauthorized', { status: 401 });
        }
        try {
            return await ctx.exports.Desktop.getByName('test').fetch(request);
        } catch (error) {
            return new Response(error.stack, { status: 500 });
        }
    },
};
