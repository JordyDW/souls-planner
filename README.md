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
| 📁 builds | Opens the drawer: load, copy a link, rename, delete, compare, export or import. |
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

### Knowing whether you have saved

Under the class selector there is a line telling you where the build stands:

* **○ Unsaved draft** — nothing named yet. It is still in the address bar and will survive a
  refresh; click the line to give it a name.
* **● Havel Tank · saved** — matches the build you saved.
* **● Havel Tank · 3 unsaved changes** — you have changed three things since saving. Click it to
  see exactly which three, side by side with the saved version.

The count is a real diff rather than a "something changed" flag, so reverting an edit by hand
takes it back down. While there are unsaved changes the browser tab title gets a ● in front of
it, which is what you want when several planners are open at once.

### Comparing two builds

Tick two builds in the drawer and press Compare. The current build counts as one of the two, so
"how does what I have now differ from what I saved" is a two-click question.

You get two tables. **Result** is the whole output panel for both builds side by side — HP,
stamina, weight, poise, every defence, absorption and resistance — with the differences
highlighted and a delta in the last column. **Changed** lists what you actually altered: gear,
infusions, stats, toggles, and which slots are parked.

Those result figures are not recalculated here. Each build is loaded into an off-screen copy of
the planner page and its output panel is read back, so the numbers are the ones the planner
itself would show. Nothing is sent anywhere; the copies are the same local page.

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
