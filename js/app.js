const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

async function fetchJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function applyTheme(config) {
  const root = document.documentElement.style;
  const c = config.colors || {};
  if (c.bg) root.setProperty('--color-bg', c.bg);
  if (c.cork) root.setProperty('--color-cork', c.cork);
  if (c.ink) root.setProperty('--color-ink', c.ink);
  if (c.accent) root.setProperty('--color-accent', c.accent);
  if (c.pin) root.setProperty('--color-pin', c.pin);
  if (c.line) root.setProperty('--color-line', c.line);

  document.getElementById('club-name').textContent = config.clubName || 'Club Hub';
  document.getElementById('club-tagline').textContent = config.tagline || '';
  document.title = config.clubName ? `${config.clubName} — Club Hub` : 'Club Hub';

  const bannerImg = document.getElementById('banner-img');
  const bannerFallback = document.getElementById('banner-fallback');
  if (config.bannerFile) {
    bannerImg.src = `${config.bannerFile}?v=${config.bannerVersion || 0}`;
    bannerImg.style.display = 'block';
    bannerFallback.style.display = 'none';
  } else {
    bannerImg.style.display = 'none';
    bannerFallback.style.display = 'block';
  }
}

function renderWall(posts) {
  const board = document.getElementById('wall-board');
  if (!posts || posts.length === 0) {
    board.innerHTML = '<p class="empty-state">Nothing on the wall yet.</p>';
    return;
  }
  const sorted = [...posts].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.date) - new Date(a.date);
  });
  board.innerHTML = sorted.map(p => `
    <div class="note-card${p.pinned ? ' pinned' : ''}">
      <span class="note-date">${formatDate(p.date)}</span>
      <h3 class="note-title">${escapeHtml(p.title)}</h3>
      <p class="note-body">${escapeHtml(p.body)}</p>
    </div>
  `).join('');
}

function renderCalendar(events) {
  const container = document.getElementById('calendar-list');
  if (!events || events.length === 0) {
    container.innerHTML = '<p class="empty-state" style="color:var(--color-ink);opacity:.6;">No events on the calendar yet.</p>';
    return;
  }
  const sorted = [...events].sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`) - new Date(`${b.date}T${b.time || '00:00'}`));

  let html = '';
  let lastMonthKey = '';
  for (const ev of sorted) {
    const d = new Date(`${ev.date}T${ev.time || '00:00'}`);
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
    if (monthKey !== lastMonthKey) {
      html += `<h3 class="month-heading">${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}</h3>`;
      lastMonthKey = monthKey;
    }
    html += `
      <div class="event-row">
        <div class="event-date-badge">
          <span class="dow">${DOW_NAMES[d.getDay()]}</span>
          <span class="dnum">${d.getDate()}</span>
        </div>
        <div class="event-info">
          <p class="event-title">${escapeHtml(ev.title)}</p>
          <p class="event-meta">${ev.time ? formatTime(ev.time) : ''}${ev.time && ev.location ? ' · ' : ''}${escapeHtml(ev.location || '')}</p>
          ${ev.description ? `<p class="event-desc">${escapeHtml(ev.description)}</p>` : ''}
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00`);
  return `${MONTH_NAMES[d.getMonth()].slice(0,3)} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

async function init() {
  setupTabs();
  try {
    const [config, posts, events] = await Promise.all([
      fetchJson('data/config.json'),
      fetchJson('data/posts.json'),
      fetchJson('data/events.json')
    ]);
    applyTheme(config);
    renderWall(posts);
    renderCalendar(events);
  } catch (e) {
    document.getElementById('wall-board').innerHTML =
      `<p class="empty-state">Couldn't load club data right now. Check your connection and reload.</p>`;
    console.error(e);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
