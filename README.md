# Agent Location Log

A small web app for field agents to log their date, name, shop, shift, and
GPS location — with an admin dashboard, shop list, and user management.
Built as a static site (no build step) using Firebase Auth + Firestore.

## 1. Configure Firebase (do this first)

Your project (`canal2-loca`) is already wired up in `firebase-config.js`.
You still need to turn a couple of things on in the [Firebase console](https://console.firebase.google.com/):

1. **Authentication → Sign-in method** → enable the **Email/Password** provider.
2. **Firestore Database** → create a database (production mode is fine).
3. **Firestore → Rules** → paste in the contents of `firestore.rules` from
   this folder and publish. This is what keeps your data private — without
   it, Firestore defaults to fully locked or fully open depending on mode.
4. Once you've deployed to Vercel (step 3 below), go to
   **Authentication → Settings → Authorized domains** and add your
   `*.vercel.app` domain (and any custom domain) so login works there.

## 2. Push to GitHub

```bash
cd agent-location-log
git init
git add .
git commit -m "Agent location log app"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 3. Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repo.
2. Framework preset: **Other** (this is a plain static site — no build
   command or output directory needed).
3. Deploy. Vercel will give you a `https://your-project.vercel.app` URL.
4. Add that domain to Firebase's Authorized domains list (step 1.4 above).

## 4. First-time setup in the app

1. Open your deployed URL. Since no users exist yet, you'll see a
   **"Claim the first admin account"** screen.
2. Enter one of the two authorized admin emails
   (`Ahmedsharaf.pe@gmail.com` or `ahmdsharf540@gmail.com`), your name, and
   a password (6+ characters). This creates your Firebase Auth account and
   marks you as an admin.
3. You're now logged in. Go to the **Users** tab and add the *second*
   admin email the same way (role: Admin), plus any agents you want to
   grant access to.
4. From then on, everyone just logs in with their email/password on the
   normal sign-in screen.

Only the two emails listed in `ADMIN_EMAILS` (inside `firebase-config.js`)
can claim the *first* admin slot through the setup screen. Add more admins
later from the Users tab — that list is just the bootstrap whitelist.

## What agents see

A single form: Date, Agent Name, Shop (dropdown), Shift (AM / PM / Full
day). On submit, the app asks the browser for the device's GPS location
(the browser will prompt for permission) and stores it with the entry. If
location access is denied or unavailable, the entry still submits — just
without coordinates.

Location requires HTTPS, which Vercel provides automatically. It also
works on `localhost` for local testing.

## What admins see

- **Dashboard** — every submission, filterable by date range / shop /
  shift, each with a "View map" link (opens Google Maps at the captured
  coordinates) and CSV export (includes lat/lng/accuracy columns).
- **Shops** — add or remove shop locations (the 13 you gave are pre-seeded
  on first run).
- **Users** — add agents/admins (name, email, temp password) and send
  password-reset emails.

## Notes on how accounts work

- Passwords are handled by Firebase Authentication, not stored in your
  database — this is real auth, not the toy version from before.
- "Revoke access" in the Users tab removes someone's profile document, which
  blocks them from using the app, but their underlying Firebase Auth sign-in
  still technically exists. Fully deleting a Firebase Auth user requires
  either the Firebase console (Authentication tab) or the Admin SDK on a
  server — not something a client-side app can do for someone else. For
  day-to-day use, "Revoke access" is sufficient.
- Password resets go through Firebase's built-in reset-email flow (Admin →
  "Send reset email" for anyone, or the Account tab for yourself).

## Local development

Just serve the folder with any static file server, e.g.:

```bash
npx serve .
```

Then open the printed `localhost` URL. Geolocation and Firebase both work
fine on localhost.

## Files

```
index.html          the whole UI
styles.css           all styling
app.js                Firebase wiring + app logic (ES module)
firebase-config.js    your Firebase project config + admin whitelist + default shop list
firestore.rules       security rules to paste into Firebase console
vercel.json           minimal Vercel config
```
