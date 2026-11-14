import * as THREE from './vendor/three.module.js';

// The study is built from original geometry and canvas textures. No remote models,
// images, fonts, or services are needed to explore it.
export async function createRoom({
  container, onSelect = () => {}, onPositions = () => {}, onReady = () => {},
  onError = () => {}, onLampChange = () => {}, reducedMotion = false,
}) {
  let renderer;
  try {
    // Capture explicitly renders in the same task, so the drawing buffer need not
    // remain allocated between frames.
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    onError(error);
    throw error;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.className = 'study-canvas';
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'pan-y' });
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f5f3ec');
  scene.fog = new THREE.Fog('#f5f3ec', 18, 35);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
  // Hit targets stay at the resting composition. Animating the object or the
  // parallax camera must never move a button out from under a stationary mouse.
  const hotspotCamera = camera.clone();
  const restMatrix = new THREE.Matrix4();
  const cameraHome = new THREE.Vector3();
  const cameraLook = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(5, 5);
  const pointerAim = new THREE.Vector2();
  const pointerCurrent = new THREE.Vector2();
  const targets = new Map();
  const pickables = [];
  const textures = [];
  const localizedDraws = [];
  const disposables = new Set();
  let width = 1, height = 1, portrait = false, disposed = false, paused = false;
  let frame = 0, lastTime = 0, activeId = null, hints = false, language = 'zh';
  let lampOn = true, pointerDown = null, hoveredId = null;

  const palette = {
    oak: '#c6ad87', brass: '#b8a079', paper: '#eee9dd', cream: '#fbf9f3',
  };

  function material(color, options = {}) {
    const result = new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0, ...options });
    disposables.add(result);
    return result;
  }
  function canvasTexture(w, h, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d');
    draw(context, w, h);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.push(texture);
    return texture;
  }
  function localizedTexture(w, h, draw) {
    const texture = canvasTexture(w, h, (ctx, width, height) => draw(ctx, width, height, false));
    localizedDraws.push(neutral => {
      const ctx = texture.image.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h, neutral);
      texture.needsUpdate = true;
    });
    return texture;
  }
  function redrawLabels(neutral = false) {
    for (const draw of localizedDraws) draw(neutral);
  }
  function grain(color, vertical = false) {
    return canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
      let seed = 17;
      const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 190; i++) {
        const start = random() * 256;
        ctx.strokeStyle = `rgba(${random() > .5 ? '240,214,173' : '40,25,15'},${random() * .035})`;
        ctx.lineWidth = random() * 2 + .3;
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(start, 0); ctx.bezierCurveTo(start + 5, 80, start - 4, 190, start + 1, 256);
        } else {
          ctx.moveTo(0, start); ctx.bezierCurveTo(80, start + 4, 180, start - 3, 256, start + 1);
        }
        ctx.stroke();
      }
    });
  }
  function mesh(geometry, mat, parent = scene, position = [0, 0, 0]) {
    disposables.add(geometry);
    const result = new THREE.Mesh(geometry, mat);
    result.position.set(...position);
    result.castShadow = true; result.receiveShadow = true;
    parent.add(result); return result;
  }
  const geometries = new Map();
  function box(w, h, d, mat, parent = scene, position = [0, 0, 0], radius = .025) {
    const r = Math.min(radius, w / 3, h / 3, d / 3);
    const key = [w, h, d, r].join(',');
    let geometry = geometries.get(key);
    if (!geometry) {
      const shape = new THREE.Shape();
      const x = -w / 2, y = -h / 2;
      shape.moveTo(x + r, y);
      shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
      shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
      shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
      geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(.001, d - 2 * r), bevelEnabled: true, bevelSize: r / 2, bevelThickness: r, bevelSegments: 2, steps: 1, curveSegments: 3 });
      geometry.translate(0, 0, -d / 2 + r);
      geometry.computeVertexNormals();
      geometries.set(key, geometry);
    }
    return mesh(geometry, mat, parent, position);
  }
  function cylinder(top, bottom, h, mat, parent, position, segments = 24) {
    return mesh(new THREE.CylinderGeometry(top, bottom, h, segments), mat, parent, position);
  }
  function sphere(radius, mat, parent, position, scale = [1, 1, 1]) {
    const result = mesh(new THREE.SphereGeometry(radius, 18, 12), mat, parent, position);
    result.scale.set(...scale); return result;
  }
  function plane(w, h, texture, parent, position, options = {}) {
    const result = mesh(new THREE.PlaneGeometry(w, h), material('#ffffff', { map: texture, side: THREE.DoubleSide, ...options }), parent, position);
    result.castShadow = false; return result;
  }
  function tube(points, radius, mat, parent) {
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 24, radius, 7, false), mat, parent);
  }
  function target(id, object, anchor = [0, 0, 0], options = {}) {
    const localMaterials = new Map();
    const entry = { id, object, anchor: new THREE.Vector3(...anchor), home: object.position.clone(), hover: 0, materials: localMaterials, ...options };
    targets.set(id, entry);
    object.traverse(node => {
      if (node.isMesh) {
        // Keep highlights local even when several objects share a paper material.
        if (!localMaterials.has(node.material)) {
          const original = node.material;
          const copy = original.clone();
          disposables.add(copy);
          localMaterials.set(original, { material: copy, emissive: copy.emissive.clone(), intensity: copy.emissiveIntensity });
        }
        node.material = localMaterials.get(node.material).material;
        node.userData.contentId = id; pickables.push(node);
      }
    });
    return entry;
  }

  const oak = material('#ffffff', { map: grain(palette.oak) });
  const shelfBack = material('#bda98d');
  const darkWood = material('#ffffff', { map: grain('#ae9478') });
  const deskWood = material('#ffffff', { map: grain('#c3aa88') });
  const paleWood = material('#d8c8af');
  const paper = material(palette.paper);
  const cream = material(palette.cream);
  const brass = material(palette.brass, { metalness: .35, roughness: .65 });
  const dark = material('#253030');

  scene.add(new THREE.HemisphereLight('#fffdf8', '#c8c6ba', 2.7));
  const sunlight = new THREE.DirectionalLight('#fff8ed', 2.0);
  sunlight.position.set(-4.5, 9, 7);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunlight.shadow.camera, { left: -8, right: 8, top: 9, bottom: -3, near: .1, far: 24 });
  sunlight.shadow.bias = -.0003; sunlight.shadow.normalBias = .025;
  sunlight.shadow.radius = 4;
  scene.add(sunlight);
  sunlight.target.position.set(1, 2, -1); scene.add(sunlight.target);
  const fillLight = new THREE.DirectionalLight('#e4ebee', .9);
  fillLight.position.set(6, 3, 5); scene.add(fillLight);

  // Room shell: a little depth in the wall and individual floorboards makes the
  // scene feel like a place, while keeping the geometry inexpensive.
  box(22, 10, .16, material('#ffffff', { map: grain('#f5f3ec') }), scene, [0, 4.8, -1.7], 0);
  const baseboard = box(22, .16, .12, material('#ddd6c8'), scene, [0, .15, -1.54], .015);
  const baseboardTrim = box(22, .045, .16, paleWood, scene, [0, .25, -1.49], .01);
  const floorBoards = new THREE.Group(); scene.add(floorBoards);
  const floorMats = ['#d3c3aa', '#d9cab3', '#dfd1bc', '#d6c7b0', '#e2d5c0'].map(color => material('#ffffff', { map: grain(color) }));
  for (let row = 0; row < 12; row++) {
    for (let column = -4; column <= 4; column++) {
      box(2.77, .06, .67, floorMats[(row * 3 + column + 12) % floorMats.length], floorBoards,
        [column * 2.8 + (row % 2) * 1.4, -.035, -1.18 + row * .69], .006);
    }
  }

  const shelf = new THREE.Group(); scene.add(shelf);
  const shelfColumns = [
    { x: -1.05, h: 3.83, levels: [0.19, 1.4, 2.57, 3.83] },
    { x: 0, h: 4.91, levels: [0.19, 1.4, 2.57, 3.74, 4.91] },
    { x: 1.05, h: 4.18, levels: [0.19, 1.4, 2.57, 4.18] },
  ];
  const uprights = new Map();
  const boardLevels = new Map();
  for (const column of shelfColumns) {
    const back = box(1.05, column.h, .075, shelfBack, shelf, [column.x, column.h / 2 + .08, -.42], .01);
    back.name = `shelf-back-${column.x}`;
    for (const edge of [-.525, .525]) {
      const x = Number((column.x + edge).toFixed(3));
      uprights.set(x, Math.max(uprights.get(x) || 0, column.h));
    }
    for (const y of column.levels) {
      if (!boardLevels.has(y)) boardLevels.set(y, []);
      boardLevels.get(y).push([column.x - .55, column.x + .55]);
    }
  }
  // Adjacent bays share one upright. Duplicate coplanar faces shimmer when the
  // camera moves, even when both copies use the same material.
  for (const [x, height] of uprights) {
    const upright = box(.105, height + .13, .72, oak, shelf, [x, height / 2 + .1, -.03], .02);
    upright.name = `shelf-upright-${x}`;
  }
  for (const [y, intervals] of boardLevels) {
    const spans = [];
    for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
      const previous = spans.at(-1);
      if (previous && interval[0] <= previous[1] + 1e-6) {
        previous[1] = Math.max(previous[1], interval[1]);
      } else {
        spans.push([...interval]);
      }
    }
    // Merge overlapping boards into one slab. Its front remains .05 ahead of
    // the uprights, so the joints do not introduce another coplanar front face.
    spans.forEach(([left, right], index) => {
      const board = box(right - left, .11, .76, oak, shelf, [(left + right) / 2, y, 0], .02);
      board.name = `shelf-board-${y}-${index}`;
    });
  }
  for (const x of [-1.5, -.55, .55, 1.5]) box(.13, .16, .55, material('#b5a084'), shelf, [x, .05, -.02]);

  const bookColors = ['#8d9a82', '#ad8b82', '#7c9296', '#d2c3a4', '#9a8e9e', '#b7a08a', '#789087'];
  function spineTexture(title, color, accent = '#f2ecdf') {
    const makeTexture = typeof title === 'string' ? canvasTexture : localizedTexture;
    return makeTexture(256, 1024, (ctx, w, h, neutral) => {
      const text = typeof title === 'string' ? title : neutral ? '' : title[language];
      ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
      const fade = ctx.createLinearGradient(0, 0, w, 0);
      fade.addColorStop(0, 'rgba(0,0,0,.18)'); fade.addColorStop(.16, 'rgba(255,255,255,.08)'); fade.addColorStop(1, 'rgba(0,0,0,.13)');
      ctx.fillStyle = fade; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = accent; ctx.lineWidth = 3;
      for (const y of [54, h - 54]) { ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(w - 30, y); ctx.stroke(); }
      ctx.save(); ctx.translate(w / 2, h * .49); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${text.length > 12 ? 46 : 58}px Georgia, 'Songti SC', serif`; ctx.fillText(text, 0, 0, 720);
      ctx.restore();
    });
  }
  function book(parent, x, bottom, title, color, w = .2, h = .92, id = null, tilt = 0) {
    const group = new THREE.Group(); group.position.set(x, bottom + h / 2, .16); group.rotation.z = tilt; parent.add(group);
    const cover = material(color);
    box(w, h, .49, cover, group, [0, 0, 0], .018);
    box(w * .81, h - .07, .44, paper, group, [.006, 0, -.022], .005);
    box(w, h, .035, cover, group, [0, 0, .241], .014);
    plane(w * .96, h * .98, spineTexture(title, color), group, [0, 0, .263]);
    if (id) target(id, group, [0, 0, .31], { forward: .12, lift: .035 });
    return group;
  }
  function rowBooks(parent, x, bottom, titles, colors = bookColors, h = .87) {
    let cursor = x;
    titles.forEach((title, index) => {
      const bw = [.15, .18, .145, .2, .16][index % 5];
      book(parent, cursor + bw / 2, bottom, title, colors[index % colors.length], bw, h + [0, -.12, .05, -.04][index % 4]);
      cursor += bw + .025;
    });
  }

  // Three larger, distinct volumes are the primary project entrances.
  // Fit the two shorter books between the upright and AnchorCell, including
  // the cover bevels. Overlapping spines flicker during camera parallax.
  book(shelf, -1.438, 2.63, '', '#8d9a82', .125, .92);
  book(shelf, -1.275, 2.63, '', '#b7a08a', .145, .8);
  book(shelf, -1.02, 2.63, 'AnchorCell', '#587971', .31, 1.07, 'project/anchorcell');
  book(shelf, -.71, 2.63, '', '#c3b59a', .17, .92, null, -.07);
  rowBooks(shelf, -.44, 2.63, [''], ['#b68f80'], .92);
  book(shelf, -.02, 2.63, { zh: '电池管理', en: 'Battery' }, '#af9877', .34, 1.04, 'project/battery');
  book(shelf, .28, 2.63, '', '#9c9784', .19, .89, null, -.07);
  rowBooks(shelf, .63, 2.63, [''], ['#8a9d92'], 1.02);
  book(shelf, 1.04, 2.63, 'cara', '#a37976', .36, 1.15, 'project/cara');
  book(shelf, 1.38, 2.63, '', '#ccbea5', .18, 1.03, null, -.09);
  rowBooks(shelf, -1.47, .26, ['Python', 'Spark', 'Kafka', 'SQL'], bookColors, .9);
  rowBooks(shelf, .65, .26, ['', '', '2026', ''], ['#b7a08a', '#789087', '#d2c3a4', '#ad8b82'], .83);
  rowBooks(shelf, .64, 1.47, ['', '', '', ''], ['#8d9a82', '#b7a08a', '#ad8b82', '#9ca493'], .94);

  // A small ceramic vessel, bookend, and sculptural brass clock soften the shelf.
  const vaseMat = material('#b6bda0');
  cylinder(.16, .2, .28, vaseMat, shelf, [-1.09, 1.6, .05]);
  sphere(.2, vaseMat, shelf, [-1.09, 1.73, .05], [1, .8, 1]);
  cylinder(.09, .12, .18, vaseMat, shelf, [-1.09, 1.91, .05]);
  const stems = material('#777246');
  tube([[-1.09, 1.95, .05], [-1.11, 2.14, .08], [-1.36, 2.4, .06]], .012, stems, shelf);
  tube([[-1.09, 1.95, .05], [-.97, 2.15, .08], [-.91, 2.43, .06]], .011, stems, shelf);
  const leafMats = ['#6b8050', '#839159', '#526b45'].map(c => material(c, { side: THREE.DoubleSide }));
  function leaf(parent, position, scale, rotate, matIndex = 0) {
    const result = sphere(.12, leafMats[matIndex % 3], parent, position, scale);
    result.rotation.set(...rotate); return result;
  }
  leaf(shelf, [-1.29, 2.31, .07], [1.2, .33, .46], [0, .1, -.5]);
  leaf(shelf, [-.98, 2.27, .08], [1.1, .3, .5], [0, 0, .8], 1);
  const clock = new THREE.Group(); shelf.add(clock); clock.position.set(.02, 4.25, .12);
  const clockFace = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e6d8b4'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#5d5036'; ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(128 + Math.sin(a) * 91, 128 - Math.cos(a) * 91); ctx.lineTo(128 + Math.sin(a) * 105, 128 - Math.cos(a) * 105); ctx.stroke();
    }
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(83, 89); ctx.lineTo(128, 128); ctx.lineTo(177, 62); ctx.stroke();
    ctx.fillStyle = '#5d5036'; ctx.beginPath(); ctx.arc(128, 128, 8, 0, Math.PI * 2); ctx.fill();
  });
  const clockRim = cylinder(.35, .35, .09, brass, clock, [0, 0, 0], 48); clockRim.rotation.x = Math.PI / 2;
  const clockDial = mesh(new THREE.CircleGeometry(.305, 48), material('#fff', { map: clockFace }), clock, [0, 0, .052]); clockDial.castShadow = false;
  box(.45, .07, .23, brass, clock, [0, -.36, -.015]);

  const learning = new THREE.Group(); shelf.add(learning); learning.position.set(.02, 1.78, .16);
  [['#576f71', .12, .73], ['#9e6046', .12, .79], ['#cbb58b', .105, .7]].forEach(([color, thickness, length], index) => {
    const item = new THREE.Group(); learning.add(item); item.position.y = index * .15; item.rotation.y = [-.04, .07, -.03][index];
    box(length, thickness, .49, material(color), item);
    box(length - .04, thickness * .65, .47, paper, item, [0, 0, .015], .002);
  });
  const notebook = box(.7, .035, .49, material('#c4aa6d'), learning, [0, .39, -.015]); notebook.rotation.y = -.08;
  tube([[-.2, .42, .12], [.12, .42, .11]], .017, dark, learning);
  target('learning', learning, [0, .36, .28], { forward: .1, lift: .02 });

  const desk = new THREE.Group(); scene.add(desk);
  box(3.55, .16, 1.43, deskWood, desk, [0, 1.63, .3], .045);
  box(3.35, .12, 1.25, darkWood, desk, [0, 1.52, .26]);
  for (const x of [-1.43, 1.43]) for (const z of [-.2, .78]) {
    const leg = box(.13, 1.48, .14, darkWood, desk, [x, .74, z]); leg.rotation.z = x < 0 ? -.025 : .025;
  }
  box(1.1, .33, 1.07, darkWood, desk, [.87, 1.36, .25]);
  box(.98, .26, .06, deskWood, desk, [.87, 1.36, .81]);
  cylinder(.035, .035, .1, brass, desk, [.87, 1.36, .89]).rotation.x = Math.PI / 2;

  const monitor = new THREE.Group(); monitor.position.set(.2, 2.23, .0); desk.add(monitor); monitor.rotation.y = -.07;
  box(1.13, .77, .16, material('#87917a'), monitor, [0, .05, 0], .055);
  box(.94, .58, .02, dark, monitor, [0, .075, .09], .045);
  const screenTexture = canvasTexture(768, 480, (ctx, w, h) => {
    ctx.fillStyle = '#213e3c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#a4c9a7'; ctx.font = '25px monospace'; ctx.fillText('Connerald', 46, 54);
    ctx.strokeStyle = '#3d5b4e'; ctx.lineWidth = 1;
    for (let y = 140; y < 390; y += 50) { ctx.beginPath(); ctx.moveTo(45, y); ctx.lineTo(720, y); ctx.stroke(); }
    ctx.strokeStyle = '#b8c78d'; ctx.lineWidth = 5; ctx.beginPath();
    [310, 312, 287, 298, 262, 275, 205, 218, 194, 206, 149, 163, 125].forEach((v, i) => i ? ctx.lineTo(47 + i * 55, v) : ctx.moveTo(47, v)); ctx.stroke();
    ctx.fillStyle = '#d5c28c'; ctx.fillRect(47, 409, 7, 7);
  });
  plane(.89, .53, screenTexture, monitor, [0, .075, .105], { emissive: '#3f6657', emissiveIntensity: .28 });
  box(.12, .31, .13, dark, monitor, [0, -.42, -.025]);
  box(.53, .045, .34, dark, monitor, [0, -.55, .035]);
  box(.79, .045, .25, material('#a4a38e'), desk, [.14, 1.745, .62], .018);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 11; col++) box(.045, .013, .041, cream, desk, [-.19 + col * .061, 1.775, .55 + row * .057], .004);

  const indexBook = new THREE.Group(); desk.add(indexBook); indexBook.position.set(-.86, 1.94, .83); indexBook.rotation.set(-.22, -.13, -.04);
  box(.67, .47, .09, material('#436067'), indexBook, [0, 0, 0], .02);
  box(.63, .42, .075, paper, indexBook, [0, 0, -.025], .005);
  const indexTexture = localizedTexture(640, 448, (ctx, w, h, neutral) => {
    ctx.fillStyle = '#3e5b61'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#bfa575'; ctx.lineWidth = 2; ctx.strokeRect(27, 27, w - 54, h - 54);
    ctx.fillStyle = '#e7d8b6'; ctx.textAlign = 'center'; ctx.font = '22px sans-serif'; ctx.fillText('CONNERALD', w / 2, 86);
    ctx.font = '72px Georgia, "Songti SC", serif';
    if (!neutral) ctx.fillText(language === 'zh' ? '项目' : 'Projects', w / 2, 260);
    else {
      ctx.lineWidth = 3; ctx.strokeRect(w / 2 - 64, 174, 128, 130);
      ctx.beginPath(); ctx.moveTo(w / 2, 174); ctx.lineTo(w / 2, 304); ctx.stroke();
    }
  });
  plane(.65, .45, indexTexture, indexBook, [0, 0, .055]);
  target('projects', indexBook, [0, 0, .1], { forward: .08, lift: .05 });

  const files = new THREE.Group(); desk.add(files); files.position.set(1.24, 2.03, .19); files.rotation.y = -.12;
  for (let i = 0; i < 3; i++) {
    const folderMat = material(['#b69c69', '#b38657', '#768678'][i]);
    box(.58, .54, .045, folderMat, files, [-i * .035, i * .035, -.10 + i * .07], .012);
    box(.2, .075, .04, folderMat, files, [-.13 - i * .035, .28 + i * .035, -.1 + i * .07], .012);
  }
  const fileLabel = localizedTexture(300, 100, (ctx, w, h, neutral) => {
    ctx.fillStyle = '#f1eddf'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#56604f'; ctx.textAlign = 'center'; ctx.font = '31px Georgia, "Songti SC", serif';
    if (!neutral) ctx.fillText(language === 'zh' ? '实习' : 'Experience', w / 2, 62);
    else { ctx.fillRect(85, 36, 130, 3); ctx.fillRect(85, 57, 86, 3); }
  });
  plane(.43, .14, fileLabel, files, [-.07, .02, .072]);
  box(.71, .1, .45, darkWood, files, [-.04, -.3, -.06]);
  target('experience', files, [-.04, .07, .14], { forward: .09, lift: .03 });

  const mug = new THREE.Group(); desk.add(mug); mug.position.set(.78, 1.84, .78);
  cylinder(.1, .087, .23, material('#b76b4c'), mug, [0, 0, 0]);
  cylinder(.082, .082, .006, material('#493022'), mug, [0, .116, 0]);
  mesh(new THREE.TorusGeometry(.073, .022, 8, 18), material('#b76b4c'), mug, [.105, .015, 0]);

  const lamp = new THREE.Group(); desk.add(lamp); lamp.position.set(-1.36, 1.78, -.07);
  cylinder(.25, .28, .09, material('#c5c6af'), lamp, [0, 0, 0]);
  tube([[0, .03, 0], [-.08, .65, -.04], [.08, 1.1, -.04], [.32, 1.15, -.02]], .037, brass, lamp);
  const lampShade = cylinder(.12, .32, .33, material('#d6d6be', { side: THREE.DoubleSide }), lamp, [.32, 1.03, -.02]);
  const bulbMat = material('#fff7df', { emissive: '#ffeac1', emissiveIntensity: 1.2 });
  sphere(.12, bulbMat, lamp, [.32, .88, -.02]);
  const lampLight = new THREE.PointLight('#ffe6b7', 1.1, 3, 2); lampLight.position.set(.32, .83, .04); lamp.add(lampLight);
  lamp.traverse(node => { if (node.isMesh) { node.userData.contentId = '__lamp'; pickables.push(node); } });
  lampShade.userData.contentId = '__lamp';

  const wallThings = new THREE.Group(); scene.add(wallThings);
  const frameGroup = new THREE.Group(); wallThings.add(frameGroup); frameGroup.position.set(-.35, .15, 0); frameGroup.rotation.z = -.025;
  box(1.37, 1.66, .1, darkWood, frameGroup, [0, 0, 0], .015);
  box(1.24, 1.53, .04, paleWood, frameGroup, [0, 0, .06], .008);
  const nameTexture = localizedTexture(720, 900, (ctx, w, h, neutral) => {
    ctx.fillStyle = '#f5f0e3'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c3b9a5'; ctx.lineWidth = 2; ctx.strokeRect(34, 34, w - 68, h - 68);
    ctx.save(); ctx.translate(360, 338); ctx.rotate(-.1);
    ctx.fillStyle = '#81917b'; ctx.beginPath(); ctx.arc(0, 0, 141, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f5f0e3'; ctx.lineWidth = 3;
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.ellipse(0, 0, 18 + Math.abs(i) * 34, 141, .23, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#414a3f'; ctx.textAlign = 'center';
    ctx.font = language === 'zh' && !neutral ? '64px "Songti SC", "Noto Serif SC", serif' : '57px Georgia, serif';
    ctx.fillText(neutral ? 'Connerald' : language === 'zh' ? '董俊叶' : 'Dong Junye', 360, 632, 610);
  });
  plane(1.13, 1.42, nameTexture, frameGroup, [0, 0, .085]);
  target('about', frameGroup, [0, -.15, .15], { forward: .045, lift: .015 });

  const pinboard = new THREE.Group(); wallThings.add(pinboard); pinboard.position.set(1.3, -.04, -.025); pinboard.rotation.z = .025;
  box(1.42, 1.2, .075, darkWood, pinboard);
  const corkTexture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#9e784b'; ctx.fillRect(0, 0, w, h);
    let s = 29;
    for (let i = 0; i < 3200; i++) { s = (s * 16807) % 2147483647; const x = (s % 256); s = (s * 16807) % 2147483647; const y = s % 256; ctx.fillStyle = i % 2 ? '#b58d5b' : '#86603d'; ctx.fillRect(x, y, 2, 1); }
  });
  plane(1.32, 1.1, corkTexture, pinboard, [0, 0, .046]);
  const noteTexture = canvasTexture(320, 280, (ctx, w, h) => {
    ctx.fillStyle = '#eee4c8'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#83917a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(48, 205); ctx.lineTo(127, 99); ctx.lineTo(177, 160); ctx.lineTo(221, 112); ctx.lineTo(278, 205); ctx.stroke();
    ctx.beginPath(); ctx.arc(235, 62, 17, 0, Math.PI * 2); ctx.stroke();
  });
  const note = plane(.59, .52, noteTexture, pinboard, [-.25, .22, .067]); note.rotation.z = -.09;
  sphere(.026, material('#984d3d'), pinboard, [-.28, .46, .09]);
  const envelope = new THREE.Group(); pinboard.add(envelope); envelope.position.set(.19, -.23, .12); envelope.rotation.z = -.09;
  box(.79, .44, .025, paper, envelope, [0, 0, 0], .008);
  const envelopeTexture = canvasTexture(640, 360, (ctx, w, h) => {
    ctx.fillStyle = '#e5d4b3'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#b5a17e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(320, 220); ctx.lineTo(640, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 360); ctx.lineTo(230, 161); ctx.moveTo(640, 360); ctx.lineTo(410, 161); ctx.stroke();
    ctx.fillStyle = '#a95c44'; ctx.beginPath(); ctx.arc(320, 212, 39, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f1dbb8'; ctx.font = '27px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('C', 320, 221);
  });
  plane(.78, .43, envelopeTexture, envelope, [0, 0, .022]);
  target('contact', envelope, [0, 0, .1], { forward: .05, lift: .015 });

  const floatingShelf = new THREE.Group(); scene.add(floatingShelf);
  box(3.25, .13, .58, oak, floatingShelf, [0, 0, 0]);
  for (const x of [-1.1, 1.1]) box(.065, .38, .065, brass, floatingShelf, [x, -.22, -.18]);
  const plant = new THREE.Group(); floatingShelf.add(plant); plant.position.set(-1.06, .29, 0);
  cylinder(.24, .19, .44, material('#8c754b'), plant, [0, 0, 0], 24);
  cylinder(.218, .218, .018, material('#3b3424'), plant, [0, .225, 0]);
  for (let branch = 0; branch < 7; branch++) {
    const sign = branch % 2 ? 1 : -1;
    const endX = sign * (.36 + branch * .055), endY = -.24 - (branch % 3) * .29, z = .08 + branch * .035;
    tube([[0, .24, 0], [sign * .22, .43, .03], [endX, .12, z], [endX * 1.1, endY, z + .12]], .012, leafMats[2], plant);
    for (let l = 0; l < 5; l++) {
      const t = l / 4;
      leaf(plant, [endX * t + (l % 2 ? -.07 : .07), .3 + Math.sin(t * 2.6) * .12 + endY * t, z * t], [1.03, .45, .65], [.3, .3, sign * (t + .4)], branch + l);
    }
  }
  const smallPicture = new THREE.Group(); floatingShelf.add(smallPicture); smallPicture.position.set(.35, .4, -.03); smallPicture.rotation.x = -.08;
  box(.52, .67, .05, darkWood, smallPicture);
  const artTexture = canvasTexture(256, 320, (ctx, w, h) => {
    ctx.fillStyle = '#e0cfaa'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ab6949'; ctx.beginPath(); ctx.arc(128, 131, 61, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#597260'; ctx.beginPath(); ctx.moveTo(31, 254); ctx.lineTo(96, 127); ctx.lineTo(151, 254); ctx.fill();
    ctx.fillStyle = '#3f5655'; ctx.beginPath(); ctx.moveTo(109, 254); ctx.lineTo(176, 157); ctx.lineTo(227, 254); ctx.fill();
  });
  plane(.43, .57, artTexture, smallPicture, [0, 0, .031]);
  const pot = new THREE.Group(); shelf.add(pot); pot.position.set(1.04, 4.42, -.03);
  cylinder(.2, .14, .35, material('#b87050'), pot, [0, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    tube([[0, .14, 0], [Math.cos(a) * .13, .4, Math.sin(a) * .13], [Math.cos(a) * .27, .55, Math.sin(a) * .2]], .012, leafMats[2], pot);
    leaf(pot, [Math.cos(a) * .25, .51, Math.sin(a) * .19], [1.5, .4, .75], [0, -a, .5], i);
  }

  // A ground rug adds a soft visual base, with no animated or photographic assets.
  const rugTexture = canvasTexture(768, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d9d1bd'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#bfb6a0'; ctx.lineWidth = 16;
    ctx.strokeRect(25, 25, w - 50, h - 50); ctx.lineWidth = 3; ctx.strokeRect(46, 46, w - 92, h - 92);
    ctx.globalAlpha = .18; ctx.strokeStyle = '#f8f4e9';
    for (let x = -512; x < 1000; x += 18) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 512, 512); ctx.stroke(); }
  });
  const rug = plane(5.8, 3.1, rugTexture, scene, [.4, .009, 2.0]); rug.rotation.x = -Math.PI / 2; rug.receiveShadow = true;

  function layout() {
    if (disposed) return;
    const bounds = container.getBoundingClientRect();
    width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
    portrait = width < 1024 || width / height < .87;
    camera.aspect = width / height;
    if (portrait) {
      // A scene-only frame: keep the full shelf and desk above the introduction.
      // Fit both axes instead of assuming a tall, full-screen phone canvas.
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(6.2, 4.35 / camera.aspect) / 19.4));
      cameraHome.set(.05, 3.8, 9.65); cameraLook.set(0, 3.15, -.04);
      shelf.position.set(.61, .61, -.13); shelf.scale.setScalar(.77);
      desk.position.set(-.65, .61, .18); desk.scale.setScalar(.64);
      wallThings.position.set(-.82, 4.27, -1.49); wallThings.scale.setScalar(.57);
      floatingShelf.position.set(-.95, 5.22, -1.18); floatingShelf.scale.setScalar(.67);
      rug.scale.set(.65, .8, 1); rug.position.set(0, .619, 2);
      floorBoards.position.y = .61; baseboard.position.y = .76; baseboardTrim.position.y = .86;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    } else {
      camera.fov = width / height > 1.9 ? 32 : 35;
      cameraHome.set(.1, 3.7, 12.3); cameraLook.set(.1, 2.9, -.15);
      // The lower-left column belongs to the introduction, not to scene targets.
      shelf.position.set(2.7, .02, -.48); shelf.scale.setScalar(1);
      desk.position.set(.4, 0, .33); desk.scale.setScalar(.85);
      wallThings.position.set(-1.3, 3.95, -1.49); wallThings.scale.setScalar(.83);
      floatingShelf.position.set(-1.3, 5.38, -1.18); floatingShelf.scale.setScalar(1);
      rug.scale.set(1, 1, 1); rug.position.set(.4, .009, 2);
      floorBoards.position.y = 0; baseboard.position.y = .15; baseboardTrim.position.y = .25;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    }
    camera.position.copy(cameraHome); camera.lookAt(cameraLook); camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    hotspotCamera.copy(camera);
    hotspotCamera.updateMatrixWorld(true);
    renderer.setSize(width, height, false);
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    publishPositions(); invalidate();
  }

  function publishPositions() {
    const result = [];
    for (const entry of targets.values()) {
      restMatrix.compose(entry.home, entry.object.quaternion, entry.object.scale);
      const point = entry.anchor.clone().applyMatrix4(restMatrix);
      entry.object.parent.localToWorld(point);
      point.project(hotspotCamera);
      const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
      result.push({ id: entry.id, x, y,
        visible: point.z > -1 && point.z < 1 && x >= 22 && x <= width - 22 && y >= 22 && y <= height - 22 });
    }
    onPositions(result);
  }
  function invalidate() {
    if (!frame && !disposed && !paused) frame = requestAnimationFrame(render);
  }
  function render(time) {
    frame = 0;
    if (disposed || paused) return;
    const dt = Math.min((time - (lastTime || time)) / 1000, .05); lastTime = time;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-Math.max(dt, .016) * 9);
    const aimX = reducedMotion || portrait ? 0 : pointerAim.x;
    const aimY = reducedMotion || portrait ? 0 : pointerAim.y;
    pointerCurrent.x += (aimX - pointerCurrent.x) * ease;
    pointerCurrent.y += (aimY - pointerCurrent.y) * ease;
    camera.position.copy(cameraHome);
    camera.position.x += pointerCurrent.x * .11;
    camera.position.y += pointerCurrent.y * .065;
    camera.lookAt(cameraLook);
    let moving = Math.abs(pointerCurrent.x - aimX) > .001 || Math.abs(pointerCurrent.y - aimY) > .001;
    for (const entry of targets.values()) {
      const wanted = activeId === entry.id || hoveredId === entry.id ? 1 : 0;
      entry.hover += (wanted - entry.hover) * ease;
      if (Math.abs(wanted - entry.hover) > .001) moving = true;
      entry.object.position.copy(entry.home);
      entry.object.position.z += entry.hover * (entry.forward || .08);
      entry.object.position.y += entry.hover * (entry.lift || .02);
      for (const original of entry.materials.values()) {
        const intensity = (hints ? .12 : 0) + entry.hover * .17;
        if (intensity > .001) {
          original.material.emissive.set('#819f88');
          original.material.emissiveIntensity = intensity;
        } else {
          original.material.emissive.copy(original.emissive);
          original.material.emissiveIntensity = original.intensity;
        }
      }
    }
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    renderer.render(scene, camera); publishPositions();
    if (moving) invalidate();
  }

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const intersection = raycaster.intersectObjects(pickables, false)[0];
    return intersection?.object.userData.contentId || null;
  }
  function move(event) {
    if (event.pointerType === 'touch' || disposed) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointerAim.set((event.clientX - rect.left) / rect.width - .5, .5 - (event.clientY - rect.top) / rect.height);
    const hotspot = event.target.closest?.('[data-entry]');
    hoveredId = hotspot ? hotspot.dataset.entry : event.target === renderer.domElement ? pick(event) : null;
    renderer.domElement.style.cursor = hoveredId ? 'pointer' : '';
    invalidate();
  }
  function leave() { pointerAim.set(0, 0); hoveredId = null; renderer.domElement.style.cursor = ''; invalidate(); }
  function down(event) { pointerDown = { x: event.clientX, y: event.clientY, id: pick(event) }; }
  function toggleLamp() {
    lampOn = !lampOn;
    lampLight.intensity = lampOn ? 1.1 : 0;
    bulbMat.emissiveIntensity = lampOn ? 1.2 : .05;
    invalidate();
    onLampChange(lampOn);
    return lampOn;
  }
  function up(event) {
    if (!pointerDown) return;
    const previous = pointerDown; pointerDown = null;
    if (Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 9) return;
    const id = pick(event);
    if (!id || id !== previous.id) return;
    if (id === '__lamp') {
      toggleLamp(); return;
    }
    onSelect(id);
  }
  function contextLost(event) {
    event.preventDefault();
    container.dataset.ready = 'false';
    onError(new Error('WebGL context lost'));
  }
  const canvas = renderer.domElement;
  // Observe the room, including its DOM overlays, as one interaction surface.
  // Crossing from canvas to a hotspot is not leaving the room.
  const interactionSurface = container.parentElement;
  interactionSurface.addEventListener('pointermove', move);
  interactionSurface.addEventListener('pointerleave', leave);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);
  function cancelPointer() { pointerDown = null; }
  canvas.addEventListener('pointercancel', cancelPointer);
  canvas.addEventListener('webglcontextlost', contextLost);
  const observer = new ResizeObserver(layout); observer.observe(container);

  const api = {
    toggleLamp,
    setHints(value) { hints = Boolean(value); container.dataset.hints = String(hints); invalidate(); },
    setActive(id) { activeId = targets.has(id) ? id : null; invalidate(); },
    setLanguage(value) { language = value === 'en' ? 'en' : 'zh'; redrawLabels(); invalidate(); },
    setReducedMotion(value) { reducedMotion = Boolean(value); pointerAim.set(0, 0); invalidate(); },
    setPaused(value) { paused = Boolean(value); if (paused && frame) { cancelAnimationFrame(frame); frame = 0; } if (!paused) { lastTime = 0; invalidate(); } },
    capture({ neutral = false, type = 'image/png', quality = .9 } = {}) {
      if (disposed) return null;
      if (neutral) redrawLabels(true);
      try {
        renderer.render(scene, camera);
        return canvas.toDataURL(type, quality);
      } finally {
        if (neutral) { redrawLabels(); renderer.render(scene, camera); }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; if (frame) cancelAnimationFrame(frame); observer.disconnect();
      interactionSurface.removeEventListener('pointermove', move); interactionSurface.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancelPointer);
      canvas.removeEventListener('webglcontextlost', contextLost);
      for (const texture of textures) texture.dispose();
      for (const disposable of disposables) disposable.dispose();
      renderer.dispose(); canvas.remove();
    },
  };
  layout();
  renderer.render(scene, camera);
  container.dataset.ready = 'true';
  onReady(api);
  return api;
}
