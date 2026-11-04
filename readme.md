# Sunaan

Private music PWA for a small group. Search and stream from YouTube, build playlists, download songs for offline play, and listen together in sync.

Works on Android and iPhone: open the site in the browser, then use "Add to Home Screen".

## Features

- Search and stream audio from YouTube (yt-dlp on the server)
- Playlists stored on your device, plus shared group playlists in Neon Postgres
- Download songs for offline play (stored in IndexedDB)
- Rooms: everyone in a room hears the same song at the same moment
- Lock screen and notification controls (Media Session)
- Group key so only your people can use the server

## Run locally

```bash
npm run setup
npm run dev          # web on :5173, server on :3001
```

Without `GROUP_KEY` the app is open. Without `DATABASE_URL`, group playlists are turned off and everything else still works.

## Share from this PC (easiest)

```bash
npm run share
```

This builds the app, starts the server, and opens a free Cloudflare tunnel. It prints a public `https://....trycloudflare.com` link and the group key from `.env`. The link stays up while the PC is on and the command is running, and it changes each time you restart. YouTube works best this way because the traffic comes from your home connection.

## Deploy (Render + Neon)

1. Create a Neon project and copy its connection string.
2. On Render: New > Blueprint > pick this repo. `render.yaml` sets everything up.
3. Set these environment variables:
   - `DATABASE_URL`: the Neon connection string
   - `GROUP_KEY`: a password you give your group
   - `YTDLP_COOKIES` (optional): the contents of a `cookies.txt` export from a logged-in YouTube browser session. You need it if search or playback fails with "Sign in to confirm you're not a bot". YouTube often blocks cloud IPs.
4. Open the Render URL on each phone, enter the key, then Add to Home Screen.

On Render's free plan the server sleeps after 15 minutes idle, and the first request after that takes about 50 seconds. Downloaded songs still play offline.

## Notes

- iOS can pause a PWA's audio after a long time on the lock screen, and can clear PWA storage if the app goes unused for weeks.
- This is for private use. Streaming from YouTube this way is against YouTube's terms, so keep it within your group.

## Android app (APK)

The app lives in `app/` (Expo). Install link for your group: `https://<render-app>.onrender.com/go/sunaan.apk`
(the PC serves `downloads/Sunaan.apk`).

Building on Windows hits the 260-character path limit and needs ~8GB of free disk, so build from a short path:

1. Copy `app/` to `F:\s`, run `npx expo prebuild --platform android` there.
2. In `F:\s\android\app\build.gradle`, inside `android {`, add
   `externalNativeBuild { cmake { buildStagingDirectory = file("F:/c") } }`.
3. In `F:\s\android\gradle.properties` set `reactNativeArchitectures=arm64-v8a` and `org.gradle.jvmargs=-Xmx1536m`.
4. With JDK 17: `gradlew assembleRelease -x lint` (set `GRADLE_USER_HOME` and `ANDROID_HOME` to a drive with space).
5. Copy `app\build\outputs\apk\release\app-release.apk` to `downloads/Sunaan.apk`.
