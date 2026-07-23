const LS_OWNER = 'clubhub_owner';
const LS_REPO = 'clubhub_repo';
const LS_BRANCH = 'clubhub_branch';
const LS_REMEMBER = 'clubhub_remember_token';

let state = {
  owner: '', repo: '', branch: '', token: '',
  config: null, configSha: null,
  events: [], eventsSha: null,
  posts: [], postsSha: null,
  editingEventId: null,
  editingPostId: null
};

const $ = (id) => document.getElementById(id);

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'status-line' + (type ? ' ' + type : '');
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- Setup / connection ----------

function loadSavedConnection() {
  $('f-owner').value = localStorage.getItem(LS_OWNER) || '';
  $('f-repo').value = localStorage.getItem(LS_REPO) || '';
  $('f-branch').value = localStorage.getItem(LS_BRANCH) || '';
  if (localStorage.getItem(LS_REMEMBER) === '1') {
    $('f-remember').checked = true;
  }
}

async function handleConnect() {
  const owner = $('f-owner').value.trim();
  const repo = $('f-repo').value.trim();
  const branch = $('f-branch').value.trim();
  const token = $('f-token').value.trim();
  const remember = $('f-remember').checked;
  const status = $('connect-status');

  if (!owner || !repo || !token) {
    setStatus(status, 'Fill in owner, repo, and a token.', 'err');
    return;
  }

  setStatus(status, 'Connecting…', 'busy');
  $('connect-btn').disabled = true;

  try {
    await GitHubAPI.verifyAccess({ owner, repo, token });

    state.owner = owner;
    state.repo = repo;
    state.branch = branch;
    state.token = token;

    localStorage.setItem(LS_OWNER, owner);
    localStorage.setItem(LS_REPO, repo);
    localStorage.setItem(LS_BRANCH, branch);
    localStorage.setItem(LS_REMEMBER, remember ? '1' : '0');
    if (remember) {
      localStorage.setItem('clubhub_token', token);
      sessionStorage.removeItem('clubhub_token');
    } else {
      sessionStorage.setItem('clubhub_token', token);
      localStorage.removeItem('clubhub_token');
    }

    await loadAllData();

    setStatus(status, 'Connected.', 'ok');
    $('connected-badge').style.display = 'inline-block';
    document.querySelectorAll('.panel.data-panel').forEach(p => p.style.display = 'block');
    $('connect-details').open = false;
    $('appearance-details').open = false;
  } catch (e) {
    setStatus(status, `Couldn't connect: ${e.message}`, 'err');
  } finally {
    $('connect-btn').disabled = false;
  }
}

async function loadAllData() {
  const { owner, repo, branch, token } = state;

  const configRes = await GitHubAPI.getJsonFile({ owner, repo, branch, token, path: 'data/config.json' });
  state.config = configRes ? configRes.json : { clubName: '', tagline: '', colors: {} };
  state.configSha = configRes ? configRes.sha : null;
  fillAppearanceForm();

  const eventsRes = await GitHubAPI.getJsonFile({ owner, repo, branch, token, path: 'data/events.json' });
  state.events = eventsRes ? eventsRes.json : [];
  state.eventsSha = eventsRes ? eventsRes.sha : null;
  renderEventList();

  const postsRes = await GitHubAPI.getJsonFile({ owner, repo, branch, token, path: 'data/posts.json' });
  state.posts = postsRes ? postsRes.json : [];
  state.postsSha = postsRes ? postsRes.sha : null;
  renderPostList();
}

// ---------- Appearance ----------

function fillAppearanceForm() {
  const c = state.config || {};
  $('a-club-name').value = c.clubName || '';
  $('a-tagline').value = c.tagline || '';
  const colors = c.colors || {};
  $('a-color-bg').value = colors.bg || '#EFE8D8';
  $('a-color-cork').value = colors.cork || '#7C5A3F';
  $('a-color-ink').value = colors.ink || '#2B2A28';
  $('a-color-accent').value = colors.accent || '#3D5A80';
  $('a-color-pin').value = colors.pin || '#B23A2E';
  $('a-color-line').value = colors.line || '#D8CBB0';

  if (c.bannerFile) {
    $('current-banner').src = `${c.bannerFile}?v=${c.bannerVersion || 0}`;
    $('current-banner').style.display = 'block';
  } else {
    $('current-banner').style.display = 'none';
  }
}

async function handleSaveAppearance() {
  const status = $('appearance-status');
  setStatus(status, 'Saving…', 'busy');
  $('save-appearance-btn').disabled = true;
  try {
    const clubName = $('a-club-name').value.trim();
    const tagline = $('a-tagline').value.trim();
    const colors = {
      bg: $('a-color-bg').value,
      cork: $('a-color-cork').value,
      ink: $('a-color-ink').value,
      accent: $('a-color-accent').value,
      pin: $('a-color-pin').value,
      line: $('a-color-line').value
    };

    let bannerFile = null, bannerPath = null;
    const fileInput = $('a-banner-file').files[0];
    if (fileInput) {
      const ext = fileInput.name.split('.').pop().toLowerCase();
      bannerPath = `assets/banner.${ext}`;
      await GitHubAPI.putBinaryFile({
        owner: state.owner, repo: state.repo, branch: state.branch, token: state.token,
        path: bannerPath, file: fileInput, message: 'Update club banner'
      });
    }

    const { result, json } = await GitHubAPI.updateJsonFile({
      owner: state.owner, repo: state.repo, branch: state.branch, token: state.token,
      path: 'data/config.json',
      mutate: (current) => {
        const merged = { ...(current || {}), clubName, tagline, colors };
        if (bannerPath) {
          merged.bannerFile = bannerPath;
          merged.bannerVersion = Date.now();
        }
        return merged;
      },
      message: 'Update club appearance'
    });

    state.config = json;
    state.configSha = result.content.sha;
    fillAppearanceForm();
    setStatus(status, 'Saved. Changes go live in about a minute.', 'ok');
  } catch (e) {
    setStatus(status, `Couldn't save: ${e.message}`, 'err');
  } finally {
    $('save-appearance-btn').disabled = false;
  }
}

// ---------- Events ----------

function isPastEvent(ev, now = new Date()) {
  const cutoff = new Date(`${ev.date}T${ev.time || '23:59'}`);
  return cutoff < now;
}

function renderEventList() {
  const list = $('event-list');
  const sorted = [...state.events].sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`) - new Date(`${b.date}T${b.time || '00:00'}`));
  if (sorted.length === 0) {
    list.innerHTML = '<p class="hint">No events yet.</p>';
    $('bulk-delete-past-btn').style.display = 'none';
    return;
  }
  const pastCount = sorted.filter(ev => isPastEvent(ev)).length;
  $('bulk-delete-past-btn').style.display = pastCount > 0 ? 'inline-block' : 'none';
  $('bulk-delete-past-btn').textContent = `Delete ${pastCount} past event${pastCount === 1 ? '' : 's'}`;

  list.innerHTML = sorted.map(ev => {
    const past = isPastEvent(ev);
    return `
    <div class="item-row${past ? ' past' : ''}">
      <div class="item-main">
        <strong>${escapeHtml(ev.title)}${past ? ' <span class="past-tag">PAST</span>' : ''}</strong>
        <span>${ev.date}${ev.time ? ' · ' + ev.time : ''}${ev.location ? ' · ' + escapeHtml(ev.location) : ''}</span>
      </div>
      <button type="button" title="Edit" data-edit-event="${ev.id}">✏️</button>
      <button type="button" title="Delete" data-del-event="${ev.id}">🗑️</button>
    </div>
  `;
  }).join('');

  list.querySelectorAll('[data-edit-event]').forEach(btn =>
    btn.addEventListener('click', () => startEditEvent(btn.dataset.editEvent)));
  list.querySelectorAll('[data-del-event]').forEach(btn =>
    btn.addEventListener('click', () => handleDeleteEvent(btn.dataset.delEvent)));
}

async function handleDeletePastEvents() {
  const past = state.events.filter(ev => isPastEvent(ev));
  if (past.length === 0) return;
  if (!confirm(`Delete ${past.length} past event${past.length === 1 ? '' : 's'}? This can't be undone.`)) return;
  const status = $('event-status');
  setStatus(status, 'Deleting…', 'busy');
  try {
    await writeEvents((current) => current.filter(ev => !isPastEvent(ev)), `Delete ${past.length} past event(s)`);
    setStatus(status, 'Deleted.', 'ok');
  } catch (e) {
    setStatus(status, `Couldn't delete: ${e.message}`, 'err');
  }
}

function startEditEvent(id) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return;
  state.editingEventId = id;
  $('e-title').value = ev.title || '';
  $('e-date').value = ev.date || '';
  $('e-time').value = ev.time || '';
  $('e-location').value = ev.location || '';
  $('e-description').value = ev.description || '';
  $('event-form-title').textContent = 'Edit event';
  $('cancel-event-edit').style.display = 'inline-block';
  $('e-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetEventForm() {
  state.editingEventId = null;
  $('e-title').value = '';
  $('e-date').value = '';
  $('e-time').value = '';
  $('e-location').value = '';
  $('e-description').value = '';
  $('event-form-title').textContent = 'Add event';
  $('cancel-event-edit').style.display = 'none';
}

async function writeEvents(mutate, message) {
  const { result, json } = await GitHubAPI.updateJsonFile({
    owner: state.owner, repo: state.repo, branch: state.branch, token: state.token,
    path: 'data/events.json', mutate: (current) => mutate(current || []), message
  });
  state.events = json;
  state.eventsSha = result.content.sha;
  renderEventList();
}

async function handleSaveEvent() {
  const status = $('event-status');
  const title = $('e-title').value.trim();
  const date = $('e-date').value;
  if (!title || !date) {
    setStatus(status, 'Title and date are required.', 'err');
    return;
  }
  setStatus(status, 'Saving…', 'busy');
  $('save-event-btn').disabled = true;
  try {
    const payload = {
      id: state.editingEventId || newId('evt'),
      title, date,
      time: $('e-time').value,
      location: $('e-location').value.trim(),
      description: $('e-description').value.trim()
    };
    const editingId = state.editingEventId;
    await writeEvents(
      (current) => editingId
        ? current.map(ev => ev.id === editingId ? payload : ev)
        : [...current, payload],
      editingId ? `Update event: ${title}` : `Add event: ${title}`
    );
    resetEventForm();
    setStatus(status, 'Saved.', 'ok');
  } catch (e) {
    setStatus(status, `Couldn't save: ${e.message}`, 'err');
  } finally {
    $('save-event-btn').disabled = false;
  }
}

async function handleDeleteEvent(id) {
  const ev = state.events.find(e => e.id === id);
  if (!ev || !confirm(`Delete "${ev.title}"?`)) return;
  const status = $('event-status');
  setStatus(status, 'Deleting…', 'busy');
  try {
    await writeEvents((current) => current.filter(e => e.id !== id), `Delete event: ${ev.title}`);
    setStatus(status, 'Deleted.', 'ok');
    if (state.editingEventId === id) resetEventForm();
  } catch (e) {
    setStatus(status, `Couldn't delete: ${e.message}`, 'err');
  }
}

// ---------- Posts ----------

// Downscales/re-encodes an uploaded image in the browser before it gets
// committed via the GitHub API, so a full-size phone photo doesn't turn
// into a multi-megabyte blob in the repo's history every time.
function compressImage(file, maxDim = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Image compression failed.')); return; }
        resolve(blob);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image file.')); };
    img.src = url;
  });
}

function renderPostList() {
  const list = $('post-list');
  const sorted = [...state.posts].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (sorted.length === 0) {
    list.innerHTML = '<p class="hint">No announcements yet.</p>';
    return;
  }
  list.innerHTML = sorted.map(p => `
    <div class="item-row">
      <div class="item-main">
      <strong>${escapeHtml(p.title)}${p.pinned ? ' 📌' : ''}${p.image ? ' 🖼️' : ''}</strong>        <span>${p.date}</span>
      </div>
      <button type="button" title="Edit" data-edit-post="${p.id}">✏️</button>
      <button type="button" title="Delete" data-del-post="${p.id}">🗑️</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-edit-post]').forEach(btn =>
    btn.addEventListener('click', () => startEditPost(btn.dataset.editPost)));
  list.querySelectorAll('[data-del-post]').forEach(btn =>
    btn.addEventListener('click', () => handleDeletePost(btn.dataset.delPost)));
}

function startEditPost(id) {
  const p = state.posts.find(x => x.id === id);
  if (!p) return;
  state.editingPostId = id;
  $('p-title').value = p.title || '';
  $('p-body').value = p.body || '';
  $('p-date').value = p.date || '';
  $('p-pinned').checked = !!p.pinned;
  $('p-image-file').value = '';
  $('p-remove-image').checked = false;
  if (p.image) {
    $('current-post-image').src = `${p.image}?v=${p.imageVersion || 0}`;
    $('current-post-image').style.display = 'block';
    $('p-remove-image-row').style.display = 'flex';
  } else {
    $('current-post-image').style.display = 'none';
    $('p-remove-image-row').style.display = 'none';
  }
  $('post-form-title').textContent = 'Edit announcement';
  $('cancel-post-edit').style.display = 'inline-block';
  $('p-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetPostForm() {
  state.editingPostId = null;
  $('p-title').value = '';
  $('p-body').value = '';
  $('p-date').value = new Date().toISOString().slice(0, 10);
  $('p-pinned').checked = false;
  $('p-image-file').value = '';
  $('p-remove-image').checked = false;
  $('current-post-image').style.display = 'none';
  $('p-remove-image-row').style.display = 'none';
  $('post-form-title').textContent = 'Add announcement';
  $('cancel-post-edit').style.display = 'none';
}

async function writePosts(mutate, message) {
  const { result, json } = await GitHubAPI.updateJsonFile({
    owner: state.owner, repo: state.repo, branch: state.branch, token: state.token,
    path: 'data/posts.json', mutate: (current) => mutate(current || []), message
  });
  state.posts = json;
  state.postsSha = result.content.sha;
  renderPostList();
}

async function handleSavePost() {
  const status = $('post-status');
  const title = $('p-title').value.trim();
  const date = $('p-date').value;
  if (!title || !date) {
    setStatus(status, 'Title and date are required.', 'err');
    return;
  }
  setStatus(status, 'Saving…', 'busy');
  $('save-post-btn').disabled = true;
  try {
    const editingId = state.editingPostId;
    const postId = editingId || newId('post');
    const existing = editingId ? state.posts.find(p => p.id === editingId) : null;

    let image = existing ? existing.image : undefined;
    let imageVersion = existing ? existing.imageVersion : undefined;

    if ($('p-remove-image').checked) {
      image = undefined;
      imageVersion = undefined;
    }

    const imageFile = $('p-image-file').files[0];
    if (imageFile) {
      setStatus(status, 'Compressing image…', 'busy');
      const compressed = await compressImage(imageFile);
      const imagePath = `assets/posts/${postId}.jpg`;
      setStatus(status, 'Uploading image…', 'busy');
      await GitHubAPI.putBinaryFile({
        owner: state.owner, repo: state.repo, branch: state.branch, token: state.token,
        path: imagePath, file: compressed, message: `Update image for post: ${title}`
      });
      image = imagePath;
      imageVersion = Date.now();
      setStatus(status, 'Saving…', 'busy');
    }

    const payload = {
      id: postId,
      title, date,
      body: $('p-body').value.trim(),
      pinned: $('p-pinned').checked,
      image,
      imageVersion
    };
    await writePosts(
      (current) => editingId
        ? current.map(p => p.id === editingId ? payload : p)
        : [...current, payload],
      editingId ? `Update post: ${title}` : `Add post: ${title}`
    );
    resetPostForm();
    setStatus(status, 'Saved.', 'ok');
  } catch (e) {
    setStatus(status, `Couldn't save: ${e.message}`, 'err');
  } finally {
    $('save-post-btn').disabled = false;
  }
}

async function handleDeletePost(id) {
  const p = state.posts.find(x => x.id === id);
  if (!p || !confirm(`Delete "${p.title}"?`)) return;
  const status = $('post-status');
  setStatus(status, 'Deleting…', 'busy');
  try {
    await writePosts((current) => current.filter(x => x.id !== id), `Delete post: ${p.title}`);
    setStatus(status, 'Deleted.', 'ok');
    if (state.editingPostId === id) resetPostForm();
  } catch (e) {
    setStatus(status, `Couldn't delete: ${e.message}`, 'err');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

// ---------- Wire up ----------

function init() {
  loadSavedConnection();
  resetPostForm();

  const savedToken = localStorage.getItem('clubhub_token') || sessionStorage.getItem('clubhub_token');
  if (savedToken) $('f-token').value = savedToken;

  $('connect-btn').addEventListener('click', handleConnect);
  $('save-appearance-btn').addEventListener('click', handleSaveAppearance);
  $('save-event-btn').addEventListener('click', handleSaveEvent);
  $('cancel-event-edit').addEventListener('click', resetEventForm);
  $('bulk-delete-past-btn').addEventListener('click', handleDeletePastEvents);
  $('save-post-btn').addEventListener('click', handleSavePost);
  $('cancel-post-edit').addEventListener('click', resetPostForm);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
