const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'Unity_Auto_Redeemer.user.js'), 'utf8');

function load(html = '') {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
        url: 'https://assetstore.unity.com/?page=1',
        runScripts: 'outside-only'
    });
    dom.window.__UNITY_ASSET_REDEEMER_TEST__ = true;
    dom.window.confirm = () => true;
    dom.window.eval(source);
    return { dom, api: dom.window.__UNITY_ASSET_REDEEMER_TEST_API__ };
}

test('metadata has one block and matching release version', () => {
    assert.equal((source.match(/\/\/ ==UserScript==/g) || []).length, 1);
    const version = source.match(/^\/\/ @version\s+(\d+\.\d+\.\d+)$/m)?.[1];
    assert.equal(version, require('../package.json').version);
});

test('validates numeric Unity product IDs', () => {
    const { dom, api } = load();
    assert.equal(api.validProductId('12345'), true);
    assert.equal(api.validProductId('12x'), false);
    assert.equal(api.validProductId('../12'), false);
    dom.window.close();
});

test('filters paid and owned cards and deduplicates free products', () => {
    const { dom, api } = load(`
      <article class="packageCard"><a href="/packages/free-one-101">Free One</a><span class="price">Free</span></article>
      <article class="packageCard"><a href="/packages/free-one-101">Duplicate</a><span class="price">Free</span></article>
      <article class="packageCard"><a href="/packages/paid-202">Paid</a><span class="price">£4.99</span></article>
      <article class="packageCard"><a href="/packages/owned-303">Owned</a><span class="price">Free</span><button>Open in Unity</button></article>
    `);
    assert.deepEqual(Array.from(api.getCandidates(), item => item.id), ['101']);
    dom.window.close();
});

test('rejects ambiguous cards containing more than one product ID', () => {
    const { dom, api } = load('<article class="packageCard"><a href="/packages/a-1">A</a><a href="/packages/b-2">B</a><span class="price">Free</span></article>');
    assert.equal(api.getCandidates().length, 0);
    dom.window.close();
});

test('parses claim errors without treating unknown responses as success', () => {
    const { dom, api } = load();
    assert.equal(api.errorFromResponse({ errors: [{ message: 'Denied' }] }), 'Denied');
    assert.equal(api.errorFromResponse({ data: {} }), 'No entitlement returned');
    assert.equal(api.errorFromResponse(null), 'Unexpected server response');
    dom.window.close();
});

test('parses Retry-After seconds and HTTP dates without shortening server guidance', () => {
    const { dom, api } = load();
    const now = Date.parse('2026-01-01T00:00:00Z');
    assert.equal(api.parseRetryAfter('5', now), 5000);
    assert.equal(api.parseRetryAfter('Thu, 01 Jan 2026 00:00:12 GMT', now), 12000);
    assert.equal(api.parseRetryAfter('999', now), 999000);
    dom.window.close();
});

test('rejects conflicting prices and does not rediscover owned cards through fallback', () => {
    const { dom, api } = load(`
      <article class="packageCard"><a href="/packages/a-1">A</a><span class="price">Free</span><span class="price">£4.99</span></article>
      <article class="packageCard"><div><a href="/packages/b-2">B</a><span>Free</span></div><button>Download</button></article>
    `);
    assert.equal(api.getCandidates().length, 0);
    dom.window.close();
});

test('claim rejects GraphQL errors even when a matching product ID is returned', async () => {
    const { dom, api } = load();
    dom.window.document.cookie = '_csrf=test';
    dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { addToDownload: { id: '101' } }, errors: [{ message: 'Denied' }] }) });
    await assert.rejects(api.redeemOne({ id: '101' }), /Denied/);
    dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { addToDownload: { id: '101' } } }) });
    await api.redeemOne({ id: '101' });
    dom.window.close();
});

test('claim does not treat a generic already-exists error as ownership', async () => {
    const { dom, api } = load();
    dom.window.document.cookie = '_csrf=test';
    dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'Transaction already exists' }] }) });
    await assert.rejects(api.redeemOne({ id: '101' }), error => !error.alreadyOwned);
    dom.window.close();
});

test('persistent ownership reset removes the cache', () => {
    const { dom } = load();
    dom.window.localStorage.setItem('unity-auto-redeemer-v2-confirmed-owned', '["101"]');
    dom.window.document.querySelector('#unity-auto-redeemer-v2').shadowRoot.getElementById('clear-cache').click();
    assert.equal(dom.window.localStorage.getItem('unity-auto-redeemer-v2-confirmed-owned'), null);
    dom.window.close();
});

test('pagination returns no next control on a final page', () => {
    const { dom, api } = load('<nav aria-label="Pagination"><button aria-current="page">2</button><button disabled aria-label="Next page">Next</button></nav>');
    assert.equal(api.nextPageControl(), null);
    dom.window.close();
});

test('listing identity remains stable for repeated-page protection', () => {
    const { dom, api } = load('<a href="/packages/tool-55">Tool</a><span aria-current="page">1</span>');
    assert.equal(api.listingIdentity(), api.listingIdentity());
    dom.window.close();
});

test('repeated listing content is detected even if the page URL changes', () => {
    const { dom, api } = load('<a href="/packages/tool-55">Tool</a>');
    const first = api.listingIdentity();
    dom.window.history.replaceState({}, '', '?page=2');
    const second = api.listingIdentity();
    assert.notEqual(first, second);
    assert.equal(api.listingContentKey(first), api.listingContentKey(second));
    dom.window.close();
});
