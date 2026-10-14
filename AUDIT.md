# LANJudge Cloud — Code Audit

**Scope:** `LANJudge-Cloud/server/` (Go) and `LANJudge-Cloud/client/` (React), plus `deploy/` where it directly affects whether the backend runs correctly. Every source file was read in full. No fixes applied — findings only.

**Method:** static read of all 10 Go files and 15 JS/JSX files, cross-checked against the actual route table and a `grep` sweep for any auth mechanism (`session`, `apikey`, `bearer`, `authorization`, `middleware`, `jwt` — all zero hits across the entire server).

---

## Critical

### 1. The entire API has no authentication or authorization — not weak, absent

**File:** `server/main.go` (full route table) and every handler in `server/handlers/*.go`.

None of the seven routes — create/list/update/delete a problem, generate a package, generate a platform bundle — check who is calling them. There is no login endpoint, no session, no API key, no cookie, nothing. `models.Contest` doesn't even have an owner field, so there's no concept of "whose contest this is" anywhere in the schema for a future check to hang off of.

**Concretely reproducible:** contest IDs are sequential integers (`gorm:"primaryKey"` autoincrement). Anyone who can reach the server can do this in a browser console on a completely unrelated page, no credentials needed:

```js
fetch('http://<host>:8081/contests/1/problems').then(r => r.json()).then(console.log)
fetch('http://<host>:8081/contests/1/package', { method: 'POST' })  // downloads it
```

That second call returns a zip containing `manifest.json` with `admin_login_code` in plaintext — the exam's own admin password — for a contest that isn't theirs. `DELETE /contests/1/problems/1` works exactly as readily. Every organizer's contest is enumerable and fully read/write/delete-able by every other visitor to the server.

**Production impact:** the `deploy/README.md` explicitly documents opening this to `0.0.0.0/0`. If followed, this is a live, unauthenticated, internet-facing data-deletion and credential-disclosure endpoint, not a theoretical weakness. Even restricted to a LAN/VPC, any other user or compromised machine on that network has the same access.

**Compounding factor:** `server/main.go`'s `cors` middleware sets `Access-Control-Allow-Origin: *` on every response with no allowlist — the calls above work unmodified from *any* website's JavaScript, not just from a terminal.

---

## High

### 2. `UpdateProblemHandler` leaks test-case files on disk when a partial update fails — `CreateProblemHandler` doesn't have this bug, which shows it was noticed and fixed in one place but not the other

**File:** `server/handlers/problem.go`, `UpdateProblemHandler` (lines ~271–314), contrast with `CreateProblemHandler` (lines ~189–215).

Both handlers write new test-case files to disk *inside* a DB transaction closure — `storage.WriteTestCaseFiles` is a plain filesystem write with no transactional guarantee, so if it fails on, say, the 2nd of 3 new test cases, the DB rows for all 3 roll back cleanly, but the file(s) already written for the earlier, successful iteration(s) are not part of that rollback and stay on disk.

`CreateProblemHandler` accounts for this — on `txErr != nil` it calls `storage.RemoveProblemDir(problem.ID)`, wiping every file just written for that problem, orphaned or not:

```go
if txErr != nil {
    storage.RemoveProblemDir(problem.ID)
    writeError(w, http.StatusInternalServerError, "Couldn't save the problem. Please try again.")
    return
}
```

`UpdateProblemHandler`'s equivalent branch has no such call:

```go
if txErr != nil {
    writeError(w, http.StatusInternalServerError, "Couldn't update the problem. Please try again.")
    return
}
```

**Production impact:** a partial failure during an *edit* (disk pressure, a transient write error, anything) leaves `.in`/`.out` files under `data/testcases/problem_<id>/` with no owning database row and no log line announcing it. Nothing ever cleans these up — they're indistinguishable by filename from legitimate files for other test cases *still on that same problem*, so there's no safe generic sweep either. Disk usage grows quietly on every failed update, forever, with zero operator visibility.

### 3. `GenerateBundleHandler` builds a ~150MB zip fully in memory, with no concurrency limit, on an instance documented to have 1GB of RAM total

**File:** `server/handlers/package.go`, `buildPlatformBundle` and `GenerateBundleHandler`.

```go
buf := &bytes.Buffer{}
zw := zip.NewWriter(buf)
...
if err := writeFileEntry(zw, entry.Name(), filepath.Join(bundleDir, entry.Name())); err != nil {
```

The per-file writes stream via `io.Copy`, which is fine — but the *destination* they stream into is one `bytes.Buffer` that holds the entire assembled zip (contest package + LAN server binary + Docker setup script + the platform's Electron `.dmg`/`.exe` installer, observed at 130–150MB for the macOS bundles) in process memory until the whole thing is built, then returns it as a single `[]byte` that gets written to the response in one shot. Nothing streams the *zip.Writer's output* directly to `http.ResponseWriter` as it's produced.

`deploy/README.md` names the target instance explicitly: a t2/t3.micro, 1GB RAM total, no swap mentioned. Go's `net/http` spawns one goroutine per request with no built-in concurrency cap on this specific route — two people clicking "download bundle" at the same moment (a very ordinary thing for an organizer to do, e.g. testing both a Mac and Windows download back to back, or two organizers hitting the same shared instance) means two ~150MB buffers alive simultaneously, on top of whatever GORM/SQLite and the Go runtime itself are already holding. This is a realistic path to the process being OOM-killed — which takes down *every* contest on the instance, not just the one being downloaded, since there's no per-contest isolation (see finding #1 on why that matters more here than it otherwise would).

### 4. No cap on multipart upload size — the 32MB constant is not a limit, it just changes where the overflow goes

**File:** `server/handlers/problem.go`, `parseProblemForm` / `maxUploadMemory`.

```go
// Held in memory before the multipart reader spills remaining file parts
// to temp disk on its own — this isn't a hard cap on upload size.
const maxUploadMemory = 32 << 20
```

The comment is honest about what this does — it's not a size limit, it's a memory/disk split point. `r.ParseMultipartForm(maxUploadMemory)` will happily accept a request body of any size; past 32MB it just starts writing to the OS temp directory instead of RAM. There is no `http.MaxBytesReader` wrapping `r.Body` anywhere, so nothing actually rejects an oversized request.

**Production impact:** combined with finding #1 (no auth needed to reach this endpoint at all), anyone can POST arbitrarily large multipart bodies to `/contests/{id}/problems` repeatedly and fill the instance's disk — the same disk that `data/cloud.sqlite` lives on, so this can take the whole app down, not just this one feature.

---

## Medium

### 5. The frontend discards every real network error and replaces it with one generic, undiagnosable message

**File:** `client/src/api/client.js`, `apiFetch`.

```js
}).then(
  (res) => res,
  () => {
    throw new Error("Couldn't reach the LANJudge Cloud server. Check your connection and try again.")
  },
)
```

Every rejection path — a genuine network failure, the 15-second `AbortSignal.timeout` firing, a CORS preflight failure, a TLS certificate error, a DNS failure — collapses into this one string, and the actual `Error`/`DOMException` that triggered it is never logged anywhere, not even to `console.error`. If the real cause is a backend misconfiguration (wrong port, broken CORS setup, the Go process crashed), the person debugging it — organizer or developer — has no way to see that from the browser; every failure looks identical to "your WiFi is down."

### 6. Wildcard CORS on every route

**File:** `server/main.go`, `cors`.

`Access-Control-Allow-Origin: *` with no allowlist, applied globally via `cors(http.DefaultServeMux)`. On its own, with no cookie-based session to protect, this isn't a CSRF vector — but it's the mechanism that makes finding #1 exploitable from arbitrary third-party web pages instead of only from a terminal or a browser's own address bar. Worth fixing independently of #1: even after auth exists, a wildcard origin on an API that will eventually carry credentials is the wrong default to have shipped from.

---

## Low

### 7. `frontendHandler`'s error is silently discarded

**File:** `server/web.go`.

```go
sub, _ := fs.Sub(frontendFS, "web/dist")
```

In the current setup this can't actually fail at runtime — `//go:embed web/dist` guarantees the directory is present at compile time, so `fs.Sub` rooted at exactly that path cannot error. That's precisely why this is worth a one-line comment rather than a silent `_`: the invariant that makes this safe lives entirely in someone's head right now, not in the code, and it stops being true the moment anyone changes the embed path without also updating this line.

### 8. `db.InitDB` panics instead of returning an error, and the systemd unit will crash-loop on it

**File:** `server/db/db.go`, `InitDB`.

```go
database, err := gorm.Open(sqlite.Open("data/cloud.sqlite"), &gorm.Config{})
if err != nil {
    panic(err)
}
```

Same shape as `LANJudge-Server/Backend`'s equivalent, audited earlier this session. Here it matters slightly more because `deploy/campuscode-cloud.service` sets `Restart=on-failure` with `RestartSec=5` — a *persistently* broken environment (wrong permissions on `data/`, a corrupted sqlite file, a full disk) doesn't fail once with a clear message in the journal; it panics, restarts, panics again, forever, every 5 seconds.

### 9. No owner/tenant field on `Contest` at all

**File:** `server/models/contest.go`.

```go
type Contest struct {
    ID              uint      `json:"id" gorm:"primaryKey"`
    Name            string    `json:"name"`
    ...
}
```

Flagging this separately from #1 because it's a schema problem, not just a missing-middleware problem: even after auth is added, there's currently nowhere to record *whose* contest a row is. Fixing #1 properly means a migration here too, not just wrapping the existing handlers — worth doing while the table is still small and has no real users' data riding on the column layout.

---

## What I did not find

- No SQL injection surface — every query goes through GORM's parameterized query builder; nothing concatenates user input into raw SQL.
- No path traversal in `storage/testcases.go` — `problemDir`/file paths are built from `uint` IDs formatted with `%d`, which cannot contain `../` or any other traversal sequence.
- The one `dangerouslySetInnerHTML` in the client (`AddProblems.jsx`, statement preview) is correctly guarded — `DOMPurify.sanitize(marked.parse(...))` runs first, in `lib/markdown.js`. Not a bug.
- `models.Contest.AdminPassword` is correctly excluded from every JSON API response (`json:"-"`) — it only appears where it's supposed to, inside the exported `manifest.json`.
- The deploy scripts (`build.sh`, the systemd unit) are internally consistent — `WorkingDirectory` is correctly set to `<APP_DIR>/server` (matching every `data/...`-relative path in the Go code), and the frontend build order/output path lines up exactly with what `web.go`'s `go:embed` expects. No bug found there.
- `CreateProblemHandler`'s file/DB consistency on failure is handled correctly (contrast with finding #2).

---

## Priority order — ranked by how easily a participant/opportunist would find and exploit it in practice

1. **#1 — No auth at all.** Trivial to find (any curious person opens devtools' Network tab while using the app once, sees the plain unauthenticated `fetch` calls, and can replay them against any ID). Zero skill required beyond copy-pasting a URL. Fix this first; nothing else in this list matters much until it's fixed, since #1 is what turns #2 and #4 from "a bug" into "a bug anyone can trigger against anyone else's data."
2. **#4 — No upload size cap.** Also trivial once #1 is understood — same discovery path, one extra step (send a big file instead of a normal request).
3. **#3 — In-memory bundle OOM risk.** Doesn't require malicious intent at all — two organizers using the feature normally at the same time is enough. Fix before this is used for a real contest on the documented micro instance.
4. **#2 — Orphaned files on update failure.** Needs an actual transient failure to trigger, so it's the slowest of the high-severity items to surface in practice — but it's a silent leak with no alarm, which is exactly the kind of bug that goes unnoticed until a disk fills up mid-contest-season.
5. **#6 — Wildcard CORS.** Fix alongside #1, not after it — they're two halves of the same door.
6. **#5, #7, #8, #9.** Lower urgency: #5 costs debugging time, not data; #7 and #8 are correctness/operability nits with no live trigger today; #9 is a schema debt to pay down as part of fixing #1, not before it.
