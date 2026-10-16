import { bindings, defineConfig, exports } from 'cf/config';

export default defineConfig({
    worker: {
        name: 'guacamole-lite',
        entrypoint: 'worker.mjs',
        compatibilityDate: '2026-10-16',
        compatibilityFlags: ['nodejs_compat'],
        env: {
            GUACD_HOST: bindings.text('guacd.example.com'),
            GUACD_PORT: bindings.text('4822'),
            GUACAMOLE_KEY: bindings.secret(),
        },
        exports: { GuacamoleSession: exports.durableObject({ storage: 'sqlite' }) },
    },
});
