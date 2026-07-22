# Club Hub

A two-app PWA for club events and announcements:

- **`index.html`** — the member app. Shows the wall (announcements) and calendar (events).
- **`admin.html`** — the admin app. Lets an admin edit events, announcements, colors, and the banner. Changes commit straight to this repo, no server involved.

Both apps read/write plain JSON files in `data/`, so there's nothing to host beyond this repo and GitHub Pages.

## 1. Put this repo on GitHub

1. Create a new repository on GitHub (public or private both work).
2. Push all these files to it, unchanged, at the repo root.

## 2. Turn on GitHub Pages

1. In the repo, go to **Settings → Pages**.
2. Under "Build and deployment", set **Source** to "Deploy from a branch".
3. Pick your default branch (e.g. `main`) and folder `/ (root)`. Save.
4. GitHub will give you a URL like `https://yourusername.github.io/your-repo/`.
   - Members visit that URL directly for the wall/calendar app.
   - The admin visits `.../admin.html` for the admin panel.

Give it a minute after the first push for Pages to build.

## 3. Create a token for the admin panel

The admin panel needs a **GitHub Personal Access Token** scoped to *only* this repo, so it can commit updates on your behalf.

1. Go to **github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Click **Generate new token**.
3. Under **Repository access**, choose **Only select repositories** and pick this repo.
4. Under **Permissions → Repository permissions**, set **Contents** to **Read and write**. Leave everything else as "No access".
5. Generate the token and copy it — GitHub only shows it once.

Keep this token private. Anyone with it can edit this specific repo's contents (nothing else).

## 4. Connect the admin panel

1. Open `admin.html` (e.g. `https://yourusername.github.io/your-repo/admin.html`).
2. Enter your GitHub username, the repo name, and paste the token.
3. Leave branch blank unless you're using something other than your default branch.
4. Click **Connect**.

From there you can set the club name, tagline, banner image, colors, and add events/announcements. Each save commits directly to `data/config.json`, `data/events.json`, or `data/posts.json` — you'll see the commits show up in the repo's history.

Pages usually takes 30–90 seconds to rebuild after a change, so give the member app a moment (or a reload) to catch up.

## 5. Install as an app

Both `index.html` and `admin.html` are installable PWAs — on a phone, open either URL and use "Add to Home Screen" (iOS Safari) or the install prompt (Android Chrome). On desktop, most Chromium browsers show an install icon in the address bar.

## Notes on this design

- **No backend/database** — all content lives in `data/*.json` in this same repo, edited via the GitHub API directly from the admin panel's browser tab.
- **Token storage** — if you check "Remember this token on this device," it's saved in `localStorage` on that browser only. Otherwise it's kept in `sessionStorage` and cleared when the tab closes. It is never sent anywhere except GitHub's API.
- **One club per repo copy.** If you'd like to run this for a second club later, the cleanest path is turning this repo into a GitHub **template repository** (Settings → check "Template repository"), then having each new club use "Use this template" to get their own independent copy with their own Pages site and their own token.
