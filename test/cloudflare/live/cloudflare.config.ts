import { bindings, defineConfig, defineContainer, exports } from 'cf/config';

const desktop = defineContainer({
    name: 'guacamole-lite-adapter-test',
    schedulingPolicy: 'durable-object',
});

export default defineConfig({
    worker: {
        name: 'guacamole-lite-adapter-test',
        entrypoint: 'worker.mjs',
        compatibilityDate: '2026-10-16',
        compatibilityFlags: ['nodejs_compat'],
        observability: { enabled: true },
        env: {
            TEST_SECRET: bindings.secret(),
            GUACAMOLE_KEY: bindings.secret(),
        },
        exports: { Desktop: exports.durableObject({ storage: 'sqlite', container: desktop }) },
    },
    containers: [desktop],
});
