/**
 * Browser regressions for the study's navigation, reading, layout and fallbacks.
 * Requires Node 22+ (built-in fetch/WebSocket), a running static server and an
 * isolated Chrome with WebGL2. No packages or browser extension are required.
 *
 * Terminal 1: python3 -m http.server 8765 --bind 127.0.0.1
 * Terminal 2 (macOS example):
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9223 \
 *     --user-data-dir=/tmp/connerald-browser-regression about:blank
 * Terminal 3: node tests/browser-regression.mjs
 *
 * Optional: CHROME_DEBUG_URL=http://127.0.0.1:9223 SITE_URL=http://127.0.0.1:8765/
 * REGRESSION_FILTER=<name fragment> selects a self-contained group for diagnosis.
 * The script creates and closes its own page; it never reuses existing tabs.
 * Fault injection and viewport emulation affect that owned page only.
 */
import assert from 'node:assert/strict';

const debugUrl = new URL(process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9223');
const siteUrl = new URL(process.env.SITE_URL || 'http://127.0.0.1:8765/');
siteUrl.searchParams.set('lang', 'zh');
siteUrl.hash = '';
const appUrl = new URL('./assets/app.js', siteUrl).href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exceptions = [];
const projectIds = ['anchorcell', 'battery', 'cara', 'tsinglink', 'crypto', 'behavior', 'paper'];
const sectionIds = ['projects', 'about', 'experience', 'learning', 'contact'];
const spreadQuery = '(min-width: 1024px) and (min-height: 720px)';
const testFilter = process.env.REGRESSION_FILTER || '';
let target, socket, cdp, currentTest = 'setup', passed = 0;

async function debuggerRequest(path, options = {}) {
  const response = await fetch(new URL(path, debugUrl), {
    ...options,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Chrome debugger ${path}: HTTP ${response.status}`);
  return response;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timeout);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) || []) {
          listener(message.params);
        }
      }
    });
    ws.addEventListener('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error('Chrome closed the test connection'));
      }
      this.pending.clear();
    });
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method).delete(listener);
  }
  once(method, predicate = () => true) {
    return new Promise((resolve, reject) => {
      const remove = this.on(method, params => {
        if (!predicate(params)) return;
        clearTimeout(timeout);
        remove();
        resolve(params);
      });
      const timeout = setTimeout(() => {
        remove();
        reject(new Error(`Timed out waiting for ${method}`));
      }, 10000);
    });
  }
  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails;
      throw new Error(detail.exception?.description || detail.text);
    }
    return response.result.value;
  }
  async waitFor(expression, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return;
      await pause(40);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }
  async move(x, y) {
    await this.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  }
  async click(selector) {
    const center = await this.evaluate(`(async () => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) throw Error('Missing click target');
      // Wait for a moving drawer/ancestor, not descendants such as a page-turn
      // leaf: closing a book during its turn is itself a regression scenario.
      const settling = [];
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        for (const animation of ancestor.getAnimations()) {
          if (animation.playState === 'running' && Number.isFinite(animation.effect.getComputedTiming().endTime)) {
            settling.push(animation.finished.catch(() => {}));
          }
        }
      }
      await Promise.all(settling);
      const before = node.getBoundingClientRect();
      if (before.top < 0 || before.bottom > innerHeight || before.left < 0 || before.right > innerWidth) {
        node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) throw Error('Hidden click target');
      return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
    })()`);
    await this.move(center.x, center.y);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.call('Input.dispatchMouseEvent', {
        type, ...center, button: 'left', clickCount: 1,
      });
    }
  }
  async key(key, windowsVirtualKeyCode) {
    for (const type of ['keyDown', 'keyUp']) {
      await this.call('Input.dispatchKeyEvent', {
        type, key, code: key, windowsVirtualKeyCode,
      });
    }
  }
}

async function viewport(cdp, width, height) {
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
}

async function navigate(cdp, { lang = 'zh', route = '', scene = true } = {}) {
  const url = new URL(siteUrl);
  url.searchParams.set('lang', lang);
  url.hash = route;
  // A fresh document makes these real entry/deep-link checks, without racing
  // same-document hash navigation against an immediately requested reload.
  const cleared = cdp.once('Page.loadEventFired');
  await cdp.call('Page.navigate', { url: 'about:blank' });
  await cleared;
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.call('Page.navigate', { url: url.href });
  await loaded;
  await cdp.waitFor(`location.href === ${JSON.stringify(url.href)}`, 'the requested URL');
  await cdp.waitFor(`document.documentElement.classList.contains('enhanced')`, 'the enhanced document');
  if (scene) await cdp.waitFor(`document.querySelector('#scene')?.dataset.ready === 'true'`, 'the room');
  if (route) await cdp.waitFor(`document.querySelector('#reader').open && !!document.querySelector('#reader-title')`, `reader for ${route}`);
}

async function noHorizontalOverflow(cdp, label) {
  const problems = await cdp.evaluate(`(() => {
    const selectors = ['html', '#reader[open]', '#directory[open]', '#reader[open] .paper-page', '#reader[open] .flow', '#reader[open] .tags'];
    return selectors.flatMap(selector => [...document.querySelectorAll(selector)]
      .filter(node => node.getBoundingClientRect().width > 0 && node.scrollWidth > node.clientWidth + 2)
      .map(node => ({ selector, width: node.clientWidth, scrollWidth: node.scrollWidth })));
  })()`);
  assert.deepEqual(problems, [], `${label}: horizontal overflow`);
}

async function withStartupScript(cdp, source, body) {
  const { identifier } = await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source });
  try { await body(); }
  finally { await cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
}

const visibleChapter = `(() => {
  const reader = document.querySelector('#reader');
  const toolbar = reader.querySelector('.reader-toolbar').getBoundingClientRect();
  const chapters = [...reader.querySelectorAll('.spread[data-chapter]')];
  const visible = chapters.find(node => node.getBoundingClientRect().bottom > toolbar.bottom + 24);
  return visible ? Number(visible.dataset.chapter) : null;
})()`;

async function test(name, body) {
  if (testFilter && !name.includes(testFilter)) return;
  currentTest = name;
  await body();
  passed++;
  console.log(`PASS ${name}`);
}

try {
  if (typeof WebSocket !== 'function') throw new Error('Use Node 22 or newer.');
  target = await (await debuggerRequest('/json/new?about:blank', { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Cannot connect to test page')), { once: true });
  });
  cdp = new CDP(socket);
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    exceptions.push({ test: currentTest, ...exceptionDetails });
  });
  await cdp.call('Runtime.enable');
  await cdp.call('Page.enable');
  await cdp.call('Network.enable');
  await cdp.call('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.call('Page.bringToFront');
  await cdp.call('Page.navigate', { url: siteUrl.href });
  const ready = `!!window.studyRoom && document.querySelector('#scene')?.dataset.ready === 'true'`;
  await cdp.waitFor(ready, 'the Three.js room (requires Chrome WebGL2)');
  await pause(600);

  await test('all eight bottom-edge hover targets remain stationary', async () => {
    const ids = await cdp.evaluate(`[...document.querySelectorAll('.hotspot')].map(node => node.dataset.entry)`);
    assert.equal(ids.length, 8);
    for (const id of ids) {
      await cdp.move(12, 120);
      await pause(180);
      await cdp.evaluate(`(() => {
        const node = [...document.querySelectorAll('.hotspot')].find(node => node.dataset.entry === ${JSON.stringify(id)});
        window.__hoverProbe = { enters: 0, leaves: 0, samples: [] };
        const probe = window.__hoverProbe;
        const enter = () => probe.enters++;
        const leave = () => probe.leaves++;
        node.addEventListener('pointerenter', enter);
        node.addEventListener('pointerleave', leave);
        probe.cleanup = () => {
          node.removeEventListener('pointerenter', enter);
          node.removeEventListener('pointerleave', leave);
          clearInterval(probe.timer);
        };
        const sample = () => {
          const rect = node.getBoundingClientRect();
          probe.samples.push([rect.x + rect.width / 2, rect.y + rect.height / 2]);
        };
        sample();
        probe.timer = setInterval(sample, 16);
      })()`);
      const [x, y] = await cdp.evaluate('window.__hoverProbe.samples[0]');
      await cdp.move(x, y + 21);
      await pause(500);
      const probe = await cdp.evaluate(`(() => {
        const probe = window.__hoverProbe;
        probe.cleanup();
        const node = [...document.querySelectorAll('.hotspot')].find(node => node.dataset.entry === ${JSON.stringify(id)});
        const label = node.querySelector('.hotspot-label');
        return { enters: probe.enters, leaves: probe.leaves, samples: probe.samples,
          hovered: node.matches(':hover'), labelOpacity: Number(getComputedStyle(label).opacity) };
      })()`);
      assert.equal(probe.enters, 1, `${id}: pointer should enter once`);
      assert.equal(probe.leaves, 0, `${id}: stationary pointer must not leave`);
      assert.equal(probe.hovered, true, `${id}: bottom edge stays hovered`);
      assert.ok(probe.labelOpacity > 0.95, `${id}: label remains visible`);
      for (const [sampleX, sampleY] of probe.samples) {
        assert.ok(Math.hypot(sampleX - x, sampleY - y) < 0.25,
          `${id}: hit target moved while its object was animating`);
      }
    }
    await cdp.move(12, 120);
  });

  await test('real pointer click opens the project and Escape returns to room', async () => {
    await cdp.click('[data-entry="project/anchorcell"]');
    await cdp.waitFor(`document.querySelector('#reader').open`, 'the project reader');
    assert.equal(await cdp.evaluate(`document.querySelector('#reader-title').textContent`), 'AnchorCell');
    await cdp.key('Escape', 27);
    await cdp.waitFor(`!document.querySelector('#reader').open`, 'Escape to close the reader');
  });

  await test('slow entry module displays the room poster without a document flash', async () => {
    await cdp.call('Fetch.enable', {
      patterns: [{ urlPattern: `${appUrl}*`, requestStage: 'Request' }],
    });
    const paused = cdp.once('Fetch.requestPaused', params => params.request.url.startsWith(appUrl));
    await cdp.call('Page.reload', { ignoreCache: true });
    const request = await paused;
    try {
      await cdp.waitFor(`!!document.querySelector('#fallback') && !!document.styleSheets.length`, 'the boot document');
      await pause(300);
      const initial = await cdp.evaluate(`({
        booting: document.documentElement.classList.contains('booting'),
        enhanced: document.documentElement.classList.contains('enhanced'),
        shell: getComputedStyle(document.querySelector('.experience-shell')).display,
        fallback: getComputedStyle(document.querySelector('#fallback')).display
      })`);
      assert.equal(initial.booting, true);
      assert.equal(initial.enhanced, false);
      assert.notEqual(initial.shell, 'none');
      assert.equal(initial.fallback, 'none');
    } finally {
      await cdp.call('Fetch.continueRequest', { requestId: request.requestId });
      await cdp.call('Fetch.disable');
    }
    await cdp.waitFor(ready, 'the room after releasing its module');
    assert.equal(await cdp.evaluate(`document.documentElement.classList.contains('booting')`), false);
  });

  await test('failed entry module exposes the full readable HTML fallback', async () => {
    await cdp.call('Fetch.enable', {
      patterns: [{ urlPattern: `${appUrl}*`, requestStage: 'Request' }],
    });
    const paused = cdp.once('Fetch.requestPaused', params => params.request.url.startsWith(appUrl));
    await cdp.call('Page.reload', { ignoreCache: true });
    const request = await paused;
    try {
      await cdp.call('Fetch.failRequest', { requestId: request.requestId, errorReason: 'Failed' });
      await cdp.waitFor(`!document.documentElement.classList.contains('booting')`, 'the module error fallback', 3000);
      const failed = await cdp.evaluate(`({
        shell: getComputedStyle(document.querySelector('.experience-shell')).display,
        fallback: getComputedStyle(document.querySelector('#fallback')).display,
        readable: document.querySelector('#fallback').innerText.includes('AnchorCell'),
        enhanced: document.documentElement.classList.contains('enhanced')
      })`);
      assert.equal(failed.shell, 'none');
      assert.notEqual(failed.fallback, 'none');
      assert.equal(failed.readable, true);
      assert.equal(failed.enhanced, false);
    } finally {
      await cdp.call('Fetch.disable');
    }
    await cdp.call('Page.reload', { ignoreCache: true });
    await cdp.waitFor(ready, 'the restored room');
  });

  await test('paper turn preserves the old fixed page and ignores rapid reverse input', async () => {
    await cdp.click('[data-entry="project/anchorcell"]');
    await cdp.waitFor(`document.querySelector('#reader').open`, 'the project reader');
    await pause(600);
    await cdp.click('#next-page');
    const turning = await cdp.evaluate(`({
      fixedText: document.querySelector('.fixed-page.left')?.innerText || '',
      fixedWidth: document.querySelector('.fixed-page.left')?.getBoundingClientRect().width || 0,
      leafCount: document.querySelectorAll('.turning-leaf').length,
      previousDisabled: document.querySelector('#previous-page').disabled,
      nextDisabled: document.querySelector('#next-page').disabled,
      busy: document.querySelector('#book').getAttribute('aria-busy')
    })`);
    assert.ok(turning.fixedText.includes('AnchorCell'), 'old left page remains beneath the leaf');
    assert.ok(turning.fixedWidth > 0);
    assert.equal(turning.leafCount, 1);
    assert.equal(turning.previousDisabled, true);
    assert.equal(turning.nextDisabled, true);
    assert.equal(turning.busy, 'true');
    await cdp.evaluate(`document.querySelector('#reader-close').focus()`);
    await cdp.key('ArrowLeft', 37);
    assert.match(await cdp.evaluate(`document.querySelector('#page-count').textContent`), /^02\s*\//);
    await pause(750);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.turning-leaf,.fixed-page').length`), 0);
    assert.equal(await cdp.evaluate(`document.querySelector('#previous-page').disabled`), false);
    await cdp.key('ArrowLeft', 37);
    assert.match(await cdp.evaluate(`document.querySelector('#page-count').textContent`), /^01\s*\//);
    await pause(750);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.turning-leaf,.fixed-page').length`), 0);
  });

  await test('closing during a turn removes temporary layers and busy state', async () => {
    await cdp.click('#next-page');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.turning-leaf').length`), 1);
    await cdp.click('#reader-close');
    await cdp.waitFor(`!document.querySelector('#reader').open`, 'the reader to close');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.turning-leaf,.fixed-page').length`), 0);
    assert.equal(await cdp.evaluate(`document.querySelector('#book').hasAttribute('aria-busy')`), false);
  });

  await test('reduced motion changes pages without creating animated leaves', async () => {
    await cdp.call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await cdp.waitFor(`matchMedia('(prefers-reduced-motion: reduce)').matches`, 'the motion preference');
    await cdp.click('[data-entry="project/anchorcell"]');
    await cdp.waitFor(`document.querySelector('#reader').open`, 'the project reader');
    await cdp.click('#next-page');
    assert.match(await cdp.evaluate(`document.querySelector('#page-count').textContent`), /^02\s*\//);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.turning-leaf,.fixed-page').length`), 0);
    assert.equal(await cdp.evaluate(`document.querySelector('#previous-page').disabled`), false);
    await cdp.call('Emulation.setEmulatedMedia', { features: [] });
  });

  await test('page-turn copies preserve the scrolled position of both old pages', async () => {
    await navigate(cdp, { route: 'project/anchorcell' });
    await pause(600);
    const oldScroll = await cdp.evaluate(`(() => {
      return [...document.querySelectorAll('#book > .spread > .paper-page')].map((node, index) => {
        const spacer = document.createElement('div');
        spacer.style.height = '1000px';
        spacer.textContent = 'Scroll regression fixture';
        node.append(spacer);
        node.style.scrollBehavior = 'auto';
        node.scrollTop = 130 + index * 40;
        return node.scrollTop;
      });
    })()`);
    assert.equal(oldScroll.length, 2);
    assert.ok(oldScroll.every(value => value > 100), 'the fixture must actually scroll both pages');
    await cdp.click('#next-page');
    const copies = await cdp.evaluate(`[
      document.querySelector('.fixed-page.left > .paper-page')?.scrollTop,
      document.querySelector('.turning-leaf.forward .leaf-front > .paper-page')?.scrollTop
    ]`);
    assert.deepEqual(copies, oldScroll, 'animation copies keep the same visible text');
    await cdp.click('#reader-close');
  });

  await test('reader and directory retain the room return focus through nested navigation', async () => {
    await navigate(cdp);
    await cdp.click('[data-entry="project/anchorcell"]');
    await cdp.waitFor(`document.querySelector('#reader').open`, 'the reader');
    await cdp.click('#reader-index');
    await cdp.waitFor(`document.querySelector('#directory').open && !document.querySelector('#reader').open`, 'directory from reader');
    await cdp.key('Escape', 27);
    await cdp.waitFor(`document.querySelector('#reader').open && !document.querySelector('#directory').open`, 'reader restored after directory');
    assert.equal(await cdp.evaluate(`document.querySelector('#reader').contains(document.activeElement)`), true);
    await cdp.key('Tab', 9);
    assert.equal(await cdp.evaluate(`document.querySelector('#reader').contains(document.activeElement)`), true, 'Tab remains in the modal');
    await cdp.key('Escape', 27);
    await cdp.waitFor(`!document.querySelector('#reader').open`, 'reader closed');
    await cdp.waitFor(`document.activeElement?.dataset.entry === 'project/anchorcell'`, 'original hotspot focus');
    assert.equal(await cdp.evaluate(`document.querySelector('#menu-toggle').getAttribute('aria-expanded')`), 'false');
    await cdp.click('#menu-toggle');
    await cdp.key('Escape', 27);
    await cdp.waitFor(`document.activeElement?.id === 'menu-toggle'`, 'menu trigger focus');
  });

  for (const lang of ['zh', 'en']) {
    await test(`${lang}: all project, section and legacy deep links open readable content`, async () => {
      await viewport(cdp, 1440, 900);
      const routes = [...projectIds.map(id => `project/${id}`), ...sectionIds, 'featured', 'case-notes', 'education'];
      const titles = new Map();
      for (const route of routes) {
        await navigate(cdp, { lang, route });
        const state = await cdp.evaluate(`({
          language: document.documentElement.lang,
          title: document.querySelector('#reader-title').textContent.trim(),
          label: document.querySelector('#reader').getAttribute('aria-labelledby'),
          labelCount: document.querySelectorAll('#reader-title').length,
          textLength: document.querySelector('#book').innerText.trim().length,
          urlLanguage: new URL(location.href).searchParams.get('lang')
        })`);
        assert.equal(state.language, lang === 'zh' ? 'zh-CN' : 'en');
        assert.equal(state.urlLanguage, lang);
        assert.equal(state.label, 'reader-title');
        assert.equal(state.labelCount, 1, `${route}: one dialog title`);
        assert.ok(state.title.length > 0 && state.textLength > 40, `${route}: readable content`);
        titles.set(route, state.title);
        await noHorizontalOverflow(cdp, `${lang} ${route}`);
      }
      assert.equal(titles.get('featured'), titles.get('project/anchorcell'));
      assert.equal(titles.get('case-notes'), titles.get('project/anchorcell'));
      assert.equal(titles.get('education'), titles.get('learning'));
    });

    await test(`${lang}: responsive reading uses spreads only when width and height permit`, async () => {
      // 720×450 represents the effective layout viewport of 1440×900 at 200%;
      // this is viewport emulation, not an actual browser zoom setting.
      for (const [width, height] of [[320, 740], [390, 844], [700, 740], [701, 740], [834, 1112], [1023, 768], [1024, 719], [1024, 720], [1024, 768], [1440, 900], [1200, 630], [844, 390], [720, 450]]) {
        await viewport(cdp, width, height);
        await navigate(cdp, { lang, route: 'project/anchorcell' });
        const state = await cdp.evaluate(`(() => {
          const visible = node => !!node && !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
          const reader = document.querySelector('#reader');
          const rect = reader.getBoundingClientRect();
          const title = reader.querySelector('#reader-title');
          const titleRange = document.createRange(); titleRange.selectNodeContents(title);
          return {
            spread: matchMedia(${JSON.stringify(spreadQuery)}).matches,
            chapters: [...document.querySelectorAll('#book > .spread')].filter(visible).map(node => Number(node.dataset.chapter)),
            controls: ['previous-page', 'next-page', 'page-count'].map(id => visible(document.getElementById(id))),
            readerFits: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1,
            titleFits: titleRange.getBoundingClientRect().right <= title.getBoundingClientRect().right + 2,
            uniqueIds: [...document.querySelectorAll('[id]')].map(node => node.id).length === new Set([...document.querySelectorAll('[id]')].map(node => node.id)).size
          };
        })()`);
        assert.equal(state.spread, width >= 1024 && height >= 720);
        assert.deepEqual(state.chapters, state.spread ? [0] : [0, 1], `${width}×${height}: chapter order`);
        assert.deepEqual(state.controls, [state.spread, state.spread, state.spread], `${width}×${height}: page controls`);
        assert.equal(state.readerFits, true, `${width}×${height}: reader stays in viewport`);
        assert.equal(state.titleFits, true, `${width}×${height}: heading fits`);
        assert.equal(state.uniqueIds, true, 'rendered chapters do not duplicate IDs');
        await noHorizontalOverflow(cdp, `${lang} ${width}×${height}`);
      }
    });
  }

  await test('long headings and technical terms wrap in narrow and desktop readers', async () => {
    for (const [width, height] of [[320, 740], [834, 1112], [1024, 768], [1440, 900]]) {
      await viewport(cdp, width, height);
      await navigate(cdp, { lang: 'en', route: 'project/anchorcell' });
      await cdp.evaluate(`(() => {
        document.querySelector('#reader-title').textContent = 'A deliberately long project title for narrow screen regression coverage';
        const paragraph = document.querySelector('#book .paper-page p:not(.eyebrow)');
        paragraph.textContent = 'VeryLongTechnicalIdentifierWithoutWhitespace'.repeat(6);
      })()`);
      await noHorizontalOverflow(cdp, `long content at ${width}×${height}`);
    }
  });

  await test('language and layout changes retain the current chapter and deep-link URL', async () => {
    await viewport(cdp, 1440, 900);
    await navigate(cdp, { route: 'project/anchorcell' });
    await pause(600);
    await cdp.click('#next-page');
    await cdp.waitFor(`!document.querySelector('.turning-leaf')`, 'turn completion');
    await cdp.click('#reader [data-lang="en"]');
    assert.equal(await cdp.evaluate(`Number(document.querySelector('#book > .spread').dataset.chapter)`), 1);
    assert.equal(await cdp.evaluate(`new URL(location.href).searchParams.get('lang')`), 'en');
    assert.equal(await cdp.evaluate(`location.hash`), '#project/anchorcell');
    await viewport(cdp, 390, 844);
    await cdp.waitFor(`document.querySelectorAll('#book > .spread').length === 2`, 'continuous chapters');
    await cdp.waitFor(`${visibleChapter} === 1`, 'same chapter after narrowing');
    await cdp.click('#reader [data-lang="zh"]');
    await cdp.waitFor(`${visibleChapter} === 1`, 'same chapter after changing language');
    assert.equal(await cdp.evaluate(`new URL(location.href).searchParams.get('lang')`), 'zh');
    assert.equal(await cdp.evaluate(`location.hash`), '#project/anchorcell');
    await viewport(cdp, 1440, 900);
    await cdp.waitFor(`document.querySelectorAll('#book > .spread').length === 1`, 'spread restored');
    assert.equal(await cdp.evaluate(`Number(document.querySelector('#book > .spread').dataset.chapter)`), 1);
  });

  await test('layout changes while the directory is open preserve the resumed chapter', async () => {
    await viewport(cdp, 1440, 900);
    await navigate(cdp, { route: 'project/anchorcell' });
    await pause(600);
    await cdp.click('#next-page');
    await cdp.waitFor(`!document.querySelector('.turning-leaf')`, 'second spread');
    await cdp.click('#reader-index');
    await cdp.waitFor(`document.querySelector('#directory').open && !document.querySelector('#reader').open`, 'directory over second spread');
    await viewport(cdp, 390, 844);
    await cdp.waitFor(`document.querySelector('#reader').dataset.mode === 'continuous'`, 'hidden reader changes layout');
    await cdp.key('Escape', 27);
    await cdp.waitFor(`document.querySelector('#reader').open`, 'resumed continuous reader');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('#book > .spread').length`), 2);
    await cdp.waitFor(`${visibleChapter} === 1`, 'resumed second chapter');
    await cdp.click('#reader-index');
    await viewport(cdp, 1440, 900);
    await cdp.waitFor(`document.querySelector('#reader').dataset.mode === 'spread'`, 'hidden reader restores spreads');
    await cdp.key('Escape', 27);
    await cdp.waitFor(`document.querySelector('#reader').open`, 'resumed spread');
    assert.equal(await cdp.evaluate(`Number(document.querySelector('#book > .spread').dataset.chapter)`), 1);
  });

  await test('scrolling a desktop leaf survives same-mode resize and continuous reading', async () => {
    await viewport(cdp, 1440, 900);
    await navigate(cdp, { route: 'project/anchorcell' });
    const before = await cdp.evaluate(`(() => {
      const leaf = document.querySelector('#book > .spread > .paper-page:last-child');
      const spacer = document.createElement('div'); spacer.style.height = '1000px'; leaf.append(spacer);
      leaf.scrollTop = 160;
      return {top:leaf.scrollTop,ratio:leaf.scrollTop / (leaf.scrollHeight-leaf.clientHeight)};
    })()`);
    assert.ok(before.top > 100, 'the right leaf must actually scroll');
    await pause(100);
    await viewport(cdp, 1280, 800);
    await pause(100);
    const after = await cdp.evaluate(`(() => {
      const leaf = document.querySelector('#book > .spread > .paper-page:last-child');
      return {top:leaf.scrollTop,ratio:leaf.scrollTop / (leaf.scrollHeight-leaf.clientHeight)};
    })()`);
    assert.ok(after.top > 0, 'same-mode resize must not reset the leaf');
    assert.ok(Math.abs(before.ratio-after.ratio) < 0.02, 'same-mode resize retains scroll progress');
    await viewport(cdp, 390, 844);
    await cdp.waitFor(`document.querySelector('#reader').dataset.mode === 'continuous'`, 'continuous reader after leaf scroll');
    const active = await cdp.evaluate(`(() => {
      const top = document.querySelector('.reader-toolbar').getBoundingClientRect().bottom + 24;
      const leaf = [...document.querySelectorAll('#book .paper-page')].find(node => node.getBoundingClientRect().bottom > top);
      return {chapter:Number(leaf.parentElement.dataset.chapter),leaf:[...leaf.parentElement.children].indexOf(leaf)};
    })()`);
    assert.deepEqual(active, {chapter:0,leaf:1}, 'continuous reading resumes on the previously scrolled leaf');
  });

  await test('browser history restores content and language without a stuck modal', async () => {
    await navigate(cdp);
    await cdp.click('[data-entry="project/anchorcell"]');
    await cdp.click('#reader [data-lang="en"]');
    await cdp.click('#reader-close');
    await cdp.evaluate('history.back()');
    await cdp.waitFor(`document.querySelector('#reader').open && location.hash === '#project/anchorcell'`, 'back to project');
    assert.equal(await cdp.evaluate('document.documentElement.lang'), 'en');
    await cdp.evaluate('history.forward()');
    await cdp.waitFor(`!document.querySelector('#reader').open`, 'forward to room');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('dialog[open]').length`), 0);
  });

  await test('unknown and malformed hashes return to an operable room', async () => {
    await navigate(cdp, { route: 'project/anchorcell' });
    for (const hash of ['#project/unknown-project', '#%E0%A4%A']) {
      await cdp.evaluate(`location.hash = ${JSON.stringify(hash)}`);
      await cdp.waitFor(`!document.querySelector('#reader').open`, 'invalid route fallback');
      await cdp.click('#menu-toggle');
      await cdp.waitFor(`document.querySelector('#directory').open`, 'directory remains operable');
      await cdp.key('Escape', 27);
      await cdp.waitFor(`!document.querySelector('#directory').open`, 'directory closes');
    }
  });

  await test('Chinese interfaces omit redundant decorative English and localize accessible controls', async () => {
    await navigate(cdp, { route: 'learning' });
    const forbidden = /THE PROJECT INDEX|THE INDEX|A LITTLE ABOUT ME|A NOTE TO SAY HELLO|THE TOOLKIT|PERSONAL COLLECTION|ALWAYS IN PROGRESS/;
    assert.doesNotMatch(await cdp.evaluate(`document.querySelector('.experience-shell').innerText`), forbidden);
    const labels = await cdp.evaluate(`[...document.querySelectorAll('.language-switch')].map(node => node.getAttribute('aria-label'))`);
    assert.ok(labels.every(label => label && !/[a-z]/i.test(label)), 'Chinese language selectors have Chinese accessible labels');
    await cdp.click('#reader [data-lang="en"]');
    const englishLabels = await cdp.evaluate(`[...document.querySelectorAll('.language-switch')].map(node => node.getAttribute('aria-label'))`);
    assert.ok(englishLabels.every(label => label && !/[\u3400-\u9fff]/.test(label)), 'English language selectors have English accessible labels');
  });

  await test('English printing presents a complete single-language static document', async () => {
    await navigate(cdp, { lang: 'en', route: 'learning' });
    await cdp.call('Emulation.setEmulatedMedia', { media: 'print' });
    try {
      const print = await cdp.evaluate(`({
        visible:getComputedStyle(document.querySelector('#fallback')).display !== 'none',
        shellHidden:getComputedStyle(document.querySelector('.experience-shell')).display === 'none',
        text:document.querySelector('#fallback').innerText,
        links:[...document.querySelectorAll('#fallback a[href]')].map(node=>node.getAttribute('href'))
      })`);
      assert.equal(print.visible, true);
      assert.equal(print.shellHidden, true);
      assert.doesNotMatch(print.text, /[\u3400-\u9fff]/, 'English print output must not retain Chinese passages');
      for (const title of ['AnchorCell', 'TsingLink', 'CUFEpaper']) assert.ok(print.text.includes(title), `print includes ${title}`);
      assert.ok(print.links.some(href => href.startsWith('mailto:')), 'print retains contact details');
    } finally {
      await cdp.call('Emulation.setEmulatedMedia', { media: '' });
    }
  });

  await test('unavailable localStorage does not prevent URL language or reader navigation', async () => {
    await withStartupScript(cdp, `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked by test', 'SecurityError'); } });`, async () => {
      await navigate(cdp, { lang: 'en', route: 'project/anchorcell' });
      assert.equal(await cdp.evaluate('document.documentElement.lang'), 'en');
      await cdp.click('#reader [data-lang="zh"]');
      assert.equal(await cdp.evaluate('document.documentElement.lang'), 'zh-CN');
      assert.equal(await cdp.evaluate(`new URL(location.href).searchParams.get('lang')`), 'zh');
      await cdp.key('Escape', 27);
      await cdp.waitFor(`!document.querySelector('#reader').open`, 'close without storage');
    });
  });

  await test('unavailable WebGL keeps poster hotspots and English deep links usable', async () => {
    await withStartupScript(cdp, `(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return /webgl/i.test(type) ? null : original.call(this, type, ...args);
      };
    })();`, async () => {
      await navigate(cdp, { lang: 'en', route: 'project/anchorcell', scene: false });
      await cdp.waitFor(`document.querySelector('#room-main').classList.contains('room-fallback')`, 'static room fallback');
      assert.equal(await cdp.evaluate('document.documentElement.lang'), 'en');
      assert.equal(await cdp.evaluate(`document.querySelector('#reader-title').textContent.trim()`), 'AnchorCell');
      await cdp.key('Escape', 27);
      await cdp.waitFor(`!document.querySelector('#reader').open`, 'fallback reader close');
      assert.equal(await cdp.evaluate(`document.querySelectorAll('.hotspot').length`), 8);
      assert.equal(await cdp.evaluate(`document.querySelector('#lamp-toggle').hidden`), true);
      await cdp.click('[data-entry="contact"]');
      await cdp.waitFor(`document.querySelector('#reader').open && !!document.querySelector('#copy-email')`, 'fallback contact navigation');
    });
  });

  await test('a lost WebGL context falls back without losing reading or navigation', async () => {
    await navigate(cdp, { route: 'project/anchorcell' });
    const supported = await cdp.evaluate(`(() => {
      const canvas = document.querySelector('#scene canvas');
      const gl = canvas.getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) return false;
      extension.loseContext();
      return true;
    })()`);
    assert.equal(supported, true, 'isolated Chrome must support context-loss testing');
    await cdp.waitFor(`document.querySelector('#room-main').classList.contains('room-fallback')`, 'context-loss fallback');
    assert.equal(await cdp.evaluate(`document.querySelector('#reader').open`), true);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('#scene canvas').length`), 0);
    await cdp.click('#reader-close');
    await cdp.click('#menu-toggle');
    await cdp.waitFor(`document.querySelector('#directory').open`, 'directory after context loss');
    await cdp.click('#directory a[href="#experience"]');
    await cdp.waitFor(`document.querySelector('#reader').open && location.hash === '#experience'`, 'experience after context loss');
  });

  await test('disabled JavaScript exposes the readable static document', async () => {
    await cdp.call('Emulation.setScriptExecutionDisabled', { value: true });
    try {
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.call('Page.navigate', { url: siteUrl.href });
      await loaded;
      const fallback = await cdp.evaluate(`({
        visible: getComputedStyle(document.querySelector('#fallback')).display !== 'none',
        shellHidden: getComputedStyle(document.querySelector('.experience-shell')).display === 'none',
        text: document.querySelector('#fallback').innerText,
        email: !!document.querySelector('#fallback a[href^="mailto:"]'),
        enhanced: document.documentElement.classList.contains('enhanced')
      })`);
      assert.equal(fallback.visible, true);
      assert.equal(fallback.shellHidden, true);
      assert.equal(fallback.enhanced, false);
      assert.match(fallback.text, /AnchorCell/);
      assert.match(fallback.text, /TsingLink/);
      assert.match(fallback.text, /CUFEpaper/);
      assert.equal(fallback.email, true);
      await noHorizontalOverflow(cdp, 'no-JavaScript fallback');
    } finally {
      await cdp.call('Emulation.setScriptExecutionDisabled', { value: false });
    }
  });

  await pause(50);
  assert.ok(passed > 0, 'the test filter must match at least one group');
  assert.deepEqual(exceptions, [], 'unexpected uncaught browser exceptions');
  console.log(`Passed ${passed} browser regression groups; no uncaught exceptions.`);
} catch (error) {
  console.error(`FAIL ${currentTest}: ${error.stack || error}`);
  if (cdp && socket?.readyState === WebSocket.OPEN) {
    try {
      console.error('Page state:', JSON.stringify(await cdp.evaluate(`(() => {
        const reader = document.querySelector('#reader');
        return {url:location.href,viewport:[innerWidth,innerHeight],mode:reader?.dataset.mode,
          readerOpen:reader?.open,directoryOpen:document.querySelector('#directory')?.open,scrollTop:reader?.scrollTop,scrollHeight:reader?.scrollHeight,
          toolbarBottom:reader?.querySelector('.reader-toolbar')?.getBoundingClientRect().bottom,
          chapters:[...document.querySelectorAll('#book > .spread')].map(node => ({chapter:node.dataset.chapter,top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom}))};
      })()`)));
    } catch { /* A navigation or crashed target may make diagnostics unavailable. */ }
  }
  if (exceptions.length) console.error(JSON.stringify(exceptions, null, 2));
  process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (target?.id) {
    try { await debuggerRequest(`/json/close/${encodeURIComponent(target.id)}`); }
    catch (error) { console.error(`Could not close owned test page: ${error.message}`); }
  }
}
