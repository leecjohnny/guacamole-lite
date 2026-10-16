import { DurableObject } from 'cloudflare:workers';
import { GuacamoleAdapter } from '../../cloudflare.mjs';

export class TestSession extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.server = new GuacamoleAdapter(
            { host: '127.0.0.1', port: env.GUACD_PORT },
            { crypt: { key: env.KEY }, log: { level: 0 } },
        );
    }
    fetch(request) { return this.server.fetch(request); }
}

export default {
    fetch(request, env) {
        return env.SESSIONS.getByName(new URL(request.url).pathname).fetch(request);
    },
};
