# Deploy chino-app on this homelab

Host: `homelab` (user). App source: `/home/homelab/chino-app`.
Live builds: `/home/homelab/chino-app-live/releases/<timestamp>`, served through
the symlink `/home/homelab/chino-app-live/current`.
The app is a static PWA (no backend): a systemd **user** service runs
`node scripts/serve.mjs` on `127.0.0.1:8095` and Tailscale exposes it externally.

## Deploy a new version

```sh
bash /home/homelab/chino-app/scripts/deploy-local.sh
```

Builds into a fresh `releases/<timestamp>`, checks the build has `index.html`,
`manifest.webmanifest` and `sw.js`, then **atomically** moves the `current`
symlink (`ln -sfn` + `mv -T`). Because the server re-resolves `current` on every
request, a deploy never needs to restart or stop it. Keeps the **3 newest**
releases and deletes older ones; prints the active release at the end.

Run it as often as you like (e.g. after `git pull`) — it is safe while the
service is serving.

## Logs

```sh
journalctl --user -u chino-app -n 50      # recent lines
journalctl --user -u chino-app -f         # follow
systemctl --user status chino-app         # state + last lines
```

## Roll back to a previous release

List what is on disk (newest first):

```sh
ls -1dt /home/homelab/chino-app-live/releases/
```

Point `current` at an older one (same atomic recipe as the deploy script; the
service picks it up on the next request, no restart):

```sh
LIVE=/home/homelab/chino-app-live
ln -sfn "$LIVE/releases/<older-timestamp>" "$LIVE/.current.rollback"
mv -Tf "$LIVE/.current.rollback" "$LIVE/current"
readlink -f "$LIVE/current"
```

Only the 3 newest releases are kept, so roll back before the next deploys prune
them. To undo the rollback, point `current` back at the newest directory.

## Service (systemd user unit)

Installed at `~/.config/systemd/user/chino-app.service` (copied from
`deploy/chino-app.service`):

```sh
cp /home/homelab/chino-app/deploy/chino-app.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now chino-app
```

- Runs `node scripts/serve.mjs /home/homelab/chino-app-live/current --port 8095 --host 127.0.0.1`.
- `--host 127.0.0.1` = **local only**; external access is Tailscale (below).
- `Restart=on-failure` / `RestartSec=5` = restarts only if it crashes.
- systemd's user `PATH` has no node, so the unit pins the nvm LTS node
  (`/home/homelab/.nvm/versions/node/v24.21.0/bin/node`) via `Environment=PATH=…`
  and an absolute `ExecStart`. **If the node version changes, edit that line.**

## Serve caching (why deploys show up instantly)

`scripts/serve.mjs` sends `Cache-Control: no-cache` for the shell
(`index.html`, `sw.js`, `manifest.webmanifest`) so a browser revalidates and
picks up a new deploy, and `public, max-age=86400` for everything else (icons,
data JSON, modules). `--no-cache-shell` switches the shell to `no-store`
(dev).

## External access — Tailscale (run by the orchestrator, needs sudo)

The service only listens on loopback; Tailscale publishes it over HTTPS:

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8095
```

Check / stop:

```sh
tailscale serve status
sudo tailscale serve --https=443 off
```

## Checks

```sh
systemctl --user is-active chino-app                       # -> active
curl -sI http://127.0.0.1:8095/ | head -1                  # -> 200 OK
curl -sI http://127.0.0.1:8095/sw.js | grep -i cache-control  # -> no-cache
curl -s  http://127.0.0.1:8095/manifest.webmanifest | head
curl -s  http://127.0.0.1:8095/data/manifest.json | head
```
