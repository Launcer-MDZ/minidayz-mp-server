# MDZ-Reimagined MP Hub (starter)

Node.js WebSocket relay for the protocol labels found in `MDZ-Reimagined-2.3.8-mp24-Public.apk` (`ver: np1`, `gv: 2.3.8-mp24`). It relays messages; the game host still runs the world/session.

## Deploy on Railway
1. Upload these files to a GitHub repository.
2. In Railway, create a project from that repository.
3. Railway should run `npm start`; set no custom start command unless needed.
4. Use Railway's generated public domain and enable HTTPS. The game should connect using `wss://YOUR-DOMAIN` (do not add `:7777` to the public HTTPS domain unless your hosting provider explicitly requires it).
5. Test `https://YOUR-DOMAIN/health` and `https://YOUR-DOMAIN/rooms` in a browser.

Railway injects `PORT`; the server listens on it. Optional environment variables: `MDZ_PROTOCOL=np1`, `MDZ_GAME_VERSION=2.3.8-mp24`, `REGION=Asia`.

## Important limitations
- This is a starter implementation, not a verified official server. It supports one room per process and the basic `hello`, `welcome`, `joined`, `left`, `host_left`, `msg`, `ping`, and `pong` exchange.
- It does not implement LAN UDP beacons, a public registry worker, queues, persistence, moderation, or every server-side validation/rate limit. `/rooms` only lists rooms hosted on this process; the game's public server list may require a separate registry URL/configuration.
- Test with a private room first. Do not use a password you use elsewhere. Never put passwords or secrets into public GitHub files.
