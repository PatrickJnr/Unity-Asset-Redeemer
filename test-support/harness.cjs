const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function installClock(window) {
    let now = Date.parse('2026-10-21T12:00:00Z');
    let nextId = 0;
    const timers = new Map();
    window.Date.now = () => now;
    window.setTimeout = (callback, delay = 0, ...args) => {
        const id = ++nextId;
        timers.set(id, { at: now + Math.max(0, Number(delay) || 0), callback: () => callback(...args) });
        return id;
    };
    window.clearTimeout = id => timers.delete(id);
    const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
    return {
        get now() { return now; },
        async advance(ms) {
            const target = now + ms;
            await flush();
            let steps = 0;
            while (true) {
                const entry = [...timers].filter(([, timer]) => timer.at <= target)
                    .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
                if (!entry) break;
                if (++steps > 10000) throw new Error('Test timer loop did not settle');
                const [id, timer] = entry;
                now = timer.at;
                timers.delete(id);
                timer.callback();
                await flush();
            }
            now = target;
            await flush();
        }
    };
}

function load(html = '', { url = 'https://assetstore.unity.com/?page=1', setup = () => {}, clock = true } = {}) {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url, runScripts: 'outside-only' });
    const { window } = dom;
    const timer = clock ? installClock(window) : null;
    window.__UNITY_ASSET_REDEEMER_TEST__ = true;
    window.confirm = () => true;
    window.console.log = () => {};
    window.console.error = () => {};
    window.fetch = async () => { throw new Error('Unexpected unmocked fetch in offline test'); };
    setup(window);
    window.eval(fs.readFileSync(path.join(__dirname, '..', 'Unity_Auto_Redeemer.user.js'), 'utf8'));
    return {
        dom, clock: timer,
        api: window.__UNITY_ASSET_REDEEMER_TEST_API__,
        ui: window.document.getElementById('unity-auto-redeemer-v2')?.shadowRoot
    };
}

module.exports = { load };
