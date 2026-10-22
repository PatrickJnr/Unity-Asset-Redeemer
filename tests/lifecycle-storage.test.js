const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../test-support/harness.cjs');

const keys = {
    settings: 'unity-auto-redeemer-v2-settings', history: 'unity-auto-redeemer-v2-history',
    owned: 'unity-auto-redeemer-v2-confirmed-owned', resume: 'unity-auto-redeemer-v2-resume'
};
const card = id => `<article class="packageCard"><a href="/packages/asset-${id}">Asset ${id}</a><span class="price">Free</span></article>`;
const response = (body, status = 200, retryAfter = null) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: () => retryAfter }, json: async () => body
});
const success = id => response({ data: { addToDownload: { id } } });
function prepare(window) {
    window.document.cookie = '_csrf=test';
    window.Math.random = () => 0;
    window.HTMLElement.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{}]; };
}
function fixture(t, html, setup = () => {}, url) {
    const result = load(html, { url, setup(window) { prepare(window); setup(window); } });
    t.after(() => result.dom.window.close());
    return result;
}
function resumeFor(window, changes = {}) {
    return {
        time: window.Date.now(), url: 'https://assetstore.unity.com/?page=1',
        allPages: true, preview: false, page: 1, nextPaginationPage: 2,
        claimed: 1, failed: 0, skipped: 0, processed: ['101'],
        seenPages: [JSON.stringify({ url: '/?page=1', range: '', active: '', ids: ['101'] })],
        ...changes
    };
}

test('invalid saved delays cannot remove the minimum interval between requests', async t => {
    const sent = [];
    const { api, clock } = fixture(t, card(101) + card(102) + card(103), window => {
        window.localStorage.setItem(keys.settings, JSON.stringify({ delay: 'invalid', allPages: false }));
        window.fetch = async (url, options) => {
            sent.push(window.Date.now());
            return success(JSON.parse(options.body).variables.id);
        };
    });
    const running = api.run();
    await clock.advance(3000);
    await running;
    assert.equal(sent.length, 3);
    assert.ok(sent[1] - sent[0] >= 1500);
    assert.ok(sent[2] - sent[1] >= 1500);
});

test('malformed history is discarded while valid stored ownership is restored', async t => {
    let requests = 0;
    const { api, ui, clock } = fixture(t, card(101), window => {
        window.localStorage.setItem(keys.owned, '["101"]');
        window.sessionStorage.setItem(keys.history, '[{"id":"123"}]');
        window.fetch = async () => { requests++; return success('101'); };
    });
    ui.getElementById('tab-assets').click();
    assert.equal(ui.getElementById('history-count').textContent, '0');
    assert.equal(ui.getElementById('cache-count').textContent, '1');
    assert.match(ui.getElementById('storage-warning').textContent, /Invalid session history/);
    const running = api.run();
    await clock.advance(0);
    await running;
    assert.equal(requests, 0);
    assert.equal(api.state.skipped, 1);
});

test('storage getter failures leave the dashboard usable and display a warning', t => {
    const { ui } = fixture(t, '', window => {
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked'); } });
    });
    assert.equal(ui.getElementById('storage-warning').hidden, false);
    assert.match(ui.getElementById('storage-warning').textContent, /Could not read/);
    ui.getElementById('toggle').click();
    assert.equal(ui.getElementById('panel').hidden, false);
});

test('failed persistence is visible and does not erase a confirmed in-memory claim', async t => {
    const { api, ui, clock, dom } = fixture(t, card(101), window => {
        const set = window.Storage.prototype.setItem;
        window.Storage.prototype.setItem = function (key, value) {
            if (key === keys.owned) throw new Error('Quota exceeded');
            return set.call(this, key, value);
        };
        window.fetch = async () => success('101');
    });
    const running = api.run();
    await clock.advance(0);
    await running;
    assert.equal(api.state.successes, 1);
    assert.equal(ui.getElementById('cache-count').textContent, '1');
    assert.equal(dom.window.localStorage.getItem(keys.owned), null);
    assert.equal(ui.getElementById('storage-warning').hidden, false);
    assert.match(ui.getElementById('storage-warning').textContent, /Could not save ownership history/);
});

test('failed reset reports incomplete and successful retry clears hydrated state', async t => {
    let blocked = true;
    let requests = 0;
    const { api, ui, clock, dom } = fixture(t, card(101), window => {
        window.localStorage.setItem(keys.owned, '["101"]');
        const remove = window.Storage.prototype.removeItem;
        window.Storage.prototype.removeItem = function (key) {
            if (blocked && key === keys.owned) throw new Error('Blocked');
            return remove.call(this, key);
        };
        window.fetch = async () => { requests++; return success('101'); };
    });
    ui.getElementById('clear-cache').click();
    assert.equal(dom.window.localStorage.getItem(keys.owned), '["101"]');
    assert.equal(ui.getElementById('cache-count').textContent, '1');
    assert.match(ui.getElementById('status').textContent, /Reset incomplete/);
    blocked = false;
    ui.getElementById('clear-cache').click();
    assert.equal(dom.window.localStorage.getItem(keys.owned), null);
    assert.equal(ui.getElementById('cache-count').textContent, '0');
    const running = api.run();
    await clock.advance(0);
    await running;
    assert.equal(requests, 1);
});

for (const action of ['stop', 'reset', 'start-then-stop']) {
    test(`${action} cancels a scheduled resume without later restarting claims`, async t => {
        let requests = 0;
        const { api, ui, clock } = fixture(t, card(102) + card(103), window => {
            window.sessionStorage.setItem(keys.resume, JSON.stringify(resumeFor(window)));
            window.fetch = async () => { requests++; return new Promise(() => {}); };
        }, 'https://assetstore.unity.com/?page=2');
        assert.equal(ui.getElementById('stop').disabled, false);
        assert.equal(api.state.pendingResume, true);
        if (action === 'reset') ui.getElementById('clear-cache').click();
        else {
            if (action === 'start-then-stop') ui.getElementById('start').click();
            ui.getElementById('stop').click();
        }
        const expected = action === 'start-then-stop' ? 1 : 0;
        await clock.advance(40000);
        assert.equal(requests, expected);
        assert.equal(api.state.running, false);
        assert.equal(api.state.pendingResume, false);
    });
}

test('valid resume preserves progress and processes the new page once', async t => {
    let requests = 0;
    const { api, clock } = fixture(t, card(102), window => {
        window.sessionStorage.setItem(keys.resume, JSON.stringify(resumeFor(window)));
        window.fetch = async () => { requests++; return success('102'); };
    }, 'https://assetstore.unity.com/?page=2');
    await clock.advance(5000);
    assert.equal(requests, 1);
    assert.equal(api.state.successes, 2);
    assert.equal(api.state.page, 2);
    assert.equal(api.state.running, false);
});

test('automatic resume waits for all advertised cards before making a request', async t => {
    let requests = 0;
    const { api, clock, dom } = fixture(t, `<p data-test="results">Results 97-192 of 192</p><main>${card(102)}</main>`, window => {
        window.sessionStorage.setItem(keys.resume, JSON.stringify(resumeFor(window)));
        window.fetch = async () => { requests++; return new Promise(() => {}); };
    }, 'https://assetstore.unity.com/?page=2');
    await clock.advance(5000);
    assert.equal(requests, 0);
    assert.equal(api.state.pendingResume, true);
    dom.window.document.querySelector('main').innerHTML = Array.from({ length: 96 }, (_, index) => card(index + 102)).join('');
    await clock.advance(3000);
    assert.equal(requests, 1);
    api.stop();
    await clock.advance(0);
});

test('changing the listing while resume is pending cancels automatic processing', async t => {
    let requests = 0;
    const { api, clock, dom } = fixture(t, card(102), window => {
        window.sessionStorage.setItem(keys.resume, JSON.stringify(resumeFor(window)));
        window.fetch = async () => { requests++; return success('102'); };
    }, 'https://assetstore.unity.com/?page=2');
    dom.window.history.replaceState({}, '', '?page=2&category=audio');
    await clock.advance(10000);
    assert.equal(requests, 0);
    assert.equal(api.state.pendingResume, false);
});

test('late completion of a stopped request cannot change a newer run', async t => {
    let finishOldRequest;
    let requests = 0;
    const { api, clock, ui } = fixture(t, card(101), window => {
        window.fetch = async () => {
            if (++requests === 1) return new Promise(resolve => { finishOldRequest = resolve; });
            return success('101');
        };
    });
    const oldRun = api.run();
    await clock.advance(0);
    api.stop();
    const newRun = api.run();
    await clock.advance(0);
    await newRun;
    finishOldRequest(success('101'));
    await clock.advance(0);
    await oldRun;
    assert.equal(api.state.successes, 1);
    assert.equal(ui.getElementById('history-count').textContent, '1');
    assert.equal(api.state.running, false);
});

for (const change of [{ seenPages: ['broken'] }, { claimed: -1 }, { preview: 'false' }, { processed: null }]) {
    test(`malformed resume ${Object.keys(change)[0]} is rejected without wedging Start`, async t => {
        let requests = 0;
        const { api, clock, ui } = fixture(t, card(102), window => {
            window.sessionStorage.setItem(keys.resume, JSON.stringify(resumeFor(window, change)));
            window.fetch = async () => { requests++; return success('102'); };
        }, 'https://assetstore.unity.com/?page=2');
        await clock.advance(20000);
        assert.equal(requests, 0);
        assert.equal(api.state.running, false);
        assert.equal(ui.getElementById('start').disabled, false);
        const running = api.run();
        await clock.advance(0);
        await running;
        assert.equal(requests, 1);
    });
}

test('a navigation resume cannot cross into different listing filters', async t => {
    let requests = 0;
    const { api, clock } = fixture(t, card(102), window => {
        window.sessionStorage.setItem(keys.resume, JSON.stringify(resumeFor(window)));
        window.fetch = async () => { requests++; return success('102'); };
    }, 'https://assetstore.unity.com/?page=2&category=audio');
    await clock.advance(20000);
    assert.equal(api.state.pendingResume, false);
    assert.equal(requests, 0);
});

test('automatic resume rejects an unexpected destination page', async t => {
    let requests = 0;
    const { api, clock } = fixture(t, card(102), window => {
        window.sessionStorage.setItem(keys.resume, JSON.stringify(resumeFor(window)));
        window.fetch = async () => { requests++; return success('102'); };
    }, 'https://assetstore.unity.com/?page=7');
    await clock.advance(20000);
    assert.equal(api.state.pendingResume, false);
    assert.equal(requests, 0);
});

test('Stop during navigation cannot overwrite a later completed run', async t => {
    const { api, clock, ui } = fixture(t, `${card(101)}<nav aria-label="Pagination"><button aria-label="Next page">Next</button></nav>`);
    ui.getElementById('preview').checked = true;
    const oldRun = api.run();
    await clock.advance(1300);
    api.stop();
    ui.getElementById('pages').checked = false;
    const newRun = api.run();
    await clock.advance(1000);
    await Promise.all([oldRun, newRun]);
    assert.match(ui.getElementById('status').textContent, /^Complete:/);
    assert.equal(api.state.failures, 0);
    assert.equal(api.state.running, false);
});

test('a two-page run preserves counts and skips duplicate products', async t => {
    const requested = [];
    const { api, clock, dom } = fixture(t, `<main>${card(101)}${card(102)}</main><nav aria-label="Pagination"><button aria-label="Next page">Next</button></nav>`, window => {
        window.fetch = async (url, options) => {
            const id = JSON.parse(options.body).variables.id;
            requested.push(id);
            return success(id);
        };
    });
    const next = dom.window.document.querySelector('nav button');
    next.addEventListener('click', () => {
        dom.window.document.querySelector('main').innerHTML = card(102) + card(103);
        next.disabled = true;
        dom.window.history.replaceState({}, '', '?page=2');
    });
    const running = api.run();
    await clock.advance(10000);
    await running;
    assert.deepEqual(requested, ['101', '102', '103']);
    assert.equal(api.state.page, 2);
    assert.equal(api.state.successes, 3);
    assert.equal(api.state.skipped, 1);
});

test('a repeated page ends within its navigation deadline without more requests', async t => {
    let requests = 0;
    const { api, clock, dom } = fixture(t, `${card(101)}<nav aria-label="Pagination"><button aria-label="Next page">Next</button></nav>`, window => {
        window.fetch = async () => { requests++; return success('101'); };
    });
    dom.window.document.querySelector('nav button').addEventListener('click', () => dom.window.history.replaceState({}, '', '?page=2'));
    const running = api.run();
    await clock.advance(32000);
    await running;
    assert.equal(requests, 1);
    assert.equal(api.state.running, false);
    assert.match(api.state.status, /same results/);
});

test('retry exhaustion stops the run and records the failed asset once', async t => {
    let requests = 0;
    const { api, clock, ui } = fixture(t, card(101) + card(102), window => {
        window.fetch = async () => { requests++; return response({}, 503); };
    });
    const running = api.run();
    await clock.advance(10000);
    await running;
    assert.equal(requests, 3);
    assert.equal(api.state.failures, 1);
    assert.equal(ui.getElementById('history-count').textContent, '1');
    assert.equal(ui.getElementById('cache-count').textContent, '0');
});

test('Stop interrupts rate-limit backoff without retrying', async t => {
    let requests = 0;
    const { api, clock } = fixture(t, card(101), window => {
        window.fetch = async () => { requests++; return response({}, 429, '60'); };
    });
    const running = api.run();
    await clock.advance(1000);
    api.stop();
    await clock.advance(60000);
    await running;
    assert.equal(requests, 1);
    assert.match(api.state.status, /^Stopped\./);
});

test('a request deadline stops the run and never caches an unknown outcome', async t => {
    let requests = 0;
    const { api, ui, clock, dom } = fixture(t, card(101) + card(102), window => {
        window.fetch = async () => { requests++; return new Promise(() => {}); };
    });
    const running = api.run();
    await clock.advance(30000);
    await running;
    assert.equal(requests, 1);
    assert.equal(api.state.failures, 1);
    assert.equal(api.state.running, false);
    assert.equal(ui.getElementById('cache-count').textContent, '0');
    assert.equal(dom.window.localStorage.getItem(keys.owned), null);
    assert.match(api.state.status, /outcome is unknown/);
});

test('GraphQL authentication failures stop before the next product and enter history', async t => {
    let requests = 0;
    const { api, clock, ui } = fixture(t, card(101) + card(102), window => {
        window.fetch = async () => { requests++; return response({ errors: [{ message: 'Invalid CSRF token' }] }); };
    });
    const running = api.run();
    await clock.advance(5000);
    await running;
    assert.equal(requests, 1);
    assert.equal(api.state.failures, 1);
    assert.equal(ui.getElementById('history-count').textContent, '1');
});
