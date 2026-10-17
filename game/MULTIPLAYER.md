# Multiplayer (Firebase)

Accounts, saves and live players run on Firebase **Authentication + Realtime Database**. Not compiled or run in a browser where this was written
(no npm registry): run `npm install --legacy-peer-deps && npm run lint && npm run dev` first and fix anything TypeScript flags.
`npx tsx scripts/verify-net.ts` runs headless checks (the rules against every message the game sends, interpolation, change detection).

## One-time setup (Firebase console)
1. Create a project, then **Build > Authentication > Get started > Sign-in method > Email/Password > Enable** (leave "Email link" off).
2. **Build > Realtime Database > Create database** (any region, start in *locked mode*). Copy its URL.
3. **Realtime Database > Rules**: paste the whole of `database.rules.json`, **Publish**.
4. **Project settings > General > Your apps > Web (</>)**: register an app, copy `firebaseConfig`.
5. Paste it into `src/net/firebaseConfig.ts` (include `databaseURL`). Until you do, the game runs offline with local accounts as before.
6. If you host the game on your own domain: **Authentication > Settings > Authorized domains** > add it.

## What is stored where
| Path | What | Who can read / write |
|---|---|---|
| `users/<uid>/email` | the optional email | only that player |
| `users/<uid>/save` | the full PlayerData as JSON (clothes, last location, stats, money, inventory) | only that player |
| `online/<uid>` | display name, clothes (not the username); removed when the player leaves | everyone signed in read; owner writes |
| `state/<uid>` | position, heading, jump, car clip, car pose; removed when the player leaves | everyone signed in read; owner writes |
| `chat/<pushId>` | one spoken line: who, name, text (max 120 characters), where they stood, inside / outside, server time; the sender removes it after 30 s | everyone signed in read; anyone creates a line in their own name only |

Sign-in is name + username + password. The **name** is public (shown above your head, stored in `online/<uid>`); the **username** is private and only used to sign in (it is never written to the shared database). An email is optional: it is stored privately at `users/<uid>/email`. Usernames become `<username>@players.internallife.game` in Firebase Auth (no inbox behind it), so Firebase cannot send a reset mail yet; using the stored email for recovery needs a Cloud Function (Blaze plan).

## How it behaves
- Position is sent at most 10x/s, only when something changed, plus a heartbeat every 2.5 s. Others draw you 150 ms behind real time, blending between updates.
- Walk / run / strafe is not sent: the figure works it out from how fast the interpolated position moves. Jump, getting in / driving / getting out of the BMW are small flags.
- Players beyond 220 m, and all but the nearest 12, are not built (figure and car cost the most). Nobody outside sees a player who is inside a building.
- Leaving: the server removes your `state` and `online` the moment the connection drops. Hiding the tab / locking the phone also removes you; coming back puts you back.
- Saving: every change is saved on the device at once and to the cloud at most every 15 s, plus when the page hides or closes and every 30 s. On load the newer of device / cloud wins.
- "Where you left off" on the spawn screen (shown to anyone who has played) puts you at the saved position. Inside a building the saved position is the building's door.

## Proximity chat
- The chat box is a long see-through bar at the top of the screen, between the minimap and the health / money panel (in portrait it sits just under that row). The input says **Type a message**; letters are white with a black border and shadow. On a computer press **Enter** to type and Enter again to send (Esc leaves the box); on a phone tap the box.
- The box shows the last **5** lines; scroll / swipe up inside it for older ones (the last 100 are kept).
- What you say also appears **above your head**, bigger than the name tag, for a few seconds. Other players see it above yours.
- Only players within **30 m** (`CHAT_RADIUS` in `src/net/protocol.ts`) hear you: they get the line in their list and the bubble. Everybody else gets nothing. Distance is measured to where you stood when you spoke, and people inside a building and people outside do not hear each other.
- The sender cannot fake a name or a uid (the rules check both), text is limited to 120 characters, and a player can send at most one line per 0.7 s.
- While the keyboard is in the chat box the movement keys and touch controls are off, so typing never moves the character.

## Limits to know
- Client-authoritative: a player can fake their own position or edit their own save (money, stats). Real anti-cheat needs a server (Cloud Functions / a game server).
- Free (Spark) plan: 100 simultaneous connections and 10 GB/month download. Every player downloads every other player's updates (~1.5 KB/s each), so a handful of players is fine, dozens need the Blaze plan or sharding by area.
- Not synced yet: time of day (each device runs its own clock), car engine sound, players inside the same building, the car across sessions.
- Chat range is decided by each listener's own game (every client downloads every line, like positions). It is fine for friendly play; real moderation (muting, filtering, hard range limits) needs a server. There is no profanity filter.
