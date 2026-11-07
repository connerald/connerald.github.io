import {translations,ui,projects,entryIds} from './content.js';

const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lines = value => esc(value).replace(/\n/g,'<br>');
let language = initialLanguage(), page = 0, currentId = '', room = null, hints = false, returnFocus = null, directoryNavigation = false;
const reader=$('#reader'), directory=$('#directory'), motion=matchMedia('(prefers-reduced-motion: reduce)');
const seen=new Set();
let finishTurn = null;
function cancelTurn(){finishTurn?.();}
function updateDiscovery(){const count=entryIds.filter(id=>seen.has(id)).length;$('#discovery-progress').textContent=u().discoveryProgress.replace('{count}',count).replace('{total}',entryIds.length);}
const colors=['#526b54','#a2773d','#956249','#547270','#6c735d','#9a7949','#77628a'];
function initialLanguage(){const q=new URLSearchParams(location.search).get('lang');if(q==='zh'||q==='en')return q;try{return localStorage.getItem('site-language')==='en'?'en':'zh'}catch{return 'zh'}}
const t=()=>translations[language], u=()=>ui[language];
const title=p=>p.titleKey?t()[p.titleKey]:p.title;
const label=id=>u().entryLabels[id]??id;
const projectLink=p=>`<a href="#project/${esc(p.id)}"><span class="list-num">${String(projects.indexOf(p)+1).padStart(2,'0')}</span><span>${esc(title(p))}<small>${esc(t()[p.roleKey])}</small></span><span aria-hidden="true">↗</span></a>`;
function configureDirectory(){
  const ids=['projects','about','experience','learning','contact'];
  $('#directory-links').innerHTML=ids.map((id,i)=>`<a href="#${id}"><span>${String(i+1).padStart(2,'0')}</span>${esc(label(id))}<span aria-hidden="true">↗</span></a>`).join('');
  $('#directory-project-links').innerHTML=projects.map(p=>`<a href="#project/${p.id}">${esc(title(p))}</a>`).join('');
  if(!$('#hotspots').children.length)$('#hotspots').innerHTML=entryIds.map(id=>`<button type="button" class="hotspot${seen.has(id)?' visited':''}" data-entry="${id}" aria-label="${esc(label(id))}" style="left:50%;top:45%;visibility:hidden"><span class="hotspot-label">${esc(label(id))}</span></button>`).join('');
  $('#hotspots').querySelectorAll('button').forEach(b=>{
    b.setAttribute('aria-label',label(b.dataset.entry));b.querySelector('.hotspot-label').textContent=label(b.dataset.entry);
    if(b.dataset.bound)return;b.dataset.bound='true';
    b.addEventListener('pointerenter',()=>room?.setActive(b.dataset.entry));b.addEventListener('pointerleave',()=>room?.setActive(null));
    b.addEventListener('focus',()=>room?.setActive(b.dataset.entry));b.addEventListener('blur',()=>room?.setActive(null));
    b.addEventListener('click',()=>navigate(b.dataset.entry,b));
  });
}
function applyLanguage(updateUrl=false){
  document.documentElement.lang=language==='zh'?'zh-CN':'en';
  document.title=language==='zh'?'董俊叶的书房 · 数据工程与 AI':'Dong Junye’s Study · Data & AI';
  document.querySelectorAll('[data-ui]').forEach(el=>{const value=el.dataset.ui==='welcomeSummary'&&innerWidth<=700?u().mobileIntro:u()[el.dataset.ui];if(value!==undefined)el.innerHTML=lines(value)});
  document.querySelectorAll('[data-i18n]').forEach(el=>{if(t()[el.dataset.i18n])el.textContent=t()[el.dataset.i18n]});
  document.querySelectorAll('[data-lang]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.lang===language)));
  for(const selector of ['meta[name="description"]','meta[property="og:description"]','meta[name="twitter:description"]'])$(selector).content=t().description;
  for(const selector of ['meta[property="og:title"]','meta[name="twitter:title"]'])$(selector).content=document.title;
  $('meta[property="og:locale"]').content=language==='zh'?'zh_CN':'en_US';
  $('#room-main').setAttribute('aria-label',u().roomTitle);$('#hotspots').setAttribute('aria-label',u().hotspotLabel);
  $('#reader-close').setAttribute('aria-label',u().closeReader);$('[data-close-directory]').setAttribute('aria-label',u().closeMenu);
  $('#directory-links').setAttribute('aria-label',u().menu);$('.language-switch').setAttribute('aria-label',u().language);
  configureDirectory();if(room){room.setLanguage(language);roomPositions(lastPositions)}else{fallbackPositions()}
  if(returnFocus?.dataset.entry)returnFocus=document.querySelector(`[data-entry="${returnFocus.dataset.entry}"]`);if(reader.open)renderReader();updateDiscovery();
  try{localStorage.setItem('site-language',language)}catch{/* Optional preference storage. */}
  if(updateUrl){const url=new URL(location.href);url.searchParams.set('lang',language);history.replaceState(history.state,'',url)}
}
function ptext(key,cls=''){return `<p${cls?` class="${cls}"`:''}>${esc(t()[key])}</p>`}
function head(kicker,heading){return `<p class="eyebrow">${esc(kicker)}</p><h2${heading===currentTitle()?' id="reader-title"':''}>${esc(heading)}</h2>`}
function currentTitle(){if(currentId.startsWith('project/')){const p=projects.find(p=>p.id===currentId.split('/')[1]);return p?title(p):''}return label(currentId)}
function spread(left,right){return `<div class="spread"><section class="paper-page">${left}<span class="paper-number">DONG JUNYE / PERSONAL COLLECTION</span></section><section class="paper-page">${right}<span class="paper-number">${language==='zh'?'从数据出发，让判断有据可依。':'START WITH DATA. KEEP THE EVIDENCE.'}</span></section></div>`}
function tags(p){return `<div class="tags">${p.tech.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`}
function diagram(id){
 const z=language==='zh';
 const flows={anchorcell:z?['业务问题','只读工具','数据与证据']:['Question','Read-only tools','Data & evidence'],battery:z?['设备层级','安全监测','风险预警']:['Device hierarchy','Monitoring','Risk warnings'],cara:['Intent Router','ReAct Agents',z?'证据追溯':'Evidence'],tsinglink:z?['需求与模型','Django','发布与查询']:['Requirements','Django','Publish & search'],crypto:['Binance','Kafka / Spark','Flask / Socket.IO'],behavior:['Hadoop / YARN','PySpark / SQL',z?'分析与分群':'Analytics'],paper:[z?'论文内容':'Content','LaTeX',z?'规范排版':'Typesetting']};
 return `<figure class="diagram"><figcaption class="diagram-label">${esc(u().diagram)}</figcaption>${['anchorcell','battery'].includes(id)?'<div class="battery-art" aria-hidden="true"><i></i><i></i><i></i></div>':''}<div class="flow">${flows[id].map((x,i)=>`${i?'<span class="flow-arrow" aria-hidden="true">→</span>':''}<span class="flow-node">${esc(x)}</span>`).join('')}</div><p class="diagram-caption">${z?'依据项目方法绘制的流程示意':'A schematic of the project approach'}</p></figure>`;
}
function projectSpreads(project){
 const i=projects.indexOf(project);reader.style.setProperty('--book-accent',colors[i]);
 const left=head(`${u().projectNotes} / ${String(i+1).padStart(2,'0')}`,title(project))+`<p class="project-role">${esc(project.date)}<br>${esc(t()[project.roleKey])}</p>`+ptext(project.descriptionKey,'lead')+tags(project)+`<a class="paper-link" href="#projects">${esc(u().backToProjects)} <span aria-hidden="true">↗</span></a>`;
 let right;
 if(project.id==='anchorcell'){
  right=`<p class="eyebrow">01 / ${esc(u().projectOverview)}</p><p class="big-quote">${esc(t().caseQuestion)}</p>`+ptext('ventureContext')+diagram('anchorcell');
  return [spread(left,right),spread(head(`02 / ${u().myWork}`,language==='zh'?'让判断，回到证据。':'Keep the evidence close.')+ptext('ventureResponsibility','lead')+`<h3>${esc(t().solutionLabel)}</h3>`+ptext('ventureSolution'),head(u().approach,language==='zh'?'可靠运行，也认真评测。':'Reliability, tested.')+ptext('ventureValue')+`<div class="data-stamp"><strong>40+</strong><span>${esc(t().ventureAward)}</span></div>`+tags(project))];
 }
 right=head(u().approach,u().projectHeadings[project.id])+diagram(project.id)+`<p>${esc(u().projectCaptions[project.id])}</p>`;
 if(project.href)right+=`<a class="paper-link" href="${esc(project.href)}" target="_blank" rel="noopener noreferrer">${esc(u().viewProject)} <span aria-hidden="true">↗</span></a>`;
 else if(project.statusKey)right+=`<p class="page-note">${esc(t()[project.statusKey])}</p>`;
 return [spread(left,right)];
}
function buildSpreads(){
 reader.style.setProperty('--book-accent','#6c7254');
 if(currentId.startsWith('project/'))return projectSpreads(projects.find(p=>p.id===currentId.split('/')[1]));
 if(currentId==='projects')return [spread(head('THE PROJECT INDEX',label('projects'))+`<p class="lead">${esc(t().projectsHeading)}</p><p>${esc(u().projectCount)}</p><div class="folio-rule"></div><p class="big-quote">${esc(t().heroRole)}</p><p class="page-note">${esc(u().navigationHint)}</p>`,`<ol class="project-list">${projects.map(p=>`<li>${projectLink(p)}</li>`).join('')}</ol>`)];
 if(currentId==='about')return [spread(head('A LITTLE ABOUT ME',label('about'))+`<div class="profile-initials" aria-hidden="true">dj.</div><p class="lead">${esc(t().heroSummary)}</p>`+ptext('aboutIntro')+`<p class="page-note">${esc(t().profileLocation)} / ${esc(t().profileStatus)}</p>`,[1,2,3].map(n=>`<h3>${esc(t()[`principle${n}Title`])}</h3>${ptext(`principle${n}Body`)}`).join('')+`<h3>${esc(t().careerNoteTitle)}</h3>${ptext('careerNoteBody')}`)];
 if(currentId==='experience')return ['dc','qh'].map((key,i)=>spread(head(`EXPERIENCE / 0${i+1}`,i===0?label('experience'):t()[`${key}Company`])+`<h3>${esc(t()[`${key}Company`])}</h3><p class="project-role">${esc(t()[`${key}Role`])}<br>${esc(t()[`${key}Dates`])} / ${esc(t().beijing)}</p>`+ptext(`${key}Context`,'lead')+`<h3>${esc(t().responsibilityLabel)}</h3>`+ptext(`${key}Responsibility`),head(u().approach,i===0?(language==='zh'?'连起实验数据的链路':'Connecting laboratory data'):(language==='zh'?'把重复计算，变成工具':'Turning routines into tools'))+`<h3>${esc(t().solutionLabel)}</h3>`+ptext(`${key}Solution`)+`<h3>${esc(t().valueLabel)}</h3>`+ptext(`${key}Value`)+`<div class="tags">${(i===0?['Azure Data Factory','Databricks','Synapse','SQL']:['Python','MySQL','Risk Metrics']).map(v=>`<span>${v}</span>`).join('')}</div>`));
 if(currentId==='learning')return [spread(head('LEARNING / ALWAYS IN PROGRESS',label('learning'))+`<h3>${esc(t().school)}</h3><p class="project-role">${esc(t().major)}<br>${esc(t().educationDates)}</p>`+ptext('courses')+ptext('educationLanguage')+`<h3>${esc(t().mathorTitle)}</h3>`+ptext('mathorDescription'),head('THE TOOLKIT',u().toolkit)+[['skillProgramming','skillProgrammingValue'],['skillData','skillDataValue'],['skillBigData','skillBigDataValue'],['skillMethods','skillMethodsValue']].map(([a,b])=>`<div class="skill-row"><strong>${esc(t()[a])}</strong>${esc(t()[b])}</div>`).join('')+`<h3>${esc(t().capability1Title)}</h3>`+ptext('capability1Body')+`<h3>${esc(t().capability3Title)}</h3>`+ptext('capability3Body'))];
 return [spread(head('A NOTE TO SAY HELLO',label('contact'))+`<p class="big-quote">${esc(t().contactHeading)}</p>`+ptext('contactBody')+`<div class="contact-seal" aria-hidden="true">dj.</div><p class="page-note">${esc(t().profileLocation)} · ${esc(t().profileStatus)}</p>`,`<p class="eyebrow">${esc(u().sendEmail)}</p><a class="contact-email" href="mailto:connerald359@163.com">connerald359@163.com</a><div class="contact-actions"><a class="paper-link" href="mailto:connerald359@163.com">${esc(u().sendEmail)} ↗</a><button type="button" class="paper-link" id="copy-email">${esc(u().copyEmail)}</button></div><div class="folio-rule"></div><h3>GitHub</h3><p>github.com/connerald</p><a class="paper-link" href="https://github.com/connerald" target="_blank" rel="noopener noreferrer">${esc(u().visitGithub)} ↗</a>`)];
}
function renderReader(){
 cancelTurn();
 const spreads=buildSpreads();page=Math.min(page,spreads.length-1);
 $('#book').innerHTML=spreads[page]+`<div class="mobile-continuation">${spreads.filter((_,i)=>i!==page).join('')}</div>`;
 // The first visible heading always labels the dialog, including non-project entries.
 const headings=$('#book').querySelectorAll('h2');headings.forEach(h=>h.removeAttribute('id'));if(headings[0])headings[0].id='reader-title';
 $('#page-count').textContent=`${String(page+1).padStart(2,'0')} / ${String(spreads.length).padStart(2,'0')}`;
 $('#previous-page').disabled=page===0;$('#next-page').disabled=page===spreads.length-1;
 $('#copy-email')?.addEventListener('click',copyEmail);
}
function normaliseHash(){let h;try{h=decodeURIComponent(location.hash.slice(1))}catch{return ''}if(h==='featured'||h==='case-notes')h='project/anchorcell';if(h==='education')h='learning';return entryIds.includes(h)||projects.some(p=>h===`project/${p.id}`)?h:''}
function renderRoute(){const id=normaliseHash();if(!id){cancelTurn();if(reader.open)reader.close();currentId='';room?.setPaused(directory.open);return}if(currentId!==id)page=0;currentId=id;seen.add(id);updateDiscovery();document.querySelector(`[data-entry="${id}"]`)?.classList.add('visited');if(directory.open){directoryNavigation=true;directory.close()}renderReader();if(!reader.open){reader.showModal();$('#reader-close').focus({preventScroll:true})}room?.setActive(null);room?.setPaused(true)}
function navigate(id,source){returnFocus=source&&!directory.contains(source)?source:(document.querySelector(`[data-entry="${id}"]`)||$('#menu-toggle'));if(normaliseHash()===id){renderRoute();return}history.pushState({study:true},'',`#${id}`);renderRoute()}
function closeReader(){if(!normaliseHash())return;history.pushState({study:true},'',`${location.pathname}${location.search}#top`);renderRoute()}
function openDirectory(){if(directory.open)return;returnFocus=document.activeElement;if(reader.open)reader.close();directoryNavigation=false;directory.showModal();$('#menu-toggle').setAttribute('aria-expanded','true');room?.setPaused(true)}
function closeDirectory(){directory.close()}
function turn(delta){
 if(finishTurn)return;
 const max=buildSpreads().length-1;if(page+delta<0||page+delta>max)return;
 const oldSpreadPages=[...$('#book').querySelectorAll(':scope>.spread>.paper-page')].map(el=>el.cloneNode(true));
 page+=delta;renderReader();if(motion.matches||innerWidth<=700)return;
 const book=$('#book'),newPages=[...book.querySelectorAll(':scope>.spread>.paper-page')];
 const fixed=document.createElement('div');fixed.className=`fixed-page ${delta>0?'left':'right'}`;
 fixed.append(oldSpreadPages[delta>0?0:1]);fixed.setAttribute('aria-hidden','true');fixed.inert=true;
 const leaf=document.createElement('div');leaf.className=`turning-leaf ${delta>0?'forward':'backward'}`;leaf.setAttribute('aria-hidden','true');leaf.inert=true;
 const front=document.createElement('div'),back=document.createElement('div');front.className='leaf-face leaf-front';back.className='leaf-face leaf-back';
 front.append(oldSpreadPages[delta>0?1:0]);back.append(newPages[delta>0?0:1].cloneNode(true));leaf.append(front,back);
 for(const layer of [fixed,leaf])layer.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
 book.append(fixed,leaf);book.setAttribute('aria-busy','true');
 $('#previous-page').disabled=true;$('#next-page').disabled=true;
 let timeout, completed=false;
 const finish=()=>{if(completed)return;completed=true;clearTimeout(timeout);leaf.remove();fixed.remove();book.removeAttribute('aria-busy');finishTurn=null;$('#previous-page').disabled=page===0;$('#next-page').disabled=page===max;};
 finishTurn=finish;
 leaf.addEventListener('animationend',finish,{once:true});leaf.addEventListener('animationcancel',finish,{once:true});
 timeout=setTimeout(finish,850);
}
async function copyEmail(){try{await navigator.clipboard.writeText('connerald359@163.com');toast(u().emailCopied)}catch{toast(u().emailCopyFailed)}}
let toastTimeout;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('#toast').classList.remove('visible'),3000)}
let lastPositions=[];
function roomPositions(positions){lastPositions=positions;for(const {id,x,y,visible}of positions){const b=document.querySelector(`[data-entry="${id}"]`);if(!b)continue;b.style.left=`${x}px`;b.style.top=`${y}px`;b.style.visibility=visible===false?'hidden':'visible'}}
// Pixel anchors exported from the same original scene as each poster.
const posterAnchors={landscape:{width:1440,height:900,points:[[855,391],[977,393],[1108,386],[450,594],[411,325],[682,568],[980,532],[579,349]]},portrait:{width:390,height:844,points:[[177,367],[256,368],[341,364],[64,496],[105,255],[206,481],[259,459],[199,268]]}};
function fallbackPositions(){const rect=$('#scene').getBoundingClientRect(), poster=posterAnchors[innerWidth<=700?'portrait':'landscape'];const scale=Math.max(rect.width/poster.width,rect.height/poster.height),dx=(rect.width-poster.width*scale)/2,dy=(rect.height-poster.height*scale)/2;roomPositions(entryIds.map((id,i)=>{const [px,py]=poster.points[i],x=px*scale+dx,y=py*scale+dy;return {id,x,y,visible:x>=22&&x<=rect.width-22&&y>=22&&y<=rect.height-22}}))}
function failScene(){room?.dispose();room=null;$('#room-main').classList.add('room-fallback','is-ready');$('#lamp-toggle').hidden=true;fallbackPositions()}
// Register native controls before enabling the immersive layout.
for(const host of [document])host.addEventListener('click',event=>{
 const button=event.target.closest('[data-lang]');if(button){language=button.dataset.lang;applyLanguage(true);return}
 const link=event.target.closest('a[href^="#"]');if(!link||link.classList.contains('skip-link'))return;
 const hash=link.getAttribute('href').slice(1);if(!hash)return;event.preventDefault();if(hash==='top'){closeReader();return}navigate(hash,link);
});
$('#menu-toggle').addEventListener('click',openDirectory);$('[data-close-directory]').addEventListener('click',closeDirectory);
$('.skip-link').addEventListener('click',event=>{event.preventDefault();openDirectory()});
$('#reader-close').addEventListener('click',closeReader);$('#reader-index').addEventListener('click',openDirectory);
$('#previous-page').addEventListener('click',()=>turn(-1));$('#next-page').addEventListener('click',()=>turn(1));
reader.addEventListener('cancel',event=>{event.preventDefault();closeReader()});
reader.addEventListener('close',()=>{room?.setPaused(directory.open);if(!directory.open&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true})});
reader.addEventListener('keydown',event=>{if(innerWidth<=700)return;if(event.key==='ArrowRight'){event.preventDefault();turn(1)}if(event.key==='ArrowLeft'){event.preventDefault();turn(-1)}});
directory.addEventListener('close',()=>{$('#menu-toggle').setAttribute('aria-expanded','false');if(normaliseHash()&&!directoryNavigation)renderRoute();room?.setPaused(reader.open);if(!reader.open)$('#menu-toggle').focus({preventScroll:true})});
directory.addEventListener('click',event=>{if(event.target===directory&&event.clientX<directory.getBoundingClientRect().left)closeDirectory()});
function onLampChange(isOn){$('#lamp-toggle').setAttribute('aria-pressed',String(isOn))}
$('#lamp-toggle').addEventListener('click',()=>{if(room)onLampChange(room.toggleLamp())});
$('#hints-toggle').addEventListener('click',()=>{hints=!hints;$('#hints-toggle').setAttribute('aria-pressed',hints);$('#hotspots').classList.toggle('show-hints',hints);room?.setHints(hints)});
window.addEventListener('popstate',()=>{language=initialLanguage();applyLanguage();renderRoute()});
window.addEventListener('hashchange',renderRoute);
window.addEventListener('resize',()=>{cancelTurn();$('.welcome-summary').innerHTML=lines(innerWidth<=700?u().mobileIntro:u().welcomeSummary);if(!room)fallbackPositions();if(innerWidth<=700&&page!==0&&reader.open){page=0;renderReader()}});
motion.addEventListener('change',()=>{cancelTurn();room?.setReducedMotion(motion.matches)});
document.addEventListener('visibilitychange',()=>room?.setPaused(document.hidden||reader.open||directory.open));
// Reader and directory can each change language without leaving the current content.
for(const host of [$('#directory'),$('.reader-toolbar')]){const div=document.createElement('div');div.className='language-switch reader-languages';div.setAttribute('role','group');div.setAttribute('aria-label','语言 / Language');div.innerHTML='<button type="button" data-lang="zh">中</button><span aria-hidden="true">/</span><button type="button" data-lang="en">EN</button>';host.append(div)}
reader.append($('#toast'));applyLanguage();document.documentElement.classList.add('enhanced');document.documentElement.classList.remove('booting');clearTimeout(window.studyBootTimer);renderRoute();
let startupTimer=setTimeout(()=>{$('#room-main').classList.add('is-ready')},9000);
import('./room.js').then(async({createRoom})=>{
 room=await createRoom({container:$('#scene'),onSelect:id=>navigate(id),onPositions:roomPositions,onReady:()=>{$('#room-main').classList.add('is-ready');clearTimeout(startupTimer)},onError:failScene,onLampChange:onLampChange,reducedMotion:motion.matches});
 room.setLanguage(language);room.setHints(hints);room.setPaused(document.hidden||reader.open||directory.open);
 window.studyRoom=room;
}).catch(error=>{console.warn('Room unavailable; keeping the illustrated study.',error);failScene()});
