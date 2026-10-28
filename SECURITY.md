# Security

## Trust boundary

The macOS application runs a loopback-only backend on a random port, guarded by
a per-launch 256-bit secret injected only into requests from its private Electron
session. The renderer has no Node integration and uses sandboxing and context
isolation. No remote renderer, analytics, updater or external script is loaded.
The desktop user explicitly chooses the HTTPS Confluence target; unlike web
mode, the desktop does not require an administrator hostname allowlist.
Browser cache and cookies are in a non-persistent session partition.
Mark uses private temporary files during conversion, removed on success,
failure or worker timeout. An OS crash or forced process kill can interrupt
cleanup; normal OS temporary-directory policies then apply.

The optional web service handles private documents and Confluence passwords in request memory.
Deploy only on trusted, authorized infrastructure behind HTTPS. The shared website
access secret is not an enterprise identity system. Consider VPN or an identity
gateway before allowing multiple users.

No credentials are stored in sessions, backups, source files or CLI arguments.
The browser keeps typed credentials only in component memory. Publishing clears
the password field. Browser extensions, password managers, TLS terminators and
host administrators are outside this application's security boundary.
Do not enable request-body logging, tracing or analytics on the reverse proxy.

In web mode, the administrator controls exact upstream hostnames. HTTPS certificates must
validate and redirects are rejected. DNS for allowed hosts must be trusted.
The application does not attempt to make an untrusted allowlist safe.

Documents are parsed in limited worker threads with timeouts. Mark receives
sanitized HTML, not user-provided Mark directives or credentials. No local
includes or automatic remote image fetching are allowed. A read-only non-root
container limits consequences but is not a substitute for patching.

Backups contain the original company page. Protect the Mac user account (or web data volume and host),
encrypt backups as required by policy, and enforce a retention schedule.
The backup is a REST snapshot, not a full recoverable Confluence export.
Opening a backup from the "本机备份" panel only loads the snapshot into the local
editor as a draft; it never writes to Confluence. Publishing afterwards uses the
normal flow: re-read the live page, verify the page ID and version, require the
current title and an explicit confirmation, save a fresh snapshot of the live
page first, then update with version protection and read the body back.
Macros and attachment images cannot be reconstructed from a backup and must be
re-inserted before publishing; permissions, comments and unrelated history are
not restored either.

Retention defaults to 7 days and can be changed or disabled in the app. Cleanup
only deletes backups created after the retention feature was enabled; snapshots
from earlier versions are removed only after an explicit policy is saved.

## Known limits

- Updating a page replaces its body. Existing macros and references are not merged.
- Inline comments are blocked when their markers are detected in storage.
  This does not enumerate every possible plugin-specific annotation.
- Attachment uploads are additive. If a subsequent version conflict aborts a
  publish, newly uploaded hash-named attachments can remain on the target page.
- A lost PUT response has an uncertain result. Inspect the page before retrying.
- Confluence may normalize markup. Structural readback is not visual verification.
- Sessions expire after 30 minutes, not on an inactivity-sliding schedule.
- Single-instance in-memory sessions; horizontal scaling is not supported.

## Dependency audit

At initial release, `npm audit` reports three moderate dependency entries for
one advisory, GHSA-hp3w-g68c-fv3c: `sprintf-js`, via `argparse`, via `mammoth`.
The vulnerable precision formatting is in the Mammoth command-line dependency
tree. PagePort uses `mammoth.convertToHtml` from its library entry, never the
Mammoth CLI, argparse or sprintf-js. No patched sprintf-js release was available
at the time of review. Do not apply npm's suggested Mammoth downgrade to 0.3.x.
Re-evaluate this reachability and upstream fixes on every dependency update.

Mark binaries in Docker and CI are pinned to 16.22.0 and checked against SHA-256.
Keep the lockfile committed. Run tests and audit when updating dependencies.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- **Committers and reviewers**: [chopperH0824](https://github.com/chopperH0824)
- **Approvers**: [chopperH0824](https://github.com/chopperH0824)
- **Privacy policy**: This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.
  - All document conversions run locally via the bundled Mark executable on `127.0.0.1`.
  - Confluence connections occur only when the user explicitly checks or publishes to their chosen HTTPS Confluence server.
  - Release update checks fetch public version metadata from `https://api.github.com` (with fallback to `https://pageport.chopperh.me/downloads/latest.json`) and can be disabled in the application's Update preferences.
- **Artifact scope**: Only PagePort's own installer and application binaries built on GitHub-hosted runners are signed with the project's SignPath policy; bundled upstream OSS binaries (`mark.exe`) remain unsigned upstream artifacts inside the installer.

## Reporting

Do not publish private content, credentials or exploit details in a public issue.
Use the repository owner's private contact or GitHub private vulnerability
reporting when enabled. Rotate any exposed password immediately.
