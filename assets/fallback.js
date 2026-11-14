import {translations, ui, projects} from './content.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const paragraph = value => `<p>${escape(value)}</p>`;
const bulletList = values => `<ul>${values.map(value => `<li>${escape(value)}</li>`).join('')}</ul>`;

// Keep the printable document in the selected language. The original document
// in index.html remains available when JavaScript cannot run.
export function renderFallback(language) {
  const target = document.querySelector('#fallback');
  if (!target) return;
  const locale = language === 'en' ? 'en' : 'zh';
  const copy = translations[locale], labels = ui[locale];
  const navIds = ['projects', 'experience', 'about', 'learning', 'contact'];
  const projectTitle = project => project.titleKey ? copy[project.titleKey] : project.title;
  const projectArticles = projects.map(project => {
    const id = project.id;
    const isAnchorCell = id === 'anchorcell';
    const source = project.href
      ? `<p><a href="${escape(project.href)}" target="_blank" rel="noopener noreferrer">${escape(labels.viewProject)} ↗</a></p>`
      : '';
    const outcome = labels.projectOutcomes[id] ? paragraph(labels.projectOutcomes[id]) : '';
    const technology = project.tech.map(value => labels.techLabels[value] || value).join(' · ');
    return `<article id="project/${escape(id)}" aria-labelledby="fallback-project-${escape(id)}-title">
      <header${isAnchorCell ? ' id="featured"' : ''}>
        <h3 id="fallback-project-${escape(id)}-title">${escape(projectTitle(project))}</h3>
        <p>${escape(project.date)} · ${escape(copy[project.roleKey])}</p>
      </header>
      ${paragraph(labels.projectSummaries[id])}
      <div${isAnchorCell ? ' id="case-notes"' : ''}>
        ${isAnchorCell ? paragraph(copy.ventureContext) : ''}
        ${bulletList(labels.projectContributions[id])}
        ${isAnchorCell ? paragraph(copy.ventureValue) + paragraph(copy.ventureAward) : ''}
        ${outcome}
      </div>
      ${paragraph(technology)}
      ${source}
    </article>`;
  }).join('');
  const experiences = ['dc', 'qh'].map(key => `<article aria-labelledby="fallback-${key}-title">
    <h3 id="fallback-${key}-title">${escape(copy[`${key}Company`])}</h3>
    <p>${escape(copy[`${key}Role`])} · ${escape(copy[`${key}Dates`])} · ${escape(copy.beijing)}</p>
    ${paragraph(copy[`${key}Context`])}
    ${bulletList(['Responsibility', 'Solution', 'Value'].map(suffix => copy[`${key}${suffix}`]))}
  </article>`).join('');
  const steps = labels.aboutSteps.map(step => `<li><h3>${escape(step.title)}</h3>${paragraph(step.body)}</li>`).join('');
  const skills = ['skillProgramming', 'skillData', 'skillBigData', 'skillMethods']
    .map(key => `<div><dt>${escape(copy[key])}</dt><dd>${escape(copy[`${key}Value`])}</dd></div>`).join('');

  target.lang = locale === 'zh' ? 'zh-CN' : 'en';
  target.innerHTML = `<header id="top">
    <h1>${escape(copy.name)}</h1>
    ${paragraph(copy.heroSummary)}
    ${paragraph(copy.profileLocation)}
    <nav aria-label="${escape(labels.menu)}">${navIds.map(id => `<a href="#${id}">${escape(labels.entryLabels[id])}</a>`).join('')}</nav>
  </header>
  <section id="projects" aria-labelledby="fallback-projects-title">
    <h2 id="fallback-projects-title">${escape(copy.projectsHeading)}</h2>
    ${projectArticles}
  </section>
  <section id="experience" aria-labelledby="fallback-experience-title">
    <h2 id="fallback-experience-title">${escape(copy.experienceHeading)}</h2>
    ${experiences}
  </section>
  <section id="about" aria-labelledby="fallback-about-title">
    <h2 id="fallback-about-title">${escape(copy.aboutHeading)}</h2>
    ${paragraph(labels.aboutIntro)}
    <ol>${steps}</ol>
    <h3>${escape(copy.careerNoteTitle)}</h3>
    ${paragraph(labels.aboutTeam)}
  </section>
  <section id="learning" aria-labelledby="fallback-learning-title">
    <h2 id="fallback-learning-title">${escape(labels.entryLabels.learning)}</h2>
    <div id="education">
      <h3>${escape(copy.school)}</h3>
      <p>${escape(copy.major)} · ${escape(copy.educationDates)}</p>
      ${paragraph(copy.courses)}
      ${paragraph(copy.educationLanguage)}
    </div>
    <h3>${escape(copy.toolkitHeading)}</h3>
    <dl>${skills}</dl>
    <h3>${escape(copy.mathorTitle)}</h3>
    ${paragraph(copy.mathorDescription)}
  </section>
  <section id="contact" aria-labelledby="fallback-contact-title">
    <h2 id="fallback-contact-title">${escape(copy.contactHeading)}</h2>
    ${paragraph(copy.contactBody)}
    ${paragraph(copy.profileStatus)}
    <p><a href="mailto:${escape(copy.emailAddress)}">${escape(copy.emailAddress)}</a> · <a href="https://github.com/connerald" target="_blank" rel="noopener noreferrer">${escape(labels.visitGithub)} ↗</a></p>
  </section>`;
}
