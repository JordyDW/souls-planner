# SoulsPlaner

This is a offline version of [SoulsPlanner](https://soulsplanner.com/) which is a website with useful toolkit for DarkSouls serials. But because of the shaky Internet connection and its large size of game data without any lazy loading, I made this for local use.

**We strongly recommend that if you have a smooth network, please visit the original site.**

## Usage

two way to use:

1. You can visit [https://souls-planner.guangwu.red/](https://souls-planner.guangwu.red/).

2. Clone the project and open `index.html`. You could also save it as a bookmark.

## Differences

* Remove sign in, sign up, settings, builds, top16.
* Remove google analyze, google AD, cookies
* Fix some style issue
* Change all paths to relative paths for local use

## Saving and sharing builds

Added in this fork. The three character planners (DS, DS 2, DS 3) keep your build and can hand it
to someone else as a link. The calculator pages are unchanged — they have no build state.

Three buttons sit next to the existing "new" and "reset" icons above the class selector:

| Button | What it does |
| --- | --- |
| 💾 save | Save the current build under a name, or update the one you loaded. `Ctrl`+`S` also works. |
| 📁 builds | List of saved builds — load, copy a link, rename, delete, export or import. |
| 🔗 link | Copy a link to the current build to the clipboard. |

Beyond that it just works in the background:

* **Your build survives a refresh.** Every change is written to `localStorage`, and the address
  bar always holds a `#b=…` link to exactly what is on screen — bookmark it and you have a save.
* **Links are self-contained.** The whole build is compressed into the URL, so anyone opening one
  sees your build without a server being involved. A link only opens on the planner it was made
  for; a DS 3 link opened on the DS page is ignored rather than half-applied.
* **Nothing leaves your machine.** No accounts, no requests, no cookies.

"Reset" clears the current build and starts fresh; your saved builds are untouched.

### Trying a build without a piece

Every armour, weapon and ring slot has a checkbox. Untick it and the slot empties — the weight
and stats update as if nothing were equipped — but what was in it is remembered, so ticking the
box puts it straight back. Useful for "what do I weigh without leg armour" without having to go
and find the leggings again.

Weapons come back with their reinforcement and infusion intact (DS: upgrade path; DS 2:
infusion), and armour in DS keeps its reinforcement. Parked slots travel in saved builds and in
share links, so a link can show a build with a slot deliberately empty. Picking something new for
a parked slot re-enables it.

### Where the data lives

Under `localStorage`, per game (`darksouls`, `darksouls2`, `darksouls3`):

* `soulsPlanner.autosave.<game>` — the build currently on screen
* `soulsPlanner.builds.<game>` — your named builds
* `soulsPlanner.currentId.<game>` — which named build is loaded, so save overwrites it

Use Export in the builds dialog for a backup you can keep.

### A note on opening the files directly

Chrome refuses `localStorage` to pages opened as `file://`, so saved builds will not stick that
way — share links still work, and Firefox is unaffected. To get persistence from a local copy,
serve the folder instead:

```
python3 -m http.server 8000     # then open http://localhost:8000
```

### How it works

The original site was server-rendered: it injected a `var savedBuild = {...}` global and the
bundled planner applied it on load. Mirroring the site removed the account system that produced
that global, but the code that consumes it is still there in all three planner bundles. So
`public/scripts/persist/souls-persist.js` does not touch any of the minified code — it defines
that same global before the page is ready, and reads the build back out using a transcription of
the serializer the bundles still carry. The stored format is therefore the planner's own -
parked slots are the one thing the planner has no concept of, so they ride alongside the build
rather than inside it.
