# Deploying LANJudge Cloud to an EC2 instance

Single Go binary (embeds the built React frontend via `go:embed`), run as a
systemd service on a plain Ubuntu EC2 instance. No containers, no
orchestration.

## 1. Fresh instance setup

On a clean Ubuntu instance (tested against Ubuntu 22.04/24.04 LTS conventions):

```bash
sudo apt-get update
sudo apt-get install -y git

# Go (the sqlite driver needs cgo, which Ubuntu's gcc/build-essential covers)
sudo apt-get install -y build-essential
curl -fsSL https://go.dev/dl/go1.24.0.linux-amd64.tar.gz -o /tmp/go.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/go.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee /etc/profile.d/go.sh
source /etc/profile.d/go.sh

# Node/npm (frontend build only — not needed at runtime)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Check versions match (or exceed) `server/go.mod`'s `go 1.24.0` and Node 20+.

## 2. Get the code and a dedicated user

```bash
sudo useradd --system --home /opt/campuscode-cloud --shell /usr/sbin/nologin campuscode
sudo mkdir -p /opt/campuscode-cloud
sudo chown "$USER" /opt/campuscode-cloud   # so you can clone as yourself first
git clone <your-repo-url> /opt/campuscode-cloud
```

`<APP_DIR>` in the systemd unit and everywhere below is `/opt/campuscode-cloud`
— adjust every reference if you use a different path.

## 3. Build

```bash
cd /opt/campuscode-cloud
./deploy/build.sh
```

This runs `npm install && npm run build` in `client/` (writing straight into
`server/web/dist`, which `server/web.go` embeds into the binary), then
`go build -o campuscodecloud .` in `server/`. **Order matters** — the Go
build reads `server/web/dist` at compile time via `go:embed` and fails if
it's missing or empty, so always run the frontend build first (the script
already does this for you).

Re-run this script for every deploy (new code, new frontend, or both).

## 4. Persistent data

Everything the app writes at runtime lives under `server/data/`, relative to
wherever the process's working directory is:

- `server/data/cloud.sqlite` — the contest/problem database
- `server/data/testcases/` — uploaded `.in`/`.out` test case files
- `server/data/platform-bundles/` — pre-built per-platform installers the
  "download full bundle" feature zips up (this directory isn't in git —
  populate it manually on the instance if you use that feature)

**On a t3.micro/t2.micro instance specifically**: these instance types don't
have local instance-store volumes at all — the root disk is always
EBS-backed by default. So as long as `server/data/` lives under the normal
clone path on the root volume (as it does above), it already persists across
reboots and stop/start cycles with no extra volume-mounting step. The one
thing to watch: EC2's default root volume has "Delete on Termination"
enabled, so *terminating* (not stopping) the instance destroys this data
permanently. If you want it to survive an instance replacement, either
snapshot the EBS volume periodically or attach a second EBS volume with
delete-on-termination turned off and symlink `server/data` onto it.

Make sure the systemd service's `User=` (below) can write to `server/data/`:

```bash
sudo chown -R campuscode:campuscode /opt/campuscode-cloud
```

## 5. Install the systemd service

```bash
sudo cp deploy/campuscode-cloud.service /etc/systemd/system/
sudo nano /etc/systemd/system/campuscode-cloud.service
```

Replace the placeholders:
- `<APP_DIR>` → `/opt/campuscode-cloud`
- `<APP_USER>` → `lanjudge`

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now campuscode-cloud
sudo systemctl status campuscode-cloud    # confirm it's running
journalctl -u campuscode-cloud -f         # tail logs
```

`Restart=on-failure` means it restarts itself if it crashes; `enable` means
it starts automatically on instance boot/reboot.

To pick a non-default port, create `/opt/campuscode-cloud/server/.env` with:

```
PORT=8081
```

(8081 is also the built-in fallback if this file or the `PORT` line is
absent — see `server/main.go`.)

## 6. Security group

In the EC2 instance's security group, add an inbound rule allowing TCP on
whatever port the service listens on (8081 by default, or your `PORT`
value) from the source you want (`0.0.0.0/0` for public access, or a
narrower CIDR/your IP if this should stay private). If you plan to put this
behind a reverse proxy with TLS (e.g. Caddy/nginx on 443) instead of hitting
the Go process's port directly, open 443 (and 80 for cert issuance) instead
and point the proxy at `localhost:<PORT>`.

## Redeploying

```bash
cd /opt/campuscode-cloud
git pull
./deploy/build.sh
sudo systemctl restart campuscode-cloud
```
