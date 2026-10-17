# International Life: Android app with online updates

The APK is a tiny launcher. The game files live on Cloudflare Pages. When you open the app it plays the Beta Lagos RP launch sequence
(DOTCON -> logo -> Welcome to Lagos -> tap). On the loading screen it says CHECKING FOR UPDATES, and if `<your link>/manifest.json`
shows changes it asks **Update / Later** right there, downloads with the same loading bar, then starts the game (which skips its own intro).
Only changed files are downloaded. You rebuild the APK only if you change the launcher itself.

## One-time setup
1. `npm install`  (installs the launcher and the game's own packages)
2. Open `update.config.json`. Pick a name and set both lines:
   `"cfProject": "kings-intl-life"` and `"updateUrl": "https://kings-intl-life.pages.dev"`
3. `npm run update`  (builds the game, uploads it. First time it opens a browser to log in to Cloudflare, free account)
4. Build the APK, either way:
   - On your PC: `npm run apk`  (needs JDK 21 + Android SDK, i.e. Android Studio). Result: `apk/International-Life-debug.apk`
   - No Android Studio: push this folder to GitHub, Actions > **Build APK** > Run workflow > download the artifact.
5. Install the APK on the phone, open it, tap **Download**.

## Every time you change the game
Put the new game source in `game/` (replace the files), then run **`npm run update`**.
Next time the app opens it shows the update size and asks to download. That is the whole loop.

Useful options: `npm run update -- --notes "New car added"` (message in the prompt), `--required` (cannot skip).
`npm run update:build` builds `update-out/` without uploading.

## Notes
- Dropbox does not work for this: it cannot serve a folder of files from one link. Use Cloudflare Pages (free).
  Cloudflare Pages rejects single files over 25 MiB; `npm run update` warns you. Host those on R2 instead.
- The update check runs when the app is opened from closed. Offline: it just starts the version already on the phone.
- Interrupted download: the progress is saved and resumes, and the half-updated game is never started.
- Players' saves and logins stay (same storage), because the game runs inside the same app.
- Landscape and full screen are set in `android-overrides/` and `scripts/build-apk.mjs`.
- The APK is debug-signed, fine for installing directly. For the Play Store you need a release keystore.
- `npm test` runs the update-logic tests.

## Codemagic build (alternative to GitHub Actions)
1. Push this folder to GitHub (the folder contents must be the repository root, next to `codemagic.yaml`).
2. In Codemagic: Add application, pick the repo, choose **codemagic.yaml**, Start new build, workflow **android-apk**.
3. When it finishes, download `International-Life-debug.apk` from the build's Artifacts.
`UPDATE_URL` in `codemagic.yaml` must be your Cloudflare Pages link (same as `updateUrl` in `update.config.json`).

## App icon
The Beta Lagos RP logo is installed as the launcher icon by `npm run apk` from `android-overrides/res/`
(adaptive icon + legacy + round). `store/play-store-icon-512.png` is the 512 px version for the Play Store.

## Launch screens
- The APK page is built from `game/public/launch/launch.html` (`scripts/launch-page.mjs` + `launcher/launch-bridge.js`), so the intro looks the same in the app and in the game.
- If you change the launch sequence, rebuild the APK (and run `npm run update` so the game copy matches). The build stops with a clear message if the page changed in a way the launcher cannot handle.
