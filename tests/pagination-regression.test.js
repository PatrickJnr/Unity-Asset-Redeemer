const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../test-support/harness.cjs');

function visibleControls(window) {
    window.HTMLElement.prototype.getClientRects = function () {
        return this.closest('[hidden]') ? [] : [{ width: 10, height: 10 }];
    };
}

function card(id) {
    return `<article class="packageCard"><a href="/packages/asset-${id}">Asset ${id}</a><span class="price">Free</span></article>`;
}

function activate(api) {
    api.state.running = true;
    api.state.token = 1;
}

test('pagination ignores a carousel Next button before the listing paginator', () => {
    const { dom, api } = load('<button id="carousel" aria-label="Next">Next image</button><nav aria-label="Pagination"><button id="next-page" aria-label="Next page">Next</button></nav>', { setup: visibleControls });
    assert.equal(api.nextPageControl()?.id, 'next-page');
    dom.window.close();
});

test('a generic navigation Next button alone is not listing pagination', () => {
    const { dom, api } = load('<nav aria-label="Product images"><button aria-label="Next">Next</button></nav>', { setup: visibleControls });
    assert.equal(api.nextPageControl(), null);
    dom.window.close();
});

test('carousel pagination classes cannot override the listing paginator', () => {
    const { dom, api } = load('<div class="carousel-pagination"><button id="carousel" aria-label="Next">Next image</button></div><nav aria-label="Pagination"><button id="listing" aria-label="Next page">Next</button></nav>', { setup: visibleControls });
    assert.equal(api.nextPageControl()?.id, 'listing');
    dom.window.close();
});

test('numbered pagination keeps the disabled current page when selecting the only enabled next page', () => {
    const { dom, api } = load('<nav aria-label="Pagination"><button disabled aria-current="page">1</button><button id="page-two">2</button></nav>', { setup: visibleControls });
    assert.equal(api.nextPageControl()?.id, 'page-two');
    dom.window.close();
});

test('numbered pagination supports a noninteractive current-page label', () => {
    const { dom, api } = load('<nav aria-label="Pagination"><span aria-current="page">1</span><button id="page-two">2</button></nav>', { setup: visibleControls });
    assert.equal(api.nextPageControl()?.id, 'page-two');
    dom.window.close();
});

test('visible final-page controls do not select Previous or disabled Next', () => {
    const { dom, api } = load('<nav aria-label="Pagination"><button>1</button><button disabled aria-current="page">2</button><button disabled aria-label="Next page">Next</button></nav>', { setup: visibleControls });
    assert.equal(api.nextPageControl(), null);
    dom.window.close();
});

test('arrow-only controls work inside an identified paginator', () => {
    const { dom, api } = load('<div class="Pagination"><button id="next-page"><svg data-icon="chevron-right"></svg></button></div>', { setup: visibleControls });
    assert.equal(api.nextPageControl()?.id, 'next-page');
    dom.window.close();
});

test('pageIndex is zero-based and the active pagination label takes priority', () => {
    const { dom, api } = load('', { url: 'https://assetstore.unity.com/listing?pageIndex=0' });
    assert.equal(api.paginationPageNumber(), 1);
    dom.window.history.replaceState({}, '', '?pageIndex=1');
    assert.equal(api.paginationPageNumber(), 2);
    dom.window.document.body.insertAdjacentHTML('beforeend', '<nav aria-label="Pagination"><span aria-current="page">3</span></nav>');
    assert.equal(api.paginationPageNumber(), 3);
    dom.window.close();
});

test('listing identity excludes unrelated product links when recognized cards exist', () => {
    const { dom, api } = load(`${card(101)}<aside><a href="/packages/recommendation-999">Related</a></aside>`);
    const before = api.listingIdentity();
    assert.deepEqual(JSON.parse(before).ids, ['101']);
    dom.window.document.querySelector('aside a').href = '/packages/recommendation-998';
    assert.equal(api.listingIdentity(), before);
    dom.window.close();
});

test('listing content rejects malformed identities and normalizes duplicate IDs', () => {
    const { dom, api } = load();
    for (const identity of ['invalid', '{}', 'null', '{"ids":[null]}']) {
        assert.equal(api.listingContentKey(identity), null);
    }
    assert.equal(api.listingContentKey('{"ids":["2","1","2"]}'), '["1","2"]');
    dom.window.close();
});

test('navigation does not finish when only the URL and active page label change', async () => {
    const { dom, api, clock } = load(`${card(101)}<nav aria-label="Pagination"><span aria-current="page">1</span></nav>`);
    activate(api);
    const before = api.listingIdentity();
    dom.window.history.replaceState({}, '', '?page=2');
    dom.window.document.querySelector('[aria-current]').textContent = '2';
    const waiting = api.waitForPageChange(before, 1, 5000);
    await clock.advance(5000);
    assert.equal(await waiting, false);
    dom.window.close();
});

test('progressive page rendering restarts the stability wait instead of failing early', async () => {
    const { dom, api, clock } = load(`<main>${card(101)}</main>`);
    activate(api);
    const before = api.listingIdentity();
    dom.window.document.querySelector('main').innerHTML = card(102);
    dom.window.setTimeout(() => {
        dom.window.document.querySelector('main').innerHTML = card(103);
    }, 1500);
    let settled = false;
    const waiting = api.waitForPageChange(before, 1, 5000).then(result => {
        settled = true;
        return result;
    });
    await clock.advance(2400);
    assert.equal(settled, false);
    await clock.advance(1600);
    assert.equal(await waiting, true);
    dom.window.close();
});

test('a 96-result page waits for all advertised listing cards before finishing navigation', async () => {
    const firstPage = Array.from({ length: 96 }, (_, index) => card(index + 1)).join('');
    const secondPage = Array.from({ length: 96 }, (_, index) => card(index + 97)).join('');
    const { dom, api, clock } = load(`<p data-test="results">Results 1-96 of 200</p><main>${firstPage}</main>`);
    activate(api);
    const before = api.listingIdentity();
    dom.window.document.querySelector('[data-test="results"]').textContent = 'Results 97-192 of 200';
    dom.window.document.querySelector('main').innerHTML = card(97);
    let settled = false;
    const waiting = api.waitForPageChange(before, 1, 10000).then(result => {
        settled = true;
        return result;
    });
    await clock.advance(3000);
    assert.equal(settled, false);
    dom.window.document.querySelector('main').innerHTML = secondPage;
    await clock.advance(2600);
    assert.equal(await waiting, true);
    dom.window.close();
});

test('an empty grid during navigation does not count as a completed page', async () => {
    const { dom, api, clock } = load(`<main>${card(101)}</main>`);
    activate(api);
    const before = api.listingIdentity();
    dom.window.document.querySelector('main').replaceChildren();
    const waiting = api.waitForPageChange(before, 1, 5000);
    await clock.advance(5000);
    assert.equal(await waiting, false);
    dom.window.close();
});

test('navigation polling stops promptly when its run is canceled', async () => {
    const { dom, api, clock } = load(card(101));
    activate(api);
    const waiting = api.waitForPageChange(api.listingIdentity(), 1);
    await clock.advance(400);
    api.state.running = false;
    api.state.token++;
    await clock.advance(400);
    assert.equal(await waiting, false);
    dom.window.close();
});
