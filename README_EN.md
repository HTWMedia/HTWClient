<div align="center">

# HTW Media

### Render a JianYing draft without opening the JianYing app

Drop a draft folder in → render in the cloud → the mp4 lands next to your draft. Encrypted drafts are read directly, and batch runs don't touch your machine.
Above that sits the full pipeline: topics → script → edit → publish. The desktop app is a GUI shell; the CLI and Agent Skills call the same `/api/v2/*` endpoints.

<sub>Unofficial tool, not affiliated with ByteDance or CapCut/JianYing. Anything involving JianYing only touches **your own** drafts and login — the login is supplied by you and used for a single request; no other people's accounts, no third-party template downloads. See "Compliance boundaries" below.</sub>

[![Version](https://img.shields.io/badge/version-v0.5.2-blue.svg)](https://github.com/HTWMedia/HTWClient/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[中文](README.md) ｜ [Issues](https://github.com/HTWMedia/HTWClient/issues) ｜ [Releases](https://github.com/HTWMedia/HTWClient/releases) ｜ [Web app](https://htwmedia.dpdns.org)

**Keywords**: JianYing draft render · draft batch export · encrypted draft reader · Douyin Xiaohongshu Bilibili Toutiao auto publish · AI topic research · batch video production · Agent Skills

</div>

---

**Three entry points — pick by what you have right now:**

| You have | Use | You get |
| --- | --- | --- |
| A JianYing draft project | `htw-skills draft <folder>` | An mp4 written back beside the draft |
| A topic but no footage | Create panel / `htw-skills create` | A shootable script, image post, or article |
| A finished video | Publish panel / `htw-skills publish` | Douyin · Xiaohongshu · Bilibili · Toutiao in one submit |

> **No AuthKey yet?** The first item in the Windows client — "Draft Check" — runs without an account: local decryption, track and media audit, plaintext JSON export.

---

## 0. No AuthKey yet: check a draft first (Windows client v0.5.2+ · no signup)

The first item in the client is **Draft Check**. No network, no AuthKey, no quota:

1. In JianYing, right-click a draft → "Open draft folder", copy the path;
2. Client → "Draft Check" → "Choose folder…";
3. A few seconds later: whether it's encrypted (decrypted locally), duration / canvas / fps, track counts and segment counts, how many assets are referenced, **which ones are missing**, and the folder size;
4. "Export decrypted JSON" writes plaintext next to the draft (`draft_content.decrypted.json`) — the original file is not touched.

The point is concrete: **know before you spend quota whether the draft will render into a broken video.** Missing assets, an empty
timeline, audio-only drafts — all stated here instead of discovered as a black frame after the cloud render finishes.

It only reads the folder you pick, decryption happens in local memory, and nothing is uploaded. Add an AuthKey when you want the render.

---

## Before you start: one AuthKey

Request one at [HTW Media](https://htwmedia.dpdns.org) with your email — you get a verification code, then the key is sent to your inbox.

- Free tier: **60 finished minutes per month**, reset monthly, no rollover. Charged only when a render actually succeeds; failed jobs are free.
- **Valid for 30 days** from issue. Re-request with the same email afterwards; finished tasks and account data are unaffected.

```bash
git clone --depth 1 https://github.com/HTWMedia/HTWClient
cd HTWClient

export HTW_API_KEY="your-key"        # PowerShell: $env:HTW_API_KEY="your-key"
```

---

## 1. You have a draft: one command to a finished video

```bash
node agent/cli/htw-skills.mjs draft "/path/to/your/draft-folder" --cookie-file ./jy-cookie.txt
```

Pass a **folder** (it gets zipped, assets and subfolders included) or an already-packed `.zip`; the video is written back next to your draft.
Find the folder in JianYing: right-click a draft → "Open draft folder".

Drafts can also be generated in code: build the timeline with [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)
and let the platform render it — see the ready-to-run example in [`examples/pyjianying-draft/`](examples/pyjianying-draft/)
(`build_draft.py` writes a self-contained draft, `render.py` submits, polls and downloads the mp4).

Unlike scripted "click export inside JianYing" tools: nothing to install, no client window to keep open, no stolen mouse or focus, no local CPU burn.
Queue it overnight, collect the videos in the morning.

- **Rendering runs in the cloud.** The job is submitted to the platform and billed by finished duration (an exhausted quota returns HTTP 402).
- **The account is yours.** You must supply your own login (`--cookie` / `--cookie-file` / `HTW_JIANYING_COOKIE`) — the platform keeps no account pool and does not rotate accounts. The login is used for that one request and never stored; the desktop app keeps it **in plaintext** in the local config file `userData/htw-jianying.json` (same folder as your AuthKey) and the "Clear" button deletes it.
- Pointing at a local instance is still possible with `--local-base`, but it is an optional override, no longer a prerequisite.
- **It is not a way around a subscription** — features that require membership still won't render without it.
- Encrypted drafts (default since JianYing 5.9) are readable; no manual step needed.
- Options: `--out <dir>` · `--no-wait` · `--json`. Exit codes: `0` ok, `1` render failed, `2` bad args, `3` missing key.

---

## 2. No topic: see what to post today

```bash
node agent/cli/htw-skills.mjs call topics --daily
```

Nothing else to configure — no platform accounts needed:

- Every topic comes with **evidence** (recent high-performing posts from accounts you track, hot-list movement), not a made-up headline.
- Accept one and it flows straight into scripting: short video, image post, or article.
- `--json` for machine-readable output.

---

## Why this instead of a pile of separate tools

1. **One pipeline, not four tools.** Topics → script → edit → publish; each stage works alone, and each hands its output to the next inside the backend. Desktop app, CLI and Agent Skills all speak the same API.
2. **Then publishes.** Douyin, Xiaohongshu, Bilibili, Toutiao in one submit, with a compliance check before publishing and per-platform retry.
3. **Agent-native.** The same capabilities ship as Agent Skills (`agent/skills/`) so Claude Code / Cursor can orchestrate "research → script → render → publish".

> Sibling project [HDraft](https://github.com/HTWMedia/JyDraft) is the pure-CLI batch version of the same render pipeline (multi-draft concurrency, resumable tasks).

---

## Desktop app (Windows)

[Download the installer or portable exe](https://github.com/HTWMedia/HTWClient/releases/latest). Fourteen panels, starting with Draft Check (no account needed): topics, insight, create, marketing video, short drama, edit, publish, tools, assistant.

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
- **Publishing cookies are uploaded to the server** when you configure publishing — the server posts on your behalf. That is equivalent to handing over your account credentials; only do it if you trust the service, and rotate your passwords afterwards.
- **Draft-render login is never stored.** It is sent with that single request, used, and dropped — not logged, not written to the database. The desktop app keeps it in plaintext on your own machine at `userData/htw-jianying.json` (same folder as your AuthKey); the "Clear" button deletes it.
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
