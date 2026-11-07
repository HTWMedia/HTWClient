<div align="center">

# HTW Media

### Short-video workbench: topics → script → edit → publish to four platforms

One backend covers "what to post today" through "did it go out". The desktop app is a GUI shell; the CLI and Agent Skills call the same `/api/v2/*` endpoints.

<sub>Unofficial tool, not affiliated with ByteDance or CapCut/JianYing. Anything involving JianYing only touches **your own** drafts and login — the login is supplied by you and used for a single request; no other people's accounts, no third-party template downloads. See "Compliance boundaries" below.</sub>

[![Version](https://img.shields.io/badge/version-v0.5.0-blue.svg)](https://github.com/HTWMedia/HTWClient/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[中文](README.md) ｜ [Issues](https://github.com/HTWMedia/HTWClient/issues) ｜ [Releases](https://github.com/HTWMedia/HTWClient/releases) ｜ [Web app](https://htwmedia.dpdns.org)

**Keywords**: short-video workbench · Douyin Xiaohongshu Bilibili Toutiao auto publish · AI topic research · viral post breakdown · batch video production · JianYing draft project · draft export · Agent Skills

</div>

---

## 60 seconds: see what to post today

```bash
git clone --depth 1 https://github.com/HTWMedia/HTWClient
cd HTWClient

export HTW_API_KEY="your-key"        # PowerShell: $env:HTW_API_KEY="your-key"

node agent/cli/htw-skills.mjs call topics --daily
```

Nothing else to configure — no platform accounts needed:

- Every topic comes with **evidence** (recent high-performing posts from accounts you track, hot-list movement), not a made-up headline.
- Accept one and it flows straight into scripting: short video, image post, or article.
- `--json` for machine-readable output.

Get a key at <https://htwmedia.dpdns.org> (Settings → create AuthKey). The free tier includes **60 render-minutes per month**, reset monthly; failed tasks are not charged.

### Advanced: render one of your own draft projects (cloud render)

```bash
node agent/cli/htw-skills.mjs draft "/path/to/your/draft-folder" --cookie-file ./jy-cookie.txt
```

Pass a **folder** (it gets zipped, assets and subfolders included) or an already-packed `.zip`; the video is written back next to your draft.
Find the folder in JianYing: right-click a draft → "Open draft folder".

- **Rendering runs in the cloud.** The job is submitted to the platform and billed by finished duration (an exhausted quota returns HTTP 402).
- **The account is yours.** You must supply your own login (`--cookie` / `--cookie-file` / `HTW_JIANYING_COOKIE`) — the platform keeps no account pool and does not rotate accounts. The login is used for that one request and never stored; the desktop app keeps it **in plaintext** in the local config file `userData/htw-jianying.json` (same folder as your AuthKey) and the "Clear" button deletes it.
- Pointing at a local instance is still possible with `--local-base`, but it is an optional override, no longer a prerequisite.
- **It is not a way around a subscription** — features that require membership still won't render without it.
- Encrypted drafts (default since JianYing 5.9) are readable; no manual step needed.
- Options: `--out <dir>` · `--no-wait` · `--json`. Exit codes: `0` ok, `1` render failed, `2` bad args, `3` missing key.

---

## Why this instead of a pile of separate tools

1. **One pipeline, not four tools.** Topics → script → edit → publish; each stage works alone, and each hands its output to the next inside the backend. Desktop app, CLI and Agent Skills all speak the same API.
2. **Then publishes.** Douyin, Xiaohongshu, Bilibili, Toutiao in one submit, with a compliance check before publishing and per-platform retry.
3. **Agent-native.** The same capabilities ship as Agent Skills (`agent/skills/`) so Claude Code / Cursor can orchestrate "research → script → render → publish".

> Sibling project [HDraft](https://github.com/HTWMedia/JyDraft) is the pure-CLI batch version of the same render pipeline (multi-draft concurrency, resumable tasks).

---

## Desktop app (Windows)

[Download the installer or portable exe](https://github.com/HTWMedia/HTWClient/releases/latest). Nine panels: topics, insight, create, marketing video, short drama, edit, publish, tools, assistant.

macOS / Linux: use the web app at <https://htwmedia.dpdns.org> — same account, same quota, same `/api/v2/*` contract.

![Panels](docs/images/panels.png)

---

## Tooling

```bash
cd agent/cli
export HTW_API_KEY="your-key"
node htw-skills.mjs list                        # list capabilities
node htw-skills.mjs call insight --hot --dry-run
```

Features: `insight` · `create` · `topics` · `publish` · `tools` · `edit` · `workflow`.
Full CLI reference: [docs/getting-started.md](docs/getting-started.md).

---

## Privacy

- Media is used only while a task is running and deleted afterwards.
- **Platform cookies are uploaded to the server** when you configure publishing — the server posts on your behalf. That is equivalent to handing over your account credentials; only do it if you trust the service, and rotate your passwords afterwards.
- No human reviews your content; everything runs through automation.

## Compliance boundaries

This project is **not a CapCut/JianYing replacement, and not a way to bypass its paid tiers**. To be explicit:

**We do**: process footage and projects *you* shot and edited; publish through *your* accounts.

**We don't** (some features were removed for this reason):

| Item | Status |
| --- | --- |
| Downloading and re-applying JianYing templates / stickers / effects to render videos ("cut same") | **Removed 2026-11-06.** Template and asset copyrights belong to JianYing and their creators; a Chinese court has already ruled that offering an equivalent service constitutes unfair competition |
| Rotating multiple accounts to get around JianYing's per-account rate limits (the old "account pool") | **Removed.** One account is used; hitting a rate limit fails honestly instead of retrying on another account |
| Unlocking membership-only features for non-members | **Not offered.** Without the entitlement, membership features still won't render |

The "JianYing" / "CapCut" marks belong to their owners; this project refers to them only to describe the file formats it reads.
If you believe any behaviour here crosses a line, open an issue — we will verify and adjust.

---

## License

[MIT](LICENSE)
