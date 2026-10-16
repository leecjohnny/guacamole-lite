import { DurableObject } from 'cloudflare:workers';
import { GuacamoleAdapter } from '../../cloudflare.mjs';

export class GuacamoleSession extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.server = new GuacamoleAdapter(
            { host: env.GUACD_HOST, port: Number(env.GUACD_PORT || 4822) },
            { crypt: { key: env.GUACAMOLE_KEY }, log: { level: 'ERRORS' } },
        );
    }

    fetch(request) { return this.server.fetch(request); }
}

export default {
    fetch(request, env, ctx) {
        // Authenticate the caller in your application before routing this request.
        const session = new URL(request.url).pathname;
        return ctx.exports.GuacamoleSession.getByName(session).fetch(request);
    },
};
