// Minimal GitHub REST API helper used by the admin panel to read/write
// JSON data files and images directly in this repo, from the browser.
// No backend server involved — auth happens via a Personal Access Token
// the admin pastes in locally.

const GitHubAPI = (() => {
  const API_BASE = 'https://api.github.com';

  function unicodeToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function base64ToUnicode(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function request(path, { method = 'GET', token, body } = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message; } catch (_) {}
      throw new Error(`GitHub API ${res.status}${detail ? ': ' + detail : ''}`);
    }
    return res.status === 204 ? null : res.json();
  }

  // Fetch a repo file. Returns { json, sha } for JSON files, or null if missing.
  async function getJsonFile({ owner, repo, path, token, branch }) {
    try {
      const data = await request(
        `/repos/${owner}/${repo}/contents/${path}${branch ? `?ref=${branch}` : ''}`,
        { token }
      );
      const text = base64ToUnicode(data.content);
      return { json: JSON.parse(text), sha: data.sha };
    } catch (e) {
      if (String(e.message).includes('404')) return null;
      throw e;
    }
  }

  // Write (create or update) a JSON file.
  async function putJsonFile({ owner, repo, path, token, branch, json, sha, message }) {
    const content = unicodeToBase64(JSON.stringify(json, null, 2));
    return request(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      token,
      body: {
        message: message || `Update ${path}`,
        content,
        sha: sha || undefined,
        branch: branch || undefined
      }
    });
  }

  // Write a binary file (e.g. an uploaded banner image). `file` is a File/Blob.
  async function putBinaryFile({ owner, repo, path, token, branch, file, message }) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const content = btoa(binary);

    // Need existing sha if the file already exists, otherwise GitHub rejects the update.
    let sha;
    try {
      const existing = await request(
        `/repos/${owner}/${repo}/contents/${path}${branch ? `?ref=${branch}` : ''}`,
        { token }
      );
      sha = existing.sha;
    } catch (_) { /* file doesn't exist yet, that's fine */ }

    return request(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      token,
      body: {
        message: message || `Update ${path}`,
        content,
        sha,
        branch: branch || undefined
      }
    });
  }

  // Quick credential/repo check — confirms the token can see the repo.
  async function verifyAccess({ owner, repo, token }) {
    return request(`/repos/${owner}/${repo}`, { token });
  }

  return { getJsonFile, putJsonFile, putBinaryFile, verifyAccess };
})();
