const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../test-support/harness.cjs');

const response = (body, status = 200, retryAfter = null) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name === 'Retry-After' ? retryAfter : null },
    json: async () => body
});

function claimFixture(t, fetch) {
    const fixture = load('', {
        setup(window) {
            window.document.cookie = '_csrf=test';
            window.fetch = fetch;
        }
    });
    t.after(() => fixture.dom.window.close());
    return fixture;
}

test('fallback checks ownership outside the inner free-price container', t => {
    const { dom, api } = load(`
        <article><div><a href="/packages/owned-101">Owned</a><span>Free</span></div><button>Download</button></article>
        <article><div><a href="/packages/free-102">Free asset</a><span>Free</span></div></article>
    `);
    t.after(() => dom.window.close());
    assert.deepEqual(Array.from(api.getCandidates(), item => item.id), ['102']);
});

test('nested recognized cards cannot bypass outer ownership or paid-price evidence', t => {
    const { dom, api } = load(`
        <article class="packageCard"><div class="packageCard-inner"><a href="/packages/owned-101">Owned</a><span>Free</span></div><button>Download</button></article>
        <article class="packageCard"><div class="packageCard-inner"><a href="/packages/paid-102">Paid</a><span>Free</span></div><span class="cost">$20</span></article>
    `);
    t.after(() => dom.window.close());
    assert.equal(api.getCandidates().length, 0);
});

test('free badges cannot override currency prices in unrecognized price markup', t => {
    const prices = ['$20', '20 EUR', 'USD 20', '¥500', '₹150'];
    const { dom, api } = load(prices.map((price, index) => `
        <article class="packageCard"><a href="/packages/asset-${index + 1}">Asset</a><span>Free</span><span class="cost">${price}</span></article>
    `).join(''));
    t.after(() => dom.window.close());
    assert.equal(api.getCandidates().length, 0);
});

test('fallback examines paid-price siblings before selecting a candidate', t => {
    const { dom, api } = load('<article><div><a href="/packages/asset-101">Asset</a><span>Free</span></div><span>$20</span></article>');
    t.after(() => dom.window.close());
    assert.equal(api.getCandidates().length, 0);
});

test('direct and split currency text cannot be overridden by a Free badge', t => {
    const { dom, api } = load(`
        <article class="packageCard"><a href="/packages/a-101">A</a><span>Free</span>$20</article>
        <article class="packageCard"><a href="/packages/b-102">B</a><span>Free</span>$<b>20</b></article>
    `);
    t.after(() => dom.window.close());
    assert.equal(api.getCandidates().length, 0);
});

test('recognized 96-listing pages retain every distinct free product', t => {
    const { dom, api } = load(Array.from({ length: 96 }, (_, index) => `
        <article class="packageCard"><a href="/packages/asset-${index + 1}">Asset ${index + 1}</a><span class="price">Free</span></article>
    `).join(''));
    t.after(() => dom.window.close());
    const ids = Array.from(api.getCandidates(), item => item.id);
    assert.equal(ids.length, 96);
    assert.equal(new Set(ids).size, 96);
});

test('cart, negative and ambiguous ownership errors never confirm ownership', async t => {
    const { dom, api } = claimFixture(t);
    for (const message of [
        'Item is already added to cart',
        'Item is already added to the queue',
        'Transaction already exists',
        'Asset is not already owned',
        'Asset is already owned by another user'
    ]) {
        dom.window.fetch = async () => response({ errors: [{ message }] });
        await assert.rejects(api.redeemOne({ id: '101' }), error => !error.alreadyOwned);
    }
});

test('explicit ownership is accepted only when every error confirms ownership', async t => {
    const { dom, api } = claimFixture(t);
    for (const message of ['Already owned', 'This asset is already owned.', 'Product is already in your library', 'You already own this asset']) {
        dom.window.fetch = async () => response({ errors: [{ message }] });
        await assert.rejects(api.redeemOne({ id: '101' }), error => error.alreadyOwned === true);
    }
    for (const otherError of [{ message: 'Entitlement unavailable' }, null, { message: 42 }]) {
        dom.window.fetch = async () => response({ errors: [{ message: 'Already owned' }, otherError] });
        await assert.rejects(api.redeemOne({ id: '101' }), error => !error.alreadyOwned);
    }
});

test('explicit GraphQL authentication errors stop the run even when ownership errors coexist', async t => {
    const { dom, api } = claimFixture(t);
    for (const message of ['Invalid CSRF token', 'CSRF token expired', 'Authentication required', 'Not authenticated', 'Sign in required']) {
        dom.window.fetch = async () => response({ errors: [{ message: 'Already owned' }, { message }] });
        await assert.rejects(api.redeemOne({ id: '101' }), error => error.fatal === true && !error.alreadyOwned);
    }
});

test('ordinary GraphQL product errors remain per-product failures', async t => {
    const { api } = claimFixture(t, async () => response({ errors: [{ message: 'This product is unavailable' }] }));
    await assert.rejects(api.redeemOne({ id: '101' }), error => !error.fatal && !error.retryable && !error.alreadyOwned);
});

test('malformed GraphQL errors cannot accompany a confirmed claim', async t => {
    const { api } = claimFixture(t, async () => response({
        data: { addToDownload: { id: '101' } }, errors: { message: 'Denied' }
    }));
    await assert.rejects(api.redeemOne({ id: '101' }), /invalid GraphQL errors/);
});

test('HTTP authentication failures are fatal and rate limits preserve Retry-After', async t => {
    const { dom, api } = claimFixture(t);
    for (const status of [401, 403, 419]) {
        dom.window.fetch = async () => response({}, status);
        await assert.rejects(api.redeemOne({ id: '101' }), error => error.fatal === true);
    }
    dom.window.fetch = async () => response({}, 429, '120');
    await assert.rejects(api.redeemOne({ id: '101' }), error => error.retryable === true && error.retryAfter === 120000);
    dom.window.fetch = async () => response({}, 503);
    await assert.rejects(api.redeemOne({ id: '101' }), error => error.retryable === true);
});

test('claim contract preserves matching product IDs and rejects mismatched IDs', async t => {
    let request;
    const { dom, api } = claimFixture(t, async (url, options) => {
        request = { url, options };
        return response({ data: { addToDownload: { id: '101', userEntitlement: null } } });
    });
    await api.redeemOne({ id: '101' });
    assert.equal(request.url, '/api/graphql');
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(JSON.parse(request.options.body).variables.id, '101');
    dom.window.fetch = async () => response({ data: { addToDownload: { id: '102' } } });
    await assert.rejects(api.redeemOne({ id: '101' }), /No entitlement returned/);
});

for (const stage of ['headers', 'body']) {
    test(`30-second deadline covers stalled ${stage} and leaves ownership unknown`, async t => {
        let requestSignal;
        const { api, clock } = claimFixture(t, async (url, options) => {
            requestSignal = options.signal;
            if (stage === 'headers') return new Promise(() => {});
            return { ...response({}), json: () => new Promise(() => {}) };
        });
        const pending = api.redeemOne({ id: '101' });
        let settled = false;
        const rejection = assert.rejects(pending, error => {
            settled = true;
            return error.timeout === true && error.fatal === true && !error.alreadyOwned && /outcome is unknown/.test(error.message);
        });
        await clock.advance(29999);
        assert.equal(settled, false);
        await clock.advance(1);
        await rejection;
        assert.equal(requestSignal.aborted, true);
    });
}

test('caller cancellation aborts a pending request without classifying a timeout', async t => {
    let requestSignal;
    const { dom, api, clock } = claimFixture(t, async (url, options) => {
        requestSignal = options.signal;
        return new Promise(() => {});
    });
    const controller = new dom.window.AbortController();
    const rejection = assert.rejects(api.redeemOne({ id: '101' }, controller.signal), error => error.name === 'AbortError' && !error.timeout);
    controller.abort();
    await rejection;
    assert.equal(requestSignal.aborted, true);
    await clock.advance(30001);
});

test('already-aborted caller signal sends no request', async t => {
    let requests = 0;
    const { dom, api } = claimFixture(t, async () => { requests++; return response({}); });
    const controller = new dom.window.AbortController();
    controller.abort();
    await assert.rejects(api.redeemOne({ id: '101' }, controller.signal), error => error.name === 'AbortError');
    assert.equal(requests, 0);
});

test('successful requests clean up their deadline and caller-abort listener', async t => {
    let requestSignal;
    const { dom, api, clock } = claimFixture(t, async (url, options) => {
        requestSignal = options.signal;
        return response({ data: { addToDownload: { id: '101' } } });
    });
    const controller = new dom.window.AbortController();
    await api.redeemOne({ id: '101' }, controller.signal);
    controller.abort();
    await clock.advance(30001);
    assert.equal(requestSignal.aborted, false);
});
