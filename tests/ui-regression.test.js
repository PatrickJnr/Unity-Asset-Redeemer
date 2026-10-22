const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../test-support/harness.cjs');

function key(window, element, value, options = {}) {
    const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    element.dispatchEvent(event);
    return event;
}

function mockLayout(window, ui) {
    const host = ui.host;
    const panel = ui.getElementById('panel');
    const dimensions = { contentHeight: 620 };
    Object.defineProperties(host, {
        offsetWidth: { get: () => Math.min(420, window.innerWidth - 24) },
        offsetHeight: {
            get: () => Math.min(window.innerHeight - 16, panel.hidden ? 54 :
                60 + Math.min(dimensions.contentHeight, parseFloat(panel.style.maxHeight) || 700))
        }
    });
    host.getBoundingClientRect = () => ({
        left: parseFloat(host.style.left) || 0,
        top: parseFloat(host.style.top) || 0,
        width: host.offsetWidth,
        height: host.offsetHeight
    });
    ui.querySelector('.masthead').getBoundingClientRect = () => ({ height: 54 });
    return { host, dimensions };
}

function assertWithinViewport(window, host) {
    const bounds = host.getBoundingClientRect();
    assert.ok(bounds.left >= 0 && bounds.top >= 0);
    assert.ok(bounds.left + bounds.width <= window.innerWidth);
    assert.ok(bounds.top + bounds.height <= window.innerHeight);
}

test('result tabs support roving focus, arrow wrapping, Home and End', () => {
    const { dom, ui } = load();
    const { window } = dom;
    const activity = ui.getElementById('tab-log');
    const history = ui.getElementById('tab-assets');
    ui.getElementById('toggle').click();
    activity.focus();
    assert.equal(activity.tabIndex, 0);
    assert.equal(history.tabIndex, -1);

    assert.equal(key(window, activity, 'ArrowRight').defaultPrevented, true);
    assert.equal(ui.activeElement, history);
    assert.equal(history.tabIndex, 0);
    assert.equal(activity.tabIndex, -1);
    assert.equal(history.getAttribute('aria-selected'), 'true');
    assert.equal(ui.getElementById('assets-pane').hidden, false);
    assert.equal(ui.getElementById('log-pane').hidden, true);

    key(window, history, 'ArrowRight');
    assert.equal(ui.activeElement, activity);
    key(window, activity, 'ArrowLeft');
    assert.equal(ui.activeElement, history);
    key(window, history, 'Home');
    assert.equal(ui.activeElement, activity);
    key(window, activity, 'End');
    assert.equal(ui.activeElement, history);
    activity.click();
    assert.equal(activity.tabIndex, 0);
    assert.equal(history.tabIndex, -1);
    dom.window.close();
});

test('expanding and resizing a moved dashboard keeps its controls inside the viewport', () => {
    const { dom, ui } = load();
    const { window } = dom;
    const { host } = mockLayout(window, ui);
    host.style.left = '590px';
    host.style.top = '710px';
    ui.getElementById('toggle').click();
    assertWithinViewport(window, host);
    assert.ok(parseFloat(host.style.top) < 710);

    window.innerWidth = 320;
    window.innerHeight = 200;
    window.dispatchEvent(new window.Event('resize'));
    assertWithinViewport(window, host);

    window.innerHeight = 100;
    window.dispatchEvent(new window.Event('resize'));
    assertWithinViewport(window, host);
    dom.window.close();
});

test('dashboard movement supports keyboard steps, boundaries and Home reset', () => {
    const { dom, ui } = load();
    const { window } = dom;
    const { host } = mockLayout(window, ui);
    const handle = ui.querySelector('.handle');
    host.style.left = '100px';
    host.style.top = '100px';
    assert.equal(key(window, handle, 'ArrowLeft').defaultPrevented, true);
    assert.equal(host.style.left, '90px');
    key(window, handle, 'ArrowDown', { shiftKey: true });
    assert.equal(host.style.top, '150px');
    key(window, handle, 'ArrowRight', { ctrlKey: true });
    assert.equal(host.style.left, '90px');
    host.style.top = '0px';
    key(window, handle, 'ArrowUp');
    assert.equal(host.style.top, '0px');
    key(window, handle, 'Home');
    assert.equal(host.style.left, `${window.innerWidth - host.offsetWidth - 18}px`);
    assert.equal(host.style.top, '18px');
    assertWithinViewport(window, host);
    dom.window.close();
});

test('dashboard clamps again when expanded content grows', () => {
    let onResize;
    const { dom, ui } = load('', {
        setup(window) {
            window.ResizeObserver = class {
                constructor(callback) { onResize = callback; }
                observe() {}
            };
        }
    });
    const { window } = dom;
    const { host, dimensions } = mockLayout(window, ui);
    dimensions.contentHeight = 200;
    host.style.top = '400px';
    ui.getElementById('toggle').click();
    assert.equal(host.style.top, '400px');
    dimensions.contentHeight = 620;
    onResize();
    assertWithinViewport(window, host);
    assert.ok(parseFloat(host.style.top) < 400);
    dom.window.close();
});
