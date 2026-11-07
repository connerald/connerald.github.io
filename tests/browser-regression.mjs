/**
 * Browser regressions for the study's hover, boot and page-turn flicker fixes.
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
 * The script creates and closes its own page; it never reuses existing tabs.
 */
import assert from 'node:assert/strict';

const debugUrl = new URL(process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9223');
const siteUrl = new URL(process.env.SITE_URL || 'http://127.0.0.1:8765/');
siteUrl.searchParams.set('lang', 'zh');
siteUrl.hash = '';
const appUrl = new URL('./assets/app.js', siteUrl).href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exceptions = [];
let target, socket, currentTest = 'setup', passed = 0;

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
    const center = await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) throw Error('Missing click target');
      const rect = node.getBoundingClientRect();
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

async function test(name, body) {
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
  const cdp = new CDP(socket);
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

  await pause(50);
  assert.deepEqual(exceptions, [], 'unexpected uncaught browser exceptions');
  console.log(`Passed ${passed} browser regression groups; no uncaught exceptions.`);
} catch (error) {
  console.error(`FAIL ${currentTest}: ${error.stack || error}`);
  if (exceptions.length) console.error(JSON.stringify(exceptions, null, 2));
  process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (target?.id) {
    try { await debuggerRequest(`/json/close/${encodeURIComponent(target.id)}`); }
    catch (error) { console.error(`Could not close owned test page: ${error.message}`); }
  }
}
