import {translations, ui, projects, entryIds} from './content.js';
import {posterAnchors} from './poster-anchors.js';
import {renderFallback} from './fallback.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const lines = value => esc(value).replace(/\n/g, '<br>');
const reader = $('#reader'), directory = $('#directory');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const readingLayout = matchMedia('(min-width: 1024px) and (min-height: 720px)');
let language = initialLanguage(), page = 0, currentId = '', room = null, hints = false;
let roomReturnFocus = null, directoryReturnFocus = null, directoryFromReader = false, directoryNavigation = false;
let spreadMode = readingLayout.matches, readingPosition = null, finishTurn = null, resizeFrame = 0;
const seen = new Set();
const t = () => translations[language], u = () => ui[language];
const title = project => project.titleKey ? t()[project.titleKey] : project.title;
const label = id => u().entryLabels[id] ?? id;
const text = (value, cls = '') => `<p${cls ? ` class="${cls}"` : ''}>${esc(value)}</p>`;
const ptext = (key, cls = '') => text(t()[key], cls);
const heading = value => `<h2>${esc(value)}</h2>`;
const subheading = value => `<h3>${esc(value)}</h3>`;
const list = values => `<ul class="contributions">${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul>`;
const spread = (left, right) => `<div class="spread"><section class="paper-page">${left}</section><section class="paper-page">${right}</section></div>`;

function initialLanguage() {
  const value = new URLSearchParams(location.search).get('lang');
  if (value === 'zh' || value === 'en') return value;
  try { return localStorage.getItem('site-language') === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
}
function cancelTurn() { finishTurn?.(); }
function currentTitle() {
  return currentId.startsWith('project/') ? title(projects.find(project => `project/${project.id}` === currentId)) : label(currentId);
}
function projectLink(project) {
  return `<a href="#project/${project.id}"><span class="list-num">${String(projects.indexOf(project)+1).padStart(2,'0')}</span><span>${esc(title(project))}<small>${esc(t()[project.roleKey])}</small></span><span aria-hidden="true">↗</span></a>`;
}
function configureDirectory() {
  const ids = ['projects', 'about', 'experience', 'learning', 'contact'];
  $('#directory-links').innerHTML = ids.map((id, i) => `<a href="#${id}"><span>${String(i+1).padStart(2,'0')}</span>${esc(label(id))}<span aria-hidden="true">↗</span></a>`).join('');
  $('#directory-project-links').innerHTML = projects.map(project => `<a href="#project/${project.id}">${esc(title(project))}</a>`).join('');
  if (!$('#hotspots').children.length) {
    $('#hotspots').innerHTML = entryIds.map(id => `<button type="button" class="hotspot" data-entry="${id}" style="visibility:hidden"><span class="hotspot-label"></span></button>`).join('');
    for (const button of $('#hotspots').children) {
      button.addEventListener('pointerenter', () => room?.setActive(button.dataset.entry));
      button.addEventListener('pointerleave', () => room?.setActive(null));
      button.addEventListener('focus', () => room?.setActive(button.dataset.entry));
      button.addEventListener('blur', () => room?.setActive(null));
      button.addEventListener('click', () => navigate(button.dataset.entry, button));
    }
  }
  for (const button of $('#hotspots').children) {
    button.setAttribute('aria-label', label(button.dataset.entry));
    button.querySelector('.hotspot-label').textContent = label(button.dataset.entry);
    button.classList.toggle('visited', seen.has(button.dataset.entry));
  }
}
function applyLanguage(updateUrl = false) {
  const position = reader.open ? capturePosition() : readingPosition;
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.title = u().roomTitle + (language === 'zh' ? ' · 数据工程与 AI' : ' · Data & AI');
  document.querySelectorAll('[data-ui]').forEach(element => {
    const value = u()[element.dataset.ui];
    if (value !== undefined) element.innerHTML = lines(value);
  });
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const value = t()[element.dataset.i18n];
    if (value !== undefined) element.textContent = value;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(element => {
    const value = t()[element.dataset.i18nAria];
    if (value) element.setAttribute('aria-label', value);
  });
  document.querySelectorAll('[data-lang]').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.lang === language)));
  document.querySelectorAll('.language-switch').forEach(element => element.setAttribute('aria-label', u().language));
  for (const selector of ['meta[name="description"]','meta[property="og:description"]','meta[name="twitter:description"]']) $(selector).content = t().description;
  for (const selector of ['meta[property="og:title"]','meta[name="twitter:title"]']) $(selector).content = document.title;
  $('meta[property="og:locale"]').content = language === 'zh' ? 'zh_CN' : 'en_US';
  $('#room-main').setAttribute('aria-label', u().roomTitle);
  $('#hotspots').setAttribute('aria-label', u().hotspotLabel);
  $('.brand').setAttribute('aria-label', u().brandHome);
  $('#lamp-toggle').setAttribute('aria-label', u().lampLabel);
  $('#reader-close').setAttribute('aria-label', u().closeReader);
  $('[data-close-directory]').setAttribute('aria-label', u().closeMenu);
  $('#directory-links').setAttribute('aria-label', u().menu);
  configureDirectory();
  if (room) { room.setLanguage(language); roomPositions(lastPositions); } else fallbackPositions();
  if (reader.open || directoryFromReader) renderReader(position);
  renderFallback(language);
  try { localStorage.setItem('site-language', language); } catch { /* Preference storage is optional. */ }
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('lang', language);
    history.replaceState(history.state, '', url);
  }
}
function tags(values) {
  return `<div class="tags">${values.map(value => `<span>${esc(u().techLabels[value] || value)}</span>`).join('')}</div>`;
}
function diagram(id) {
  return `<figure class="diagram"><figcaption>${esc(u().methodTitle)}</figcaption><div class="flow">${u().flows[id].map((value, i) => `${i ? '<span class="flow-arrow" aria-hidden="true">→</span>' : ''}<span class="flow-node">${esc(value)}</span>`).join('')}</div></figure>`;
}
function projectSpreads(project) {
  const details = u().projectContributions[project.id];
  const overview = `<p class="eyebrow">${esc(u().projectNotes)} ${String(projects.indexOf(project)+1).padStart(2,'0')}</p>` +
    heading(title(project)) + `<p class="project-role"><span>${esc(project.date)}</span><span>${esc(t()[project.roleKey])}</span></p>` +
    text(u().projectSummaries[project.id], 'lead');
  const back = `<a class="paper-link back-projects" href="#projects"><span aria-hidden="true">←</span> ${esc(u().backToProjects)}</a>`;
  if (project.id === 'anchorcell') {
    return [
      spread(overview + tags(project.tech) + back,
        heading(u().projectOverview) + ptext('ventureContext') + diagram(project.id)),
      spread(heading(u().anchorWorkTitle) + list(details),
        heading(u().anchorReliabilityTitle) + ptext('ventureValue') +
        `<div class="evaluation"><strong>40+</strong><span>${esc(u().anchorEvaluationLabel)}</span></div>`)
    ];
  }
  const source = project.href ? `<a class="paper-link" href="${esc(project.href)}" target="_blank" rel="noopener noreferrer">${esc(u().viewProject)} <span aria-hidden="true">↗</span></a>` : '';
  return [spread(overview + subheading(u().contributionTitle) + list(details) + back,
    diagram(project.id) + (u().projectOutcomes[project.id] ? text(u().projectOutcomes[project.id]) : '') + tags(project.tech) + source)];
}
function buildSpreads() {
  if (currentId.startsWith('project/')) return projectSpreads(projects.find(project => `project/${project.id}` === currentId));
  if (currentId === 'projects') return [spread(
    heading(label('projects')) + text(u().projectIndexIntro, 'lead') + `<div class="index-art" aria-hidden="true"><i></i><i></i><i></i></div>`,
    `<ol class="project-list">${projects.map(project => `<li>${projectLink(project)}</li>`).join('')}</ol>`
  )];
  if (currentId === 'about') return [spread(
    heading(label('about')) + text(u().aboutIntro, 'lead') + subheading(t().careerNoteTitle) + text(u().aboutTeam),
    `<ol class="growth-list">${u().aboutSteps.map(step => `<li>${subheading(step.title)}${text(step.body)}</li>`).join('')}</ol>`
  )];
  if (currentId === 'experience') return ['dc','qh'].map(key => spread(
    `<p class="eyebrow">${esc(label('experience'))}</p>` + heading(t()[`${key}Company`]) +
    `<p class="project-role"><span>${esc(t()[`${key}Dates`])}</span><span>${esc(t()[`${key}Role`])} · ${esc(t().beijing)}</span></p>` +
    ptext(`${key}Context`, 'lead') + subheading(u().contributionTitle) + ptext(`${key}Responsibility`),
    heading(u().experienceMethods[key]) + ptext(`${key}Solution`) + ptext(`${key}Value`) +
    tags(key === 'dc' ? ['Azure Data Factory','Databricks','Synapse','SQL'] : ['Python','MySQL','Risk Metrics'])
  ));
  if (currentId === 'learning') return [spread(
    heading(label('learning')) + subheading(t().school) +
    `<p class="project-role"><span>${esc(t().major)}</span><span>${esc(t().educationDates)}</span></p>` +
    ptext('courses') + ptext('educationLanguage') + subheading(t().mathorTitle) + ptext('mathorDescription'),
    heading(u().toolkit) + `<dl class="skill-list">${[['skillProgramming','skillProgrammingValue'],['skillData','skillDataValue'],['skillBigData','skillBigDataValue'],['skillMethods','skillMethodsValue']].map(([a,b]) => `<div><dt>${esc(t()[a])}</dt><dd>${esc(t()[b])}</dd></div>`).join('')}</dl>`
  )];
  return [spread(
    heading(label('contact')) + ptext('contactBody', 'lead') + `<p class="contact-status"><span class="status-dot" aria-hidden="true"></span>${esc(t().profileStatus)}</p>`,
    `<div class="contact-details"><span class="eyebrow">${esc(u().emailLabel)}</span><a class="contact-email" href="mailto:${esc(t().emailAddress)}">${esc(t().emailAddress)}</a><div class="contact-actions"><button type="button" class="paper-link" id="copy-email">${esc(u().copyEmail)}</button><a class="paper-link" href="https://github.com/connerald" target="_blank" rel="noopener noreferrer">${esc(u().visitGithub)} <span aria-hidden="true">↗</span></a></div></div>`
  )];
}

// Positions refer to semantic chapter/leaf indexes, so a locale or layout change
// does not send a reader back to the start of a long article.
function capturePosition() {
  if (!reader.open) return readingPosition;
  if (spreadMode) {
    const pages = [...$('#book').querySelectorAll(':scope > .spread > .paper-page')];
    const focused = pages.indexOf(document.activeElement?.closest('.paper-page'));
    const leaf = focused >= 0 ? focused : (readingPosition?.leaf || 0);
    return {chapter:page, leaf, fraction:pages[leaf]?.scrollTop / Math.max(1,pages[leaf]?.scrollHeight) || 0,
      scrolls:pages.map(node => node.scrollTop / Math.max(1,node.scrollHeight-node.clientHeight))};
  }
  const top = $('.reader-toolbar').getBoundingClientRect().bottom + 1;
  const pages = [...$('#book').querySelectorAll('.paper-page')];
  const active = pages.find(node => node.getBoundingClientRect().bottom > top) || pages.at(-1);
  if (!active) return {chapter:page,leaf:0,fraction:0,scrolls:[0,0]};
  const rect = active.getBoundingClientRect();
  return {
    chapter:Number(active.parentElement.dataset.chapter),
    leaf:[...active.parentElement.children].indexOf(active),
    fraction:Math.max(0, Math.min(1, (top-rect.top)/rect.height)),
    scrolls:[0,0]
  };
}
function restorePosition(position) {
  if (!position || !reader.open) return;
  if (spreadMode) {
    $('#book').querySelectorAll(':scope > .spread > .paper-page').forEach((node,i) => {
      const progress = position.scrolls?.[i] || (i === position.leaf ? position.fraction : 0);
      node.scrollTop = progress * Math.max(0,node.scrollHeight-node.clientHeight);
    });
  } else {
    const chapter = $('#book').querySelector(`[data-chapter="${position.chapter}"]`);
    const node = chapter?.children[position.leaf || 0];
    if (node) {
      const top = $('.reader-toolbar').getBoundingClientRect().bottom;
      const rect = node.getBoundingClientRect();
      reader.scrollTop += rect.top - top + (position.fraction || 0) * rect.height;
    }
  }
  readingPosition = capturePosition();
}
function renderReader(position = null) {
  cancelTurn();
  const spreads = buildSpreads().map((html, index) => html.replace('class="spread"', `class="spread" data-chapter="${index}"`));
  page = Math.max(0, Math.min(position?.chapter ?? page, spreads.length-1));
  reader.dataset.mode = spreadMode ? 'spread' : 'continuous';
  $('#book').innerHTML = spreadMode ? spreads[page] : spreads.join('');
  const firstHeading = $('#book').querySelector('h2');
  if (firstHeading) firstHeading.id = 'reader-title';
  $('#page-count').textContent = `${String(page+1).padStart(2,'0')} / ${String(spreads.length).padStart(2,'0')}`;
  $('.reader-bottom').hidden = !spreadMode || spreads.length === 1;
  $('#previous-page').disabled = page === 0;
  $('#next-page').disabled = page === spreads.length-1;
  $('#copy-email')?.addEventListener('click', copyEmail);
  readingPosition = position || {chapter:page,leaf:0,fraction:0,scrolls:[0,0]};
  restorePosition(readingPosition);
}
function normaliseHash() {
  let hash;
  try { hash = decodeURIComponent(location.hash.slice(1)); } catch { return ''; }
  if (hash === 'featured' || hash === 'case-notes') hash = 'project/anchorcell';
  if (hash === 'education') hash = 'learning';
  return entryIds.includes(hash) || projects.some(project => hash === `project/${project.id}`) ? hash : '';
}
function restoreRoomFocus() {
  const element = roomReturnFocus;
  if (element?.isConnected && !element.closest('dialog') && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden') {
    element.focus({preventScroll:true});
  } else $('#menu-toggle').focus({preventScroll:true});
}
function pauseRoom() { room?.setPaused(document.hidden || reader.open || directory.open); }
function renderRoute() {
  const id = normaliseHash();
  if (!id) {
    cancelTurn();
    currentId = '';
    directoryFromReader = false;
    if (directory.open) { directoryNavigation = true; directory.close(); }
    if (reader.open) reader.close();
    pauseRoom();
    return;
  }
  const changed = currentId !== id;
  const position = !changed ? capturePosition() : null;
  if (changed) { page = 0; readingPosition = null; }
  currentId = id;
  seen.add(id);
  document.querySelector(`[data-entry="${id}"]`)?.classList.add('visited');
  if (directory.open) { directoryNavigation = true; directory.close(); }
  renderReader(position);
  if (!reader.open) {
    reader.showModal();
    restorePosition(readingPosition);
    $('#reader-close').focus({preventScroll:true});
  }
  room?.setActive(null);
  pauseRoom();
}
function navigate(id, source) {
  if (source && !source.closest('dialog')) roomReturnFocus = source;
  else if (!roomReturnFocus) roomReturnFocus = document.querySelector(`[data-entry="${id}"]`) || $('#menu-toggle');
  if (normaliseHash() !== id) history.pushState({study:true}, '', `#${id}`);
  renderRoute();
}
function closeReader() {
  cancelTurn();
  history.pushState({study:true}, '', `${location.pathname}${location.search}#top`);
  renderRoute();
}
function openDirectory() {
  if (directory.open) return;
  cancelTurn();
  directoryReturnFocus = document.activeElement;
  directoryFromReader = reader.open;
  directoryNavigation = false;
  if (reader.open) { readingPosition = capturePosition(); reader.close(); }
  else roomReturnFocus = document.activeElement;
  directory.showModal();
  $('#menu-toggle').setAttribute('aria-expanded', 'true');
  $('[data-close-directory]').focus({preventScroll:true});
  pauseRoom();
}
function closeDirectory() { directory.close(); }
function turn(delta) {
  if (!spreadMode || finishTurn) return;
  const max = buildSpreads().length-1;
  if (page+delta < 0 || page+delta > max) return;
  const oldPages = [...$('#book').querySelectorAll(':scope > .spread > .paper-page')].map(node => ({node:node.cloneNode(true),scroll:node.scrollTop}));
  page += delta;
  renderReader();
  if (motion.matches) return;
  const book = $('#book'), newPages = [...book.querySelectorAll(':scope > .spread > .paper-page')];
  const fixed = document.createElement('div'), leaf = document.createElement('div');
  fixed.className = `fixed-page ${delta > 0 ? 'left' : 'right'}`;
  fixed.append(oldPages[delta > 0 ? 0 : 1].node);
  leaf.className = `turning-leaf ${delta > 0 ? 'forward' : 'backward'}`;
  const front = document.createElement('div'), back = document.createElement('div');
  front.className = 'leaf-face leaf-front'; back.className = 'leaf-face leaf-back';
  front.append(oldPages[delta > 0 ? 1 : 0].node);
  back.append(newPages[delta > 0 ? 0 : 1].cloneNode(true));
  leaf.append(front,back);
  for (const layer of [fixed,leaf]) {
    layer.setAttribute('aria-hidden','true'); layer.inert = true;
    layer.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  }
  book.append(fixed,leaf);
  oldPages.forEach(({node,scroll}) => { node.scrollTop = scroll; });
  book.setAttribute('aria-busy','true');
  $('#previous-page').disabled = true; $('#next-page').disabled = true;
  let timeout, completed = false;
  const finish = () => {
    if (completed) return;
    completed = true; clearTimeout(timeout);
    leaf.remove(); fixed.remove(); book.removeAttribute('aria-busy'); finishTurn = null;
    $('#previous-page').disabled = page === 0; $('#next-page').disabled = page === max;
  };
  finishTurn = finish;
  leaf.addEventListener('animationend',finish,{once:true});
  leaf.addEventListener('animationcancel',finish,{once:true});
  timeout = setTimeout(finish,850);
}
async function copyEmail() {
  try { await navigator.clipboard.writeText(t().emailAddress); toast(u().emailCopied); }
  catch { toast(u().emailCopyFailed); }
}
let toastTimeout;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('#toast').classList.remove('visible'),3000);
}
let lastPositions = [];
function roomPositions(positions) {
  lastPositions = positions;
  const rect = $('#scene').getBoundingClientRect();
  for (const {id,x,y,visible} of positions) {
    const button = document.querySelector(`[data-entry="${id}"]`);
    if (!button) continue;
    button.style.left = `${x}px`; button.style.top = `${y}px`;
    button.style.visibility = visible !== false && x >= 22 && x <= rect.width-22 && y >= 22 && y <= rect.height-22 ? 'visible' : 'hidden';
    const labelWidth = Math.min(220,rect.width-24);
    button.style.setProperty('--label-shift', `${Math.max(labelWidth/2+12-x, Math.min(0,rect.width-12-labelWidth/2-x))}px`);
    button.classList.toggle('label-below',y < 80);
  }
}
function fallbackPositions() {
  const rect = $('#scene').getBoundingClientRect();
  const poster = posterAnchors[innerWidth < 1024 ? 'portrait' : 'landscape'];
  const scale = Math.min(rect.width/poster.width,rect.height/poster.height);
  const dx = (rect.width-poster.width*scale)/2, dy = (rect.height-poster.height*scale)/2;
  roomPositions(entryIds.map((id,i) => ({id,x:poster.points[i][0]*scale+dx,y:poster.points[i][1]*scale+dy,visible:true})));
}
function failScene() {
  room?.dispose(); room = null; window.studyRoom = null;
  $('#room-main').classList.add('room-fallback','is-ready');
  $('#lamp-toggle').hidden = true;
  fallbackPositions();
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-lang]');
  if (button) { if(language !== button.dataset.lang) { language = button.dataset.lang; applyLanguage(true); } return; }
  const link = event.target.closest('a[href^="#"]');
  if (!link || link.classList.contains('skip-link') || !document.documentElement.classList.contains('enhanced')) return;
  const hash = link.getAttribute('href').slice(1);
  if (!hash) return;
  event.preventDefault();
  if (hash === 'top') closeReader(); else navigate(hash,link);
});
$('#menu-toggle').addEventListener('click',openDirectory);
$('[data-close-directory]').addEventListener('click',closeDirectory);
$('.skip-link').addEventListener('click', event => {
  if (!document.documentElement.classList.contains('enhanced')) return;
  event.preventDefault(); openDirectory();
});
$('#reader-close').addEventListener('click',closeReader);
$('#reader-index').addEventListener('click',openDirectory);
$('#previous-page').addEventListener('click',() => turn(-1));
$('#next-page').addEventListener('click',() => turn(1));
reader.addEventListener('cancel',event => {event.preventDefault(); closeReader();});
reader.addEventListener('close',() => {
  if (reader.open || directory.open || directoryFromReader) return;
  pauseRoom(); restoreRoomFocus();
});
reader.addEventListener('scroll',event => {
  if (!reader.open) return;
  if (spreadMode && event.target.classList?.contains('paper-page')) {
    const leaf = [...event.target.parentElement.children].indexOf(event.target);
    readingPosition = {...readingPosition,leaf};
  }
  readingPosition = capturePosition();
},{capture:true,passive:true});
reader.addEventListener('keydown',event => {
  if (!spreadMode || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); turn(1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); turn(-1); }
});
directory.addEventListener('close',() => {
  $('#menu-toggle').setAttribute('aria-expanded','false');
  const resume = directoryFromReader && !directoryNavigation && !!normaliseHash();
  directoryFromReader = false;
  if (resume) {
    reader.showModal();
    restorePosition(readingPosition);
    const target = directoryReturnFocus?.isConnected && reader.contains(directoryReturnFocus) ? directoryReturnFocus : $('#reader-index');
    target.focus({preventScroll:true});
  } else if (!reader.open) restoreRoomFocus();
  pauseRoom();
});
directory.addEventListener('click',event => {
  if (event.target === directory && event.clientX < directory.getBoundingClientRect().left) closeDirectory();
});
function onLampChange(value) { $('#lamp-toggle').setAttribute('aria-pressed',String(value)); }
$('#lamp-toggle').addEventListener('click',() => {if(room)onLampChange(room.toggleLamp());});
$('#hints-toggle').addEventListener('click',() => {
  hints = !hints;
  $('#hints-toggle').setAttribute('aria-pressed',String(hints));
  $('#hotspots').classList.toggle('show-hints',hints); room?.setHints(hints);
});
window.addEventListener('popstate',() => {language=initialLanguage(); applyLanguage(); renderRoute();});
window.addEventListener('hashchange',renderRoute);
window.addEventListener('resize',() => {
  cancelTurn(); cancelAnimationFrame(resizeFrame);
  const position = readingPosition;
  resizeFrame = requestAnimationFrame(() => {
    if (!room) fallbackPositions();
    if (spreadMode !== readingLayout.matches) {
      spreadMode = readingLayout.matches;
      if (reader.open || directoryFromReader) renderReader(position);
    } else if (reader.open) restorePosition(position);
  });
});
motion.addEventListener('change',() => {cancelTurn(); room?.setReducedMotion(motion.matches);});
document.addEventListener('visibilitychange',pauseRoom);
for (const host of [directory,$('.reader-toolbar')]) {
  const group = document.createElement('div');
  group.className='language-switch reader-languages'; group.setAttribute('role','group');
  group.innerHTML='<button type="button" data-lang="zh">中</button><span aria-hidden="true">/</span><button type="button" data-lang="en">EN</button>';
  host.append(group);
}
reader.append($('#toast'));
applyLanguage();
document.documentElement.classList.add('enhanced');
document.documentElement.classList.remove('booting');
clearTimeout(window.studyBootTimer);
renderRoute();
const startupTimer = setTimeout(() => $('#room-main').classList.add('is-ready'),9000);
import('./room.js').then(async ({createRoom}) => {
  room = await createRoom({
    container:$('#scene'), onSelect:id => navigate(id,document.querySelector(`[data-entry="${id}"]`)), onPositions:roomPositions,
    onReady:() => {$('#room-main').classList.add('is-ready'); clearTimeout(startupTimer);},
    onError:failScene, onLampChange, reducedMotion:motion.matches
  });
  room.setLanguage(language); room.setHints(hints); pauseRoom();
  window.studyRoom = room;
}).catch(error => {console.warn('Room unavailable; keeping the illustrated study.',error); failScene();});
