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
  editingPostId: null,
  dirty: { config: false, events: false, posts: false },
  pendingBannerFile: null,
  pendingBannerPreviewUrl: null,
  // postId -> compressed Blob awaiting upload at publish time
  pendingPostImages: {}
};

const $ = (id) => document.getElementById(id);

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'status-line' + (type ? ' ' + type : '');
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- Draft persistence (local safety net so a reload doesn't wipe unpublished work) ----------

function draftKey() {
  return `clubhub_draft_${state.owner}_${state.repo}`;
}

function saveDraftLocally() {
  if (!state.owner || !state.repo) return;
  if (!state.dirty.config && !state.dirty.events && !state.dirty.posts) {
    localStorage.removeItem(draftKey());
    return;
  }
  // Note: staged-but-unpublished image *files* (banner or post images) can't
  // be saved to localStorage — only the JSON fields survive a reload.
  const draft = {
    dirty: state.dirty,
    config: state.dirty.config ? state.config : null,
    events: state.dirty.events ? state.events : null,
    posts: state.dirty.posts ? state.posts : null
  };
  try { localStorage.setItem(draftKey(), JSON.stringify(draft)); } catch (_) { /* ignore */ }
}

function loadDraftLocally() {
  try {
    const raw = localStorage.getItem(draftKey());
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function clearDraftLocally() {
  localStorage.removeItem(draftKey());
}

// ---------- Publish bar ----------

function updatePublishUI() {
  const names = [];
  if (state.dirty.config) names.push('Appearance');
  if (state.dirty.events) names.push('Events');
  if (state.dirty.posts) names.push('Announcements');

  const summary = $('publish-summary');
  const btn = $('publish-btn');
  if (names.length === 0) {
    summary.textContent = 'No unsaved changes.';
    summary.className = 'publish-status-text ok';
    btn.disabled = true;
  } else {
    summary.textContent = `Unsaved changes: ${names.join(', ')}`;
    summary.className = 'publish-status-text dirty';
    btn.disabled = false;
  }
}

async function handlePublish() {
  const status = $('publish-status');
  if (!state.dirty.config && !state.dirty.events && !state.dirty.posts) {
    setStatus(status, 'Nothing to publish.', 'ok');
    return;
  }
  setStatus(status, 'Publishing…', 'busy');
  $('publish-btn').disabled = true;

  try {
    if (state.dirty.config) {
      let bannerPath = null;
      if (state.pendingBannerFile) {
        const ext = state.pendingBannerFile.name.split('.').pop().toLowerCase();
        bannerPath = `assets/banner.${ext}`;
        await GitHubAPI.putBinaryFile({
          owner: state.owner, repo: state.repo, branch: state.branch, token: state.token,
          path: bannerPath, file: state.pendingBannerFile, message: 'Update club banner'
        });
      }
      const finalConfig = { ...state.config };
      if (bannerPath) {
        finalConfig.bannerFile = bannerPath;
        finalConfig.bannerVersion = Date.now();
      }

      const { result, json } = await GitHubAPI.updateJsonFile({
        owner: state.owner, repo: state.repo, branch: state.branch, token: state.token,
        path: 'data/config.json', mutate: () => finalConfig, message: 'Update club appearance'
      });
      state.config = json;
      state.configSha = result.content.sha;
      state.pendingBannerFile = null;
      if (state.pendingBannerPreviewUrl) {
        URL.revokeObjectURL(state.pendingBannerPreviewUrl);
        state.pendingBannerPreviewUrl = null;
      }
      state.dirty.config = false;
      fillAppearanceForm();
    }

    if (state.dirty.events) {
      const { result, json } = await GitHubAPI.updateJsonFile({
        owner: state.owner, repo: state.repo, branch: state.branch, token: state.token,
        path: 'data/events.json', mutate: () => state.events, message: 'Update events'
      });
      state.events = json;
      state.eventsSha = result.content.sha;
      state.dirty.events = false;
      renderEventList();
    }

    if (state.dirty.posts) {
      for (const [postId, blob] of Object.entries(state.pendingPostImages)) {
        await GitHubAPI.putBinaryFile({
          owner: state.owner, repo: state.repo, branch: state.branch, token: state.token,
          path: `assets/posts/${postId}.jpg`, file: blob, message: 'Update announcement image'
        });
      }
      state.pendingPostImages = {};

      const { result, json } = await GitHubAPI.updateJsonFile({
        owner: state.owner, repo: state.repo, branch: state.branch, token: state.token,
        path: 'data/posts.json', mutate: () => state.posts, message: 'Update announcements'
      });
      state.posts = json;
      state.postsSha = result.content.sha;
      state.dirty.posts = false;
      renderPostList();
    }

    clearDraftLocally();
    updatePublishUI();
    setStatus(status, 'Published — live in about a minute.', 'ok');
  } catch (e) {
    setStatus(status, `Couldn't publish: ${e.message}`, 'err');
  } finally {
    $('publish-btn').disabled = false;
  }
}

async function handleDiscardDraft() {
  if (!state.dirty.config && !state.dirty.events && !state.dirty.posts) return;
  if (!confirm("Discard all unpublished changes and reload from GitHub? This can't be undone.")) return;

  if (state.pendingBannerPreviewUrl) {
    URL.revokeObjectURL(state.pendingBannerPreviewUrl);
    state.pendingBannerPreviewUrl = null;
  }
  state.pendingBannerFile = null;
  state.pendingPostImages = {};
  clearDraftLocally();
  resetEventForm();
  resetPostForm();

  const status = $('publish-status');
  setStatus(status, 'Reloading…', 'busy');
  try {
    await loadAllData();
    updatePublishUI();
    setStatus(status, 'Draft discarded — reloaded from GitHub.', 'ok');
  } catch (e) {
    setStatus(status, `Couldn't reload: ${e.message}`, 'err');
  }
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

    const draft = loadDraftLocally();
    let restored = false;
    if (draft && (draft.dirty.config || draft.dirty.events || draft.dirty.posts)) {
      if (draft.dirty.config) { state.config = draft.config; state.dirty.config = true; }
      if (draft.dirty.events) { state.events = draft.events; state.dirty.events = true; }
      if (draft.dirty.posts) { state.posts = draft.posts; state.dirty.posts = true; }
      fillAppearanceForm();
      renderEventList();
      renderPostList();
      restored = true;
    }

    $('connected-badge').style.display = 'inline-block';
    document.querySelectorAll('.panel.data-panel').forEach(p => p.style.display = 'block');
    $('publish-bar').style.display = 'flex';
    $('connect-details').open = false;
    $('appearance-details').open = false;
    updatePublishUI();

    setStatus(status, restored ? 'Connected — restored unpublished draft from last session.' : 'Connected.', 'ok');
  } catch (e) {
    setStatus(status, `Couldn't connect: ${e.message}`, 'err');
  } finally {
    $('connect-btn').disabled = false;
  }
}

async function loadAllData() {
  const { owner, repo, branch, token } = state;
  state.dirty = { config: false, events: false, posts: false };
  state.pendingPostImages = {};

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
  $('a-hide-club-title').checked = !!c.hideClubTitle;
  const colors = c.colors || {};
  $('a-color-bg').value = colors.bg || '#EFE8D8';
  $('a-color-cork').value = colors.cork || '#7C5A3F';
  $('a-color-ink').value = colors.ink || '#2B2A28';
  $('a-color-accent').value = colors.accent || '#3D5A80';
  $('a-color-pin').value = colors.pin || '#B23A2E';
  $('a-color-line').value = colors.line || '#D8CBB0';

  const previewSrc = state.pendingBannerPreviewUrl
    || (c.bannerFile ? `${c.bannerFile}?v=${c.bannerVersion || 0}` : null);
  if (previewSrc) {
    $('current-banner').src = previewSrc;
    $('current-banner').style.display = 'block';
  } else {
    $('current-banner').style.display = 'none';
  }
}

function handleSaveAppearance() {
  const status = $('appearance-status');
  const clubName = $('a-club-name').value.trim();
  const tagline = $('a-tagline').value.trim();
  const hideClubTitle = $('a-hide-club-title').checked;
  const colors = {
    bg: $('a-color-bg').value,
    cork: $('a-color-cork').value,
    ink: $('a-color-ink').value,
    accent: $('a-color-accent').value,
    pin: $('a-color-pin').value,
    line: $('a-color-line').value
  };

  state.config = { ...(state.config || {}), clubName, tagline, hideClubTitle, colors };

  const fileInput = $('a-banner-file').files[0];
  if (fileInput) {
    state.pendingBannerFile = fileInput;
    if (state.pendingBannerPreviewUrl) URL.revokeObjectURL(state.pendingBannerPreviewUrl);
    state.pendingBannerPreviewUrl = URL.createObjectURL(fileInput);
  }

  state.dirty.config = true;
  fillAppearanceForm();
  saveDraftLocally();
  updatePublishUI();
  setStatus(status, 'Saved to draft — click "Publish changes" above to go live.', 'ok');
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

function handleDeletePastEvents() {
  const past = state.events.filter(ev => isPastEvent(ev));
  if (past.length === 0) return;
  if (!confirm(`Remove ${past.length} past event${past.length === 1 ? '' : 's'} from the draft?`)) return;
  state.events = state.events.filter(ev => !isPastEvent(ev));
  state.dirty.events = true;
  renderEventList();
  saveDraftLocally();
  updatePublishUI();
  setStatus($('event-status'), 'Removed from draft — publish to go live.', 'ok');
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

function handleSaveEvent() {
  const status = $('event-status');
  const title = $('e-title').value.trim();
  const date = $('e-date').value;
  if (!title || !date) {
    setStatus(status, 'Title and date are required.', 'err');
    return;
  }
  const payload = {
    id: state.editingEventId || newId('evt'),
    title, date,
    time: $('e-time').value,
    location: $('e-location').value.trim(),
    description: $('e-description').value.trim()
  };
  const editingId = state.editingEventId;
  state.events = editingId
    ? state.events.map(ev => ev.id === editingId ? payload : ev)
    : [...state.events, payload];

  state.dirty.events = true;
  renderEventList();
  resetEventForm();
  saveDraftLocally();
  updatePublishUI();
  setStatus(status, (editingId ? 'Updated' : 'Added') + ' in draft — publish to go live.', 'ok');
}

function handleDeleteEvent(id) {
  const ev = state.events.find(e => e.id === id);
  if (!ev || !confirm(`Remove "${ev.title}" from the draft?`)) return;
  state.events = state.events.filter(e => e.id !== id);
  state.dirty.events = true;
  renderEventList();
  if (state.editingEventId === id) resetEventForm();
  saveDraftLocally();
  updatePublishUI();
  setStatus($('event-status'), 'Removed from draft — publish to go live.', 'ok');
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

  const pendingBlob = state.pendingPostImages[id];
  if (pendingBlob) {
    $('current-post-image').src = URL.createObjectURL(pendingBlob);
    $('current-post-image').style.display = 'block';
    $('p-remove-image-row').style.display = 'flex';
  } else if (p.image) {
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

async function handleSavePost() {
  const status = $('post-status');
  const title = $('p-title').value.trim();
  const date = $('p-date').value;
  if (!title || !date) {
    setStatus(status, 'Title and date are required.', 'err');
    return;
  }
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
      delete state.pendingPostImages[postId];
    }

    const imageFile = $('p-image-file').files[0];
    if (imageFile) {
      setStatus(status, 'Compressing image…', 'busy');
      const compressed = await compressImage(imageFile);
      image = `assets/posts/${postId}.jpg`;
      imageVersion = Date.now();
      // Actual upload happens at publish time — this just stages it.
      state.pendingPostImages[postId] = compressed;
    }

    const payload = {
      id: postId,
      title, date,
      body: $('p-body').value.trim(),
      pinned: $('p-pinned').checked,
      image,
      imageVersion
    };
    state.posts = editingId
      ? state.posts.map(p => p.id === editingId ? payload : p)
      : [...state.posts, payload];

    state.dirty.posts = true;
    renderPostList();
    resetPostForm();
    saveDraftLocally();
    updatePublishUI();
    setStatus(status, (editingId ? 'Updated' : 'Added') + ' in draft — publish to go live.', 'ok');
  } catch (e) {
    setStatus(status, `Couldn't save: ${e.message}`, 'err');
  } finally {
    $('save-post-btn').disabled = false;
  }
}

function handleDeletePost(id) {
  const p = state.posts.find(x => x.id === id);
  if (!p || !confirm(`Remove "${p.title}" from the draft?`)) return;
  state.posts = state.posts.filter(x => x.id !== id);
  delete state.pendingPostImages[id];
  state.dirty.posts = true;
  renderPostList();
  if (state.editingPostId === id) resetPostForm();
  saveDraftLocally();
  updatePublishUI();
  setStatus($('post-status'), 'Removed from draft — publish to go live.', 'ok');
}

function handleInsertLink() {
  const textInput = $('p-link-text');
  const urlInput = $('p-link-url');
  const body = $('p-body');

  let text = textInput.value.trim();
  let url = urlInput.value.trim();
  if (!url) {
    urlInput.focus();
    return;
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!text) text = url;

  const snippet = `[${text}](${url})`;
  const start = body.selectionStart ?? body.value.length;
  const end = body.selectionEnd ?? body.value.length;
  body.value = body.value.slice(0, start) + snippet + body.value.slice(end);

  const cursorPos = start + snippet.length;
  body.focus();
  body.setSelectionRange(cursorPos, cursorPos);

  textInput.value = '';
  urlInput.value = '';
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
  $('publish-btn').addEventListener('click', handlePublish);
  $('discard-draft-btn').addEventListener('click', handleDiscardDraft);
  $('insert-link-btn').addEventListener('click', handleInsertLink);

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty.config || state.dirty.events || state.dirty.posts) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
