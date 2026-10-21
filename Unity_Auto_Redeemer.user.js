// ==UserScript==
// @name         Unity Asset Redeemer
// @namespace    https://github.com/PatrickJnr/Unity-Asset-Redeemer
// @version      2.3.1
// @description  Claim free Unity Asset Store assets with automatic pagination, ownership tracking and a clean slate dashboard.
// @author       Patrick Jr. (maintainer), CreosB (original)
// @license      CC-BY-NC-SA-4.0
// @homepageURL  https://github.com/PatrickJnr/Unity-Asset-Redeemer
// @supportURL   https://github.com/PatrickJnr/Unity-Asset-Redeemer/issues
// @updateURL    https://raw.githubusercontent.com/PatrickJnr/Unity-Asset-Redeemer/main/Unity_Auto_Redeemer.user.js
// @downloadURL  https://raw.githubusercontent.com/PatrickJnr/Unity-Asset-Redeemer/main/Unity_Auto_Redeemer.user.js
// @match        https://assetstore.unity.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const ROOT_ID = 'unity-auto-redeemer-v2';
    if (document.getElementById(ROOT_ID)) return;

    const GRAPHQL_URL = '/api/graphql';
    const MUTATION = 'mutation AddToDownload($id: String!) { addToDownload(id: $id) { id userEntitlement { id orderId grantTime } } }';
    const SESSION_KEY = 'unity-auto-redeemer-v2-history';
    const RESUME_KEY = 'unity-auto-redeemer-v2-resume';
    const SETTINGS_KEY = 'unity-auto-redeemer-v2-settings';
    const OWNED_KEY = 'unity-auto-redeemer-v2-confirmed-owned';
    const CARD_SELECTORS = [
        'div._3YDeD', '[class*="packageCard"]', '[class*="PackageCard"]',
        '[data-test="package-card"]', '[data-testid="package-card"]',
        '[class*="assetCard"]', '[class*="AssetCard"]'
    ];
    const PRICE_SELECTORS = [
        '[data-test*="price"]', '[data-testid*="price"]',
        '[class*="price"]', '[class*="Price"]'
    ];
    const validProductId = value => /^\d+$/.test(String(value));
    const parseRetryAfter = (value, now = Date.now()) => {
        if (!value) return 0;
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
        const date = Date.parse(value);
        return Number.isFinite(date) ? Math.max(0, date - now) : 0;
    };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const readJSON = (store, key, fallback) => {
        try { return JSON.parse(store.getItem(key)) ?? fallback; }
        catch { return fallback; }
    };
    const defaults = { allPages: true, preview: false, delay: 1500, maxPages: 100 };
    const settings = { ...defaults, ...readJSON(localStorage, SETTINGS_KEY, {}) };
    const history = readJSON(sessionStorage, SESSION_KEY, []);
    const assets = Array.isArray(history) ? history.filter(x => x && validProductId(x.id)) : [];
    const claimedIds = new Set(assets.filter(x => x.status === 'claimed' || (x.status === 'skipped' && x.reason === 'Already owned')).map(x => String(x.id)));
    const savedOwned = readJSON(localStorage, OWNED_KEY, []);
    const knownIds = new Set([
        ...(Array.isArray(savedOwned) ? savedOwned : []).map(String).filter(validProductId).slice(-20000),
        ...claimedIds
    ]);
    function rememberOwned(id) {
        knownIds.add(String(id));
        claimedIds.add(String(id));
        try { localStorage.setItem(OWNED_KEY, JSON.stringify([...knownIds].slice(-20000))); } catch {}
        updateCacheCount();
    }
    function updateCacheCount() {
        const el = shadow.getElementById('cache-count');
        if (el) el.textContent = knownIds.size.toLocaleString();
    }
    const state = {
        running: false, expanded: false, token: 0, aborter: null, page: 0,
        current: 0, total: 0, successes: 0, failures: 0, skipped: 0,
        currentName: '', status: 'Ready', severity: 'idle', events: [],
        lastScan: [], drag: null
    };

    const css = `
        :host { all: initial; color-scheme: dark; }
        *, *::before, *::after { box-sizing: border-box; }
        [hidden] { display: none !important; }
        .shell {
            width: min(420px, calc(100vw - 24px));
            font: 12px/1.5 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            color: #e9eef4; letter-spacing: 0; text-align: left;
        }
        button, input { font: inherit; }
        button { -webkit-tap-highlight-color: transparent; }
        .masthead {
            display: flex; align-items: stretch; gap: 0; min-height: 54px;
            background: #1b2531; border: 1px solid #435365; border-radius: 4px;
            box-shadow: 0 3px 10px #080d154d;
        }
        .handle {
            cursor: grab; user-select: none; touch-action: none; flex: 0 0 26px;
            background: #243242; border: 0; border-right: 1px solid #435365;
            color: #90a0b0; font-size: 16px; letter-spacing: -5px;
            border-radius: 3px 0 0 3px; padding: 0 8px 0 3px;
        }
        .handle:active { cursor: grabbing; }
        .brand {
            width: 27px; height: 27px; display: grid; place-items: center;
            margin: auto 10px auto 12px; background: #35485b; color: #f1f5f8;
            border: 1px solid #52677a; border-radius: 3px;
            font-weight: 800; font-size: 14px; flex-shrink: 0;
        }
        .toggle {
            border: 0; min-width: 0; flex: 1; display: flex; justify-content: space-between;
            align-items: center; gap: 10px; background: transparent; color: #f0f4f7;
            cursor: pointer; text-align: left; padding: 8px 13px 8px 0;
        }
        .toggle-text { min-width: 0; flex: 1; }
        .toggle strong, .toggle small { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .toggle strong { font-weight: 650; font-size: 12.5px; line-height: 19px; }
        .toggle small { color: #9aaaba; font-size: 11px; }
        .right-group { display: flex; gap: 12px; align-items: center; flex-shrink: 0; }
        .indicator { display: block; width: 8px; height: 8px; background: #7b9c91; border-radius: 1px; }
        .indicator.running { background: #e0b570; }
        .indicator.error { background: #d88989; }
        .chevron { display: inline-block; font-size: 15px; color: #8d9bac; transition: transform .18s ease; }
        .toggle[aria-expanded="true"] .chevron { transform: rotate(180deg); }
        .panel {
            margin-top: 6px; max-height: min(700px, calc(100vh - 93px)); overflow: auto;
            border: 1px solid #455566; border-radius: 4px; background: #151e28;
            box-shadow: 0 6px 15px #05091170;
            scrollbar-color: #526175 transparent; scrollbar-width: thin;
        }
        .panel-top { display: flex; justify-content: space-between; align-items: start;
            gap: 10px; padding: 17px 17px 15px; border-bottom: 1px solid #354353; }
        .eyebrow { color: #8d9eaf; font-weight: 700; font-size: 10px; line-height: 1.4; letter-spacing: .11em; text-transform: uppercase; }
        .heading { font-weight: 700; font-size: 17px; margin: 4px 0 3px; color: #f2f5f8; }
        .description { color: #9daebe; margin: 0; font-size: 11px; }
        .version { background: #263647; color: #b7c9d9; border: 1px solid #42586a;
            padding: 3px 7px; border-radius: 2px; font-size: 10px; font-weight: 750; letter-spacing: .06em; }
        .content { padding: 15px 17px 16px; }
        .runstate { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .state-label { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
        .state-label .indicator { width: 7px; height: 7px; }
        .page-label { color: #a0b1c2; font-size: 11px; font-variant-numeric: tabular-nums; }
        .status { min-height: 32px; color: #aebecb; line-height: 16px; overflow-wrap: anywhere; font-size: 11.5px; margin: 0 0 11px; }
        .status.error { color: #eca2a2; }
        .progress-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 7px; }
        .progress-heading strong { font-size: 11px; font-weight: 600; color: #bdcbd6; }
        .progress-heading span { font-variant-numeric: tabular-nums; color: #95a9b8; font-size: 11px; }
        .bar { width: 100%; height: 6px; background: #2a3847; overflow: hidden; border-radius: 1px; }
        .fill { height: 100%; width: 0%; background: #95aebe; transition: width .2s ease; }
        .stat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 16px 0; }
        .stat { background: #1c2936; border: 1px solid #354657; border-radius: 3px; padding: 10px 11px 8px; }
        .stat-value { display: block; color: #e7edf4; font-size: 22px; font-weight: 700; line-height: 27px; font-variant-numeric: tabular-nums; }
        .stat-label { display: block; color: #99aabc; font-size: 11px; margin-top: 3px; }
        .stat-claimed .stat-value { color: #a6c8b9; }
        .stat-failed .stat-value { color: #e0a5a5; }
        .actions { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 7px; margin: 0 0 14px; }
        .action {
            border: 1px solid #667e92; border-radius: 3px; background: #536e85; color: #f5f8fa;
            cursor: pointer; padding: 9px 12px; white-space: nowrap; font-size: 11.5px; font-weight: 700;
            transition: background .12s ease, border-color .12s ease;
        }
        .action:hover:not(:disabled) { background: #627f97; border-color: #849bad; }
        .action:active:not(:disabled) { background: #435d72; }
        .action:disabled { opacity: .4; cursor: not-allowed; }
        .action.secondary { background: #253443; border-color: #425568; color: #d5e0e9; }
        .action.secondary:hover:not(:disabled) { background: #344657; }
        .action.stop { color: #e2b3b3; border-color: #72545b; }
        .action.stop:hover:not(:disabled) { background: #48333b; }
        .settings { border-top: 1px solid #354353; padding-top: 11px; }
        .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; }
        .setting-detail { display: flex; flex-direction: column; flex: 1; }
        .setting-title { font-size: 11.5px; font-weight: 600; color: #d8e1e9; }
        .setting-subtitle { color: #91a2b2; font-size: 10px; margin-top: 1px; }
        .setting-row input { appearance: none; -webkit-appearance: none; cursor: pointer; margin: 0;
            flex: 0 0 29px; height: 17px; width: 29px; border-radius: 3px; border: 1px solid #526274; background: #2b3947;
            position: relative; transition: background .15s; }
        .setting-row input::after { content: ''; width: 11px; height: 11px; background: #a2b0bd;
            position: absolute; top: 2px; left: 2px; border-radius: 2px; transition: left .15s; }
        .setting-row input:checked { background: #526f84; border-color: #8da3b5; }
        .setting-row input:checked::after { background: #f1f5f8; left: 14px; }
        .setting-row input:disabled { opacity: .45; cursor: not-allowed; }
        .cache-line { margin: 11px 0 0; background: #1c2936; border: 1px solid #354657; border-radius: 3px;
            padding: 8px 9px; font-size: 10.5px; color: #9db0c2; display: flex; gap: 6px; justify-content: space-between; }
        .cache-line strong { color: #d5e2eb; font-variant-numeric: tabular-nums; }
        .cache-hint { color: #8498a8; margin: 6px 0 0; font-size: 10px; }
        .tabs { display: flex; border-bottom: 1px solid #354353; gap: 18px; margin: 0; padding: 0 17px; }
        .tabs button { border: 0; border-bottom: 2px solid transparent; color: #92a5b6; background: transparent;
            cursor: pointer; padding: 12px 1px 10px; font-size: 11.5px; font-weight: 650; }
        .tabs button[aria-selected="true"] { color: #e0e9f1; border-color: #9bb2c4; }
        .tab-content { padding: 2px 17px 12px; }
        .list { margin: 0; padding: 0; list-style: none; max-height: 173px; overflow-y: auto;
            scrollbar-color: #526175 transparent; scrollbar-width: thin; }
        .list li { border-bottom: 1px solid #2b3947; padding: 9px 0; display: flex; gap: 10px; align-items: start;
            color: #aabbc9; font-size: 11px; overflow-wrap: anywhere; }
        .list li:last-child { border-bottom: 0; }
        .log-mark { flex: 0 0 6px; height: 6px; margin-top: 5px; background: #8499ac; border-radius: 1px; }
        .ok .log-mark { background: #9ec4af; }
        .fail .log-mark { background: #cf8d8d; }
        .skip .log-mark { background: #c9b18c; }
        .list .empty { font-style: italic; color: #8b9eae; }
        .search { width: 100%; background: #1e2a37; border: 1px solid #45586b; border-radius: 3px;
            color: #e8eef4; padding: 9px 10px; margin: 10px 0 3px; font-size: 11px; }
        .search::placeholder { color: #8fa1b0; }
        .footer { border-top: 1px solid #354353; margin: 0; padding: 10px 17px 12px; display: flex; flex-wrap: wrap;
            align-items: center; justify-content: space-between; gap: 8px; }
        .footer-btn { border: 0; padding: 3px 0; color: #a8bdcd; background: transparent; font-size: 10.5px;
            cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
        .footer-btn:hover { color: #e8edf2; }
        .footer-btn:disabled { opacity: .45; cursor: not-allowed; }
        .footer-btn.warn { color: #c8a5a5; }
        .footer-note { color: #8598a9; font-size: 10px; }
        button:focus-visible, input:focus-visible { outline: 2px solid #a6becf; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
    `;

    const host = document.createElement('div');
    host.id = ROOT_ID;
    host.style.cssText = 'position:fixed;top:18px;right:18px;z-index:2147483646;pointer-events:auto;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style);
    const shell = document.createElement('div');
    shell.className = 'shell';
    shell.innerHTML = `
        <div class="masthead">
            <button class="handle" type="button" title="Drag the redeemer" aria-label="Drag panel">⋮⋮</button>
            <div class="brand" aria-hidden="true">U</div>
            <button class="toggle" id="toggle" type="button" aria-expanded="false" aria-controls="panel">
                <span class="toggle-text"><strong id="title">UNITY / AUTO REDEEM</strong><small id="subtitle">Ready to scan</small></span>
                <span class="right-group"><span class="indicator" id="dot"></span><span class="chevron" aria-hidden="true">⌄</span></span>
            </button>
        </div>
        <section class="panel" id="panel" hidden aria-label="Unity Asset Store redeemer">
            <div class="panel-top">
                <div><div class="eyebrow">Asset Store / Utility</div><h2 class="heading">Auto Redeemer</h2>
                <p class="description">Free assets. Confirmed ownership checks.</p></div>
                <span class="version">v2.3.1</span>
            </div>
            <div class="content">
                <div class="runstate"><div class="state-label"><span class="indicator" id="panel-dot"></span><span id="run-label">IDLE</span></div><span class="page-label" id="page-label">PAGE -</span></div>
                <div class="status" id="status" role="status" aria-live="polite">Ready to scan the current page.</div>
                <div class="progress-heading"><strong>Current page</strong><span id="progress-text">0 / 0</span></div>
                <div class="bar" role="progressbar" aria-label="Current page progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fill" id="fill"></div></div>
                <div class="stat-grid">
                    <div class="stat stat-claimed"><span class="stat-value" id="success">0</span><span class="stat-label">Claimed</span></div>
                    <div class="stat"><span class="stat-value" id="skipped">0</span><span class="stat-label">Skipped</span></div>
                    <div class="stat stat-failed"><span class="stat-value" id="failed">0</span><span class="stat-label">Failed</span></div>
                </div>
                <div class="actions">
                    <button class="action" id="start" type="button">Start redeeming</button>
                    <button class="action secondary" id="scan" type="button">Scan page</button>
                    <button class="action secondary stop" id="stop" type="button" disabled>Stop</button>
                </div>
                <div class="settings">
                    <label class="setting-row"><span class="setting-detail"><span class="setting-title">Continue across pages</span><span class="setting-subtitle">Automatically move to the next results page</span></span><input id="pages" type="checkbox" checked aria-label="Continue across pages"></label>
                    <label class="setting-row"><span class="setting-detail"><span class="setting-title">Preview only</span><span class="setting-subtitle">Inspect listings without claiming assets</span></span><input id="preview" type="checkbox" aria-label="Preview only"></label>
                </div>
                <div class="cache-line"><span>Confirmed owned / saved on this browser</span><strong id="cache-count">0</strong></div>
                <p class="cache-hint">Cache is shared across Unity accounts in this browser. Reset it when switching accounts.</p>
            </div>
            <div class="tabs" role="tablist" aria-label="Results">
                <button id="tab-log" type="button" role="tab" aria-controls="log-pane" aria-selected="true">Activity</button>
                <button id="tab-assets" type="button" role="tab" aria-controls="assets-pane" aria-selected="false">Session history (<span id="history-count">0</span>)</button>
            </div>
            <div class="tab-content" id="log-pane" role="tabpanel" aria-labelledby="tab-log"><ul class="list" id="log"></ul></div>
            <div class="tab-content" id="assets-pane" role="tabpanel" aria-labelledby="tab-assets" hidden>
                <input class="search" id="search" type="search" placeholder="Search assets, IDs or status..." aria-label="Search claim history">
                <ul class="list" id="assets"></ul>
            </div>
            <div class="footer"><button type="button" class="footer-btn" id="export">Export session history</button>
            <button type="button" class="footer-btn warn" id="clear-cache">Reset local data</button>
            <span class="footer-note">Sign in to Unity first</span></div>
        </section>`;
    shadow.append(shell);
    (document.body || document.documentElement).append(host);
    const $ = id => shadow.getElementById(id);

    $('pages').checked = Boolean(settings.allPages);
    $('preview').checked = Boolean(settings.preview);
    const saveSettings = () => {
        settings.allPages = $('pages').checked;
        settings.preview = $('preview').checked;
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
    };
    $('pages').addEventListener('change', saveSettings);
    $('preview').addEventListener('change', saveSettings);

    function setStatus(message, severity = 'idle') {
        state.status = message;
        state.severity = severity;
        render();
    }

    function addEvent(kind, message) {
        state.events.push({ kind, message });
        if (state.events.length > 120) state.events.shift();
        console[kind === 'fail' ? 'error' : 'log']('[Unity Redeemer]', message);
        renderLog();
    }

    function renderLog() {
        const list = $('log');
        list.replaceChildren();
        const entries = state.events.slice(-50).reverse();
        if (!entries.length) {
            const li = document.createElement('li');
            li.className = 'empty';
            li.textContent = 'No activity yet. Scan a page or start redeeming.';
            list.append(li);
        }
        for (const entry of entries) {
            const li = document.createElement('li');
            li.className = entry.kind;
            const mark = document.createElement('span');
            mark.className = 'log-mark';
            mark.setAttribute('aria-hidden', 'true');
            const body = document.createElement('span');
            body.textContent = entry.message;
            li.append(mark, body);
            list.append(li);
        }
    }

    function saveHistory() {
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(assets.slice(-3000))); } catch {}
    }

    function addHistory(asset, status, reason = '') {
        if (status === 'claimed' || (status === 'skipped' && reason === 'Already owned')) {
            rememberOwned(asset.id);
        }
        if (status === 'claimed' && assets.some(x => x.status === 'claimed' && x.id === asset.id)) return;
        assets.push({ id: asset.id, name: asset.name, url: asset.url, status, reason, timestamp: new Date().toISOString() });
        saveHistory();
        $('history-count').textContent = String(assets.length);
        if (!$('assets-pane').hidden) renderHistory();
    }

    function renderHistory() {
        const search = $('search').value.toLowerCase().trim();
        const list = $('assets');
        list.replaceChildren();
        const matching = assets.filter(a => (`${a.name} ${a.id} ${a.status}`).toLowerCase().includes(search));
        for (const asset of matching.slice(-250).reverse()) {
            const li = document.createElement('li');
            li.className = asset.status === 'claimed' ? 'ok' : asset.status === 'failed' ? 'fail' : 'skip';
            const mark = document.createElement('span');
            mark.className = 'log-mark';
            const body = document.createElement('span');
            const when = new Date(asset.timestamp).toLocaleString();
            body.textContent = `${asset.status.toUpperCase()} · ${asset.name} (${asset.id}) · ${when}${asset.reason ? ' · ' + asset.reason : ''}`;
            li.append(mark, body);
            list.append(li);
        }
        if (!matching.length) {
            const li = document.createElement('li');
            li.className = 'empty';
            li.textContent = 'No matching assets in this session.';
            list.append(li);
        }
    }

    function render() {
        const statusClass = state.running ? 'running' : state.severity === 'error' ? 'error' : '';
        $('dot').className = `indicator ${statusClass}`;
        $('panel-dot').className = `indicator ${statusClass}`;
        $('run-label').textContent = state.running ? (settings.preview ? 'PREVIEWING' : 'PROCESSING') : state.severity === 'error' ? 'ATTENTION' : 'IDLE';
        $('title').textContent = 'UNITY / AUTO REDEEM';
        $('subtitle').textContent = state.running ? `Page ${state.page} · ${state.current}/${state.total}` : state.status;
        $('status').textContent = state.currentName || state.status;
        $('status').className = `status ${state.severity === 'error' ? 'error' : ''}`;
        $('page-label').textContent = state.page ? `PAGE ${state.page}` : 'PAGE -';
        $('progress-text').textContent = `${state.current} / ${state.total}`;
        $('success').textContent = state.successes.toLocaleString();
        $('skipped').textContent = state.skipped.toLocaleString();
        $('failed').textContent = state.failures.toLocaleString();
        const percent = state.total ? Math.min(100, Math.round((state.current / state.total) * 100)) : 0;
        $('fill').style.width = `${percent}%`;
        shadow.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(percent));
        $('start').disabled = state.running;
        $('scan').disabled = state.running;
        $('stop').disabled = !state.running;
        $('pages').disabled = state.running;
        $('preview').disabled = state.running;
        $('clear-cache').disabled = state.running;
    }

    $('toggle').addEventListener('click', () => {
        state.expanded = !state.expanded;
        $('panel').hidden = !state.expanded;
        $('toggle').setAttribute('aria-expanded', String(state.expanded));
    });
    for (const [tab, pane, otherTab, otherPane] of [
        ['tab-log', 'log-pane', 'tab-assets', 'assets-pane'],
        ['tab-assets', 'assets-pane', 'tab-log', 'log-pane']
    ]) {
        $(tab).addEventListener('click', () => {
            $(pane).hidden = false;
            $(otherPane).hidden = true;
            $(tab).setAttribute('aria-selected', 'true');
            $(otherTab).setAttribute('aria-selected', 'false');
            if (pane === 'assets-pane') renderHistory();
        });
    }
    $('search').addEventListener('input', renderHistory);
    $('export').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(assets, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `unity-asset-claims-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('clear-cache').addEventListener('click', () => {
        if (state.running) return;
        if (!confirm('Reset local cache and this tab\'s history? This will not remove assets from your Unity account.')) return;
        try {
            localStorage.removeItem(OWNED_KEY);
            sessionStorage.removeItem(SESSION_KEY);
            sessionStorage.removeItem(RESUME_KEY);
        } catch {}
        knownIds.clear();
        claimedIds.clear();
        assets.splice(0);
        state.events = [];
        $('history-count').textContent = '0';
        updateCacheCount();
        renderLog();
        renderHistory();
        setStatus('Local saved claims and session history cleared. Your Unity assets are unchanged.');
    });

    const handle = shadow.querySelector('.handle');
    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const bounds = host.getBoundingClientRect();
        state.drag = { id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
        if (!state.drag || state.drag.id !== event.pointerId) return;
        const x = Math.max(0, Math.min(event.clientX - state.drag.x, innerWidth - host.offsetWidth));
        const y = Math.max(0, Math.min(event.clientY - state.drag.y, innerHeight - host.offsetHeight));
        host.style.left = `${x}px`;
        host.style.top = `${y}px`;
        host.style.right = 'auto';
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        handle.addEventListener(name, () => { state.drag = null; });
    }

    function parseProductLink(href) {
        try {
            const url = new URL(href, location.href);
            if (url.origin !== location.origin || !url.pathname.startsWith('/packages/')) return null;
            const last = decodeURIComponent(url.pathname.replace(/\/+$/, '').split('/').pop());
            const match = last.match(/(?:^|-)(\d+)$/);
            return match ? { id: match[1], url: url.origin + url.pathname } : null;
        } catch { return null; }
    }

    function uniqueProductIds(element) {
        const ids = new Set();
        for (const link of element.querySelectorAll('a[href*="/packages/"]')) {
            const p = parseProductLink(link.getAttribute('href'));
            if (p) ids.add(p.id);
            if (ids.size > 1) break;
        }
        return ids;
    }

    function hasFreePrice(element) {
        const priceNodes = [...element.querySelectorAll(PRICE_SELECTORS.join(','))];
        if (priceNodes.some(node => /(?:[$£€]\s*\d|\d[,.]\d{2})/.test(node.textContent))) return false;
        if (priceNodes.some(node => /^free$/i.test(node.textContent.trim()))) return true;
        for (const node of element.querySelectorAll('span,small,strong,div,p')) {
            if (node.children.length === 0 && /^free$/i.test(node.textContent.trim())) return true;
        }
        return false;
    }

    function hasOwnedAction(element) {
        for (const node of element.querySelectorAll('button,a,[role="button"]')) {
            const t = (node.getAttribute('aria-label') || node.textContent || '').trim();
            if (/^(open in unity|import|download|re-download|in my assets|view in my assets)$/i.test(t)) return true;
        }
        return false;
    }

    function extractName(element, matchedLink) {
        const t = element.querySelector('[data-test="package-title"], [data-testid="package-title"], [class*="packageName"]');
        if (t && t.textContent.trim()) return t.textContent.trim();
        const label = matchedLink.getAttribute('aria-label') || matchedLink.getAttribute('title') || matchedLink.textContent;
        return (label || '').trim().replace(/\s+/g, ' ').slice(0, 180) || 'Untitled asset';
    }

    function getCandidates() {
        const selected = new Map();
        for (const selector of CARD_SELECTORS) {
            for (const element of document.querySelectorAll(selector)) {
                const ids = uniqueProductIds(element);
                if (ids.size !== 1 || !hasFreePrice(element) || hasOwnedAction(element)) continue;
                const link = [...element.querySelectorAll('a[href*="/packages/"]')].find(a => parseProductLink(a.getAttribute('href')));
                if (!link) continue;
                const product = parseProductLink(link.getAttribute('href'));
                selected.set(product.id, { ...product, name: extractName(element, link), element });
            }
        }
        for (const link of document.querySelectorAll('a[href*="/packages/"]')) {
            const product = parseProductLink(link.getAttribute('href'));
            if (!product || selected.has(product.id)) continue;
            if (link.closest(CARD_SELECTORS.join(','))) continue;
            let parent = link.parentElement;
            for (let depth = 0; parent && depth < 7; parent = parent.parentElement, depth++) {
                if (uniqueProductIds(parent).size > 1) break;
                if (hasFreePrice(parent)) {
                    if (!hasOwnedAction(parent)) {
                        selected.set(product.id, { ...product, name: extractName(parent, link), element: parent });
                    }
                    break;
                }
            }
        }
        return [...selected.values()];
    }

    function resultsRange() {
        const candidates = [
            ...document.querySelectorAll('[data-test*="results"], [data-testid*="results"], [class*="resultCount"], [class*="ResultCount"], [class*="resultsCount"]'),
            document.body
        ];
        for (const element of candidates) {
            const text = element?.innerText || element?.textContent || '';
            const match = text.match(/(?:results?\s*:?\s*)?(\d[\d,]*)\s*[–—\-]\s*(\d[\d,]*)\s+of\s+(\d[\d,]*)\s*(?:results?)?/i);
            if (!match) continue;
            const numbers = match.slice(1).map(value => Number(value.replaceAll(',', '')));
            if (numbers[0] >= 1 && numbers[1] >= numbers[0] && numbers[2] >= numbers[1]) {
                return { start: numbers[0], end: numbers[1], total: numbers[2] };
            }
        }
        return null;
    }

    function listingIdentity() {
        const productIds = new Set();
        for (const link of document.querySelectorAll('a[href*="/packages/"]')) {
            const product = parseProductLink(link.getAttribute('href'));
            if (product) productIds.add(product.id);
        }
        const range = resultsRange();
        const activePage = document.querySelector('[aria-current="page"]');
        const url = new URL(location.href);
        return JSON.stringify({
            url: url.pathname + url.search,
            range: range ? `${range.start}-${range.end}-${range.total}` : '',
            active: activePage?.textContent?.trim() || '',
            ids: [...productIds].sort()
        });
    }

    function listingContentKey(identity) {
        const ids = JSON.parse(identity).ids;
        return ids.length ? JSON.stringify(ids) : null;
    }

    function enabled(element) {
        return Boolean(element && !element.disabled &&
            element.getAttribute('aria-disabled') !== 'true' &&
            !element.closest('[disabled], [aria-disabled="true"]') &&
            element.getClientRects().length &&
            getComputedStyle(element).visibility !== 'hidden');
    }

    function paginationRoot(element) {
        return element.closest('nav, [role="navigation"], [class*="pagination"], [class*="Pagination"], [data-test*="pagination"], [data-testid*="pagination"]');
    }

    function paginationPageNumber() {
        const params = new URL(location.href).searchParams;
        for (const key of ['page', 'pageNumber', 'pageIndex', 'p']) {
            const value = Number(params.get(key));
            if (Number.isInteger(value) && value > 0) return value;
        }
        const active = document.querySelector('[aria-current="page"]');
        if (active && /^\d{1,6}$/.test(active.textContent.trim())) return Number(active.textContent.trim());
        const range = resultsRange();
        if (range?.start === 1) return 1;
        if (range && range.end > range.start) {
            const rows = range.end - range.start + 1;
            const computed = Math.floor((range.start - 1) / rows) + 1;
            if (computed >= 1) return computed;
        }
        return state.currentPaginationPage || 1;
    }

    function nextPageControl() {
        const explicitSelectors = [
            'button[label="Next"]', 'button[aria-label="Next"]',
            'button[aria-label="Next page"]', 'a[aria-label="Next page"]',
            'a[rel="next"]', 'button[title="Next"]',
            '[data-test="pagination-next"]', '[data-testid="pagination-next"]',
            'button[data-test="next-page"]', 'button[data-testid="next-page"]'
        ];
        for (const selector of explicitSelectors) {
            const control = [...document.querySelectorAll(selector)].find(enabled);
            if (control) return control;
        }

        const allControls = [...document.querySelectorAll('button, a, [role="button"]')].filter(enabled);
        const paginationControls = allControls.filter(paginationRoot);
        const nextPattern = /^(?:next(?:\s+page)?|›|»|→|➡|⟩)$/i;
        const labelOf = control => [
            control.getAttribute('aria-label'), control.getAttribute('title'),
            control.getAttribute('label'), control.getAttribute('data-test'),
            control.getAttribute('data-testid'), control.textContent
        ].filter(Boolean).map(s => s.trim());
        for (const control of paginationControls) {
            const labels = labelOf(control);
            if (labels.some(label => nextPattern.test(label) || /(?:^|[-_])(?:pagination[-_])?next(?:[-_](?:page|button))?(?:$|[-_])/i.test(label))) return control;
            const icon = control.querySelector('svg, [class*="icon"], [class*="Icon"]');
            const iconDesc = icon ? [icon.getAttribute('aria-label'), icon.getAttribute('data-icon'), icon.getAttribute('class'), icon.outerHTML.slice(0, 350)].filter(Boolean).join(' ') : '';
            if (/(?:chevron[-_]?right|arrow[-_]?right|angle[-_]?right|arrow_forward|keyboard_arrow_right|navigate_next)/i.test(iconDesc)) return control;
        }

        const numbered = paginationControls
            .filter(el => /^\d{1,6}$/.test(el.textContent.trim()))
            .map(el => ({ el, n: Number(el.textContent.trim()), root: paginationRoot(el) }));
        const byRoot = new Map();
        for (const item of numbered) {
            if (!byRoot.has(item.root)) byRoot.set(item.root, []);
            byRoot.get(item.root).push(item);
        }
        for (const items of byRoot.values()) {
            if (items.length < 2) continue;
            const active = items.find(({ el }) => {
                const cls = typeof el.className === 'string' ? el.className : '';
                const parentClass = typeof el.parentElement?.className === 'string' ? el.parentElement.className : '';
                return el.getAttribute('aria-current') === 'page' ||
                    el.getAttribute('aria-selected') === 'true' ||
                    el.getAttribute('aria-pressed') === 'true' ||
                    /(^|[\s_-])(active|selected|current)([\s_-]|$)/i.test(cls + ' ' + parentClass);
            });
            const current = active?.n || paginationPageNumber();
            const target = items.find(item => item.n === current + 1);
            if (target) return target.el;
        }
        return null;
    }

    function getCSRF() {
        const cookie = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('_csrf='));
        if (!cookie) return null;
        try { return decodeURIComponent(cookie.slice('_csrf='.length)); }
        catch { return cookie.slice('_csrf='.length); }
    }

    function errorFromResponse(data) {
        if (!data || typeof data !== 'object') return 'Unexpected server response';
        return Array.isArray(data.errors) && data.errors.length ? data.errors.map(x => x?.message || 'GraphQL error').join('; ').slice(0, 300) : 'No entitlement returned';
    }

    async function redeemOne(asset, signal) {
        if (!validProductId(asset?.id)) throw new Error('Invalid Unity product ID');
        const csrf = getCSRF();
        if (!csrf) throw Object.assign(new Error('No CSRF cookie. Sign in to Unity and refresh.'), { fatal: true });
        let response;
        try {
            response = await fetch(GRAPHQL_URL, {
                method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
                headers: {
                    'Content-Type': 'application/json', 'Accept': 'application/json',
                    'operations': 'AddToDownload', 'x-csrf-token': csrf,
                    'x-requested-with': 'XMLHttpRequest', 'x-source': 'storefront, storefront'
                },
                body: JSON.stringify({ query: MUTATION, operationName: 'AddToDownload', variables: { id: asset.id } })
            });
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            throw Object.assign(new Error(`Network request failed: ${error.message}`), { retryable: true });
        }
        if (response.status === 401 || response.status === 403 || response.status === 419) {
            throw Object.assign(new Error(`Unity rejected authentication (${response.status}). Sign in again or accept Unity's terms.`), { fatal: true });
        }
        if (response.status === 429 || response.status >= 500) {
            throw Object.assign(new Error(`Unity temporarily unavailable (HTTP ${response.status})`), {
                retryable: true, retryAfter: parseRetryAfter(response.headers.get('Retry-After'))
            });
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let data;
        try { data = await response.json(); } catch { throw new Error('Unity returned non-JSON response'); }
        if (!(Array.isArray(data?.errors) && data.errors.length) && String(data?.data?.addToDownload?.id || '') === String(asset.id)) return;
        const reason = errorFromResponse(data);
        if (/already (owned|purchased|added)|already in (?:your |the )?(?:assets|library)|already (?:owned|purchased) by/i.test(reason)) {
            throw Object.assign(new Error(reason), { alreadyOwned: true });
        }
        throw new Error(reason);
    }

    const active = token => state.running && token === state.token;
    async function pause(ms, token) {
        for (let remaining = ms; remaining > 0 && active(token); remaining -= 200) await sleep(Math.min(200, remaining));
        return active(token);
    }

    async function redeemWithRetry(asset, token) {
        for (let attempt = 0; attempt <= 2; attempt++) {
            if (!active(token)) return 'stopped';
            const controller = new AbortController();
            state.aborter = controller;
            try {
                await redeemOne(asset, controller.signal);
                return 'claimed';
            } catch (error) {
                if (!active(token) || error.name === 'AbortError') return 'stopped';
                if (error.alreadyOwned) return 'owned';
                if (error.fatal) throw error;
                if (error.retryable && attempt < 2) {
                    if (error.retryAfter > 60000) throw new Error(`Unity requested a retry after ${Math.ceil(error.retryAfter / 1000)} seconds. Wait before starting again.`);
                    const waitMs = error.retryAfter || (2000 * 2 ** attempt + Math.floor(Math.random() * 600));
                    addEvent('skip', `Retrying ${asset.name} after ${Math.ceil(waitMs / 1000)}s (${error.message})`);
                    if (!(await pause(waitMs, token))) return 'stopped';
                    continue;
                }
                if (error.retryable) throw new Error(`${error.message}. Retries exhausted; wait before starting again.`);
                return { failure: error.message };
            } finally {
                if (state.aborter === controller) state.aborter = null;
            }
        }
        return { failure: 'Retries exhausted' };
    }

    async function waitForPageChange(before, token, timeoutMs = 30000) {
        let stableIdentity = null;
        let stableSamples = 0;
        for (let waited = 0; waited < timeoutMs && active(token); waited += 400) {
            await sleep(400);
            const after = listingIdentity();
            const beforeData = JSON.parse(before);
            const afterData = JSON.parse(after);
            const resultsChanged = afterData.ids.join(',') !== beforeData.ids.join(',') ||
                afterData.range !== beforeData.range || afterData.active !== beforeData.active;
            const beforeHasProducts = beforeData.ids.length > 0;
            if (after !== before && (resultsChanged || !beforeHasProducts) && afterData.ids.length > 0) {
                if (after === stableIdentity) stableSamples++;
                else { stableIdentity = after; stableSamples = 1; }
                if (stableSamples >= 3) {
                    await pause(1000, token);
                    return active(token) && listingIdentity() === after;
                }
            } else {
                stableIdentity = null;
                stableSamples = 0;
            }
        }
        return false;
    }

    function clearResume() {
        try { sessionStorage.removeItem(RESUME_KEY); } catch {}
    }

    async function run(resumeData = null) {
        if (state.running) return;
        clearResume();
        saveSettings();
        const token = ++state.token;
        state.running = true;
        state.aborter = null;
        state.page = Number(resumeData?.page) || 0;
        state.currentPaginationPage = Number(resumeData?.nextPaginationPage) || paginationPageNumber();
        state.current = 0;
        state.total = 0;
        state.successes = Number(resumeData?.claimed) || 0;
        state.failures = Number(resumeData?.failed) || 0;
        state.skipped = Number(resumeData?.skipped) || 0;
        state.currentName = '';
        const processed = new Set([...knownIds, ...(Array.isArray(resumeData?.processed) ? resumeData.processed : [])]);
        const seenPages = new Set(Array.isArray(resumeData?.seenPages) ? resumeData.seenPages : []);
        const seenContent = new Set([...seenPages].map(listingContentKey).filter(Boolean));
        setStatus('Scanning the current page...', 'running');
        try {
            while (active(token)) {
                const signature = listingIdentity();
                const contentKey = listingContentKey(signature);
                if (seenPages.has(signature) || (contentKey && seenContent.has(contentKey))) {
                    setStatus('Stopped: page repeated. No more claims attempted.', 'error');
                    break;
                }
                seenPages.add(signature);
                if (contentKey) seenContent.add(contentKey);
                state.page++;
                if (state.page > Math.max(1, Math.min(300, Number(settings.maxPages) || 100))) {
                    setStatus('Stopped at the maximum page safety limit.', 'error');
                    break;
                }
                const items = getCandidates();
                state.lastScan = items;
                state.total = items.length;
                state.current = 0;
                state.currentName = '';
                setStatus(`Page ${state.page}: ${items.length} free candidates`, 'running');
                addEvent('info', `Page ${state.page}: found ${items.length} free candidates`);
                for (const asset of items) {
                    if (!active(token)) break;
                    state.currentName = asset.name;
                    setStatus(`Page ${state.page}: ${state.current + 1}/${state.total} | ${asset.name}`, 'running');
                    if (processed.has(asset.id)) {
                        state.skipped++;
                        addEvent('skip', `Skipped duplicate/claimed: ${asset.name}`);
                    } else if (settings.preview) {
                        processed.add(asset.id);
                        state.skipped++;
                        addEvent('info', `Preview: ${asset.name} (${asset.id})`);
                    } else {
                        processed.add(asset.id);
                        const result = await redeemWithRetry(asset, token);
                        if (result === 'stopped') break;
                        if (result === 'claimed') {
                            state.successes++;
                            addHistory(asset, 'claimed');
                            addEvent('ok', `Claimed: ${asset.name}`);
                        } else if (result === 'owned') {
                            state.skipped++;
                            addHistory(asset, 'skipped', 'Already owned');
                            addEvent('skip', `Already owned: ${asset.name}`);
                        } else {
                            state.failures++;
                            addHistory(asset, 'failed', result.failure);
                            addEvent('fail', `Failed: ${asset.name} | ${result.failure}`);
                        }
                    }
                    state.current++;
                    state.currentName = '';
                    render();
                    if (state.current < state.total && !(await pause(Math.max(500, settings.delay || 1500), token))) break;
                }
                if (!active(token)) break;
                if (!settings.allPages) {
                    setStatus(`Complete: ${state.successes} claimed, ${state.skipped} skipped, ${state.failures} failed.`);
                    break;
                }
                const next = nextPageControl();
                if (!next) {
                    const range = resultsRange();
                    if (range && range.end < range.total) {
                        setStatus(`Stopped: more results exist (${range.end}/${range.total}), but the Next control was not found.`, 'error');
                        addEvent('fail', 'Pagination control missing. The remaining pages have not been processed.');
                    } else {
                        setStatus(`Finished all available pages. ${state.successes} claimed, ${state.skipped} skipped, ${state.failures} failed.`);
                    }
                    break;
                }
                const beforePage = listingIdentity();
                const intendedPage = paginationPageNumber() + 1;
                setStatus(`Page ${state.page} finished. Moving to next page...`, 'running');
                if (!(await pause(1200, token))) break;
                try {
                    sessionStorage.setItem(RESUME_KEY, JSON.stringify({
                        time: Date.now(), url: location.href, signature, allPages: settings.allPages,
                        preview: settings.preview, claimed: state.successes, skipped: state.skipped,
                        failed: state.failures, page: state.page,
                        nextPaginationPage: intendedPage,
                        processed: [...processed], seenPages: [...seenPages]
                    }));
                } catch {}
                next.click();
                if (!(await waitForPageChange(beforePage, token))) {
                    clearResume();
                    setStatus('Stopped: next page did not load or contained the same results.', 'error');
                    break;
                }
                clearResume();
                state.currentPaginationPage = intendedPage;
            }
        } catch (error) {
            if (active(token)) {
                setStatus(`Stopped: ${error.message}`, 'error');
                addEvent('fail', error.message);
            }
            clearResume();
        } finally {
            if (token === state.token) {
                state.running = false;
                state.aborter = null;
                state.currentName = '';
                if (state.severity === 'running') setStatus(`Finished: ${state.successes} claimed, ${state.skipped} skipped, ${state.failures} failed.`);
                render();
            }
        }
    }

    function stop() {
        if (!state.running) return;
        ++state.token;
        state.running = false;
        state.aborter?.abort();
        state.aborter = null;
        state.currentName = '';
        clearResume();
        setStatus(`Stopped. ${state.successes} claimed, ${state.skipped} skipped, ${state.failures} failed.`);
        addEvent('info', 'Stopped by user. A request already sent may still be processed by Unity.');
    }

    function scan() {
        const items = getCandidates();
        state.lastScan = items;
        state.current = 0;
        state.total = items.length;
        state.currentName = '';
        const known = items.filter(item => knownIds.has(item.id)).length;
        setStatus(`${items.length} free candidates found, ${known} previously confirmed owned. Remaining ownership checked by Unity.`);
        addEvent('info', `Scan complete: ${items.length} free candidates`);
        for (const item of items.slice(0, 25)) addEvent('info', `${item.name} (${item.id})`);
    }

    $('scan').addEventListener('click', scan);
    $('start').addEventListener('click', () => run());
    $('stop').addEventListener('click', stop);
    $('history-count').textContent = String(assets.length);
    updateCacheCount();
    renderLog();
    render();

    if (globalThis.__UNITY_ASSET_REDEEMER_TEST__) {
        globalThis.__UNITY_ASSET_REDEEMER_TEST_API__ = Object.freeze({
            errorFromResponse,
            getCandidates,
            hasFreePrice,
            hasOwnedAction,
            listingIdentity,
            listingContentKey,
            nextPageControl,
            parseProductLink,
            parseRetryAfter,
            redeemOne,
            validProductId
        });
    }

    const resume = readJSON(sessionStorage, RESUME_KEY, null);
    const resumeSameListing = resume && (() => {
        try { return new URL(resume.url).pathname === location.pathname; } catch { return false; }
    })();
    if (resume && Date.now() - resume.time < 60000 && location.href !== resume.url && resumeSameListing) {
        settings.allPages = resume.allPages;
        settings.preview = resume.preview;
        $('pages').checked = settings.allPages;
        $('preview').checked = settings.preview;
        clearResume();
        addEvent('info', 'Resuming after page navigation.');
        setTimeout(async () => {
            for (let n = 0; n < 30 && getCandidates().length === 0; n++) await sleep(500);
            run(resume);
        }, 1400);
    } else if (resume) {
        clearResume();
    }
})();
