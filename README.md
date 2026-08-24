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
* **● Havel Tank · 3 unsaved changes** — with the fields named underneath (*Head, Legs, Vigor*),
  the before and after in the tooltip, and a click for the full side-by-side.

The count is a real diff rather than a "something changed" flag, so reverting an edit by hand
takes it back down. While there are unsaved changes the browser tab title gets a ● in front of
it, which is what you want when several planners are open at once.

### What each item is, while you are choosing it

Equipment dropdowns now carry the numbers, so you no longer equip a chest piece to find out it
weighs 24kg:

* **Armour** — weight, poise and physical absorption (Dark Souls and Dark Souls 2 show flat
  defence, because that is how those games work).
* **Weapons** — weight and requirements, with any stat you are short of in red, so an unwieldable
  weapon reads as one before you pick it. Requirements are checked against your *total* stats, so
  a ring that pushes you over clears the warning.
* **Rings** — weight and their actual effect text, which previously only appeared once the ring
  was already on.

**Hover any option** and a card shows what it would do to your build — equipment load, roll type,
poise, and for weapons the attack rating. Those numbers are not estimated: the planner is asked to
calculate the candidate and its own output is read back, then the build is put straight back. It
happens inside a single synchronous step, so nothing flickers and nothing is left changed.

Deliberately not shown in the *columns*: weapon AR. The planner derives it with a correction step for rings and
buffs that is not reachable from outside, so any number computed here would quietly disagree with
the one you see once the weapon is equipped.

For Dark Souls 3, a piece's poise and absorption are its own contribution — pieces combine
multiplicatively rather than adding, which is how the planner totals them.

### Posting a build somewhere

The image button opens a share panel with a picture of the build — name, level, class, stats,
gear and the headline numbers — for posting where a link is the wrong answer, like Discord or
Reddit. From there you can download it as a PNG, copy the same thing as text, or copy the link.

**Copy for an AI** produces a different, fuller readout meant to be pasted to an assistant: every
attribute as a total, all equipment including infusions and parked slots, every calculated stat,
which weapon requirements you do not meet, what is active, and what you have equipped but not
marked as owned. It opens by asking the assistant to use the exact numbers rather than estimate,
because the requirements and derived stats are precisely what it would otherwise guess at.

The card is drawn straight onto a canvas rather than through a DOM-to-image library, so there is
no extra dependency and it keeps working offline. Parked slots are labelled as such rather than
silently omitted.

### Marking what you own

The planner assumes you have access to everything, which is never true mid-playthrough. Mark items
as owned and the inventory button filters every dropdown and the browser down to what you actually
have — the equipped item always stays selectable, so nothing gets stuck.

Filling the list is the part that had to be cheap, because Dark Souls 3 alone has 360 armour
pieces, 305 weapons, 115 rings and 105 spells:

* **Anything you equip is marked automatically.** The list builds itself as you use the planner.
* **Armour sets go in one click.** The item ids encode sets, so *set* on any piece marks the whole
  four-piece set across all four slots. (Dark Souls 2 keys items by name, so there it marks the
  single piece.)
* **Bulk marking in the browser** — search, then *Mark all shown*.

The status line quietly notes when a build uses something you have not marked. Owned state is per
game, kept beside your builds, and deliberately never travels in a share link: it describes you,
not the build.

### Browsing a slot properly

A dropdown is the wrong shape for "which chest piece gives me the most poise for its weight". The
table button in the toolbar opens its own panel listing every item for a slot as a sortable table — the same numbers as
the dropdown, plus derived columns a dropdown cannot show, **poise per weight** being the one that
usually settles it.

Pick the slot from inside the browser, so you can flick between them while comparing. Sort by any
column, search by name, or tick **Only what fits** to hide anything heavier than your remaining
equip load — counting the slot's current item, since equipping replaces rather than adds. Clicking
a row equips it and leaves the table open, so you can try a few against each other.

### Undo

The undo and redo buttons in the toolbar step through your last 50 changes, as do `Ctrl`+`Z` and
`Ctrl`+`Shift`+`Z` (or `Ctrl`+`Y`). They grey out when there is nothing left in that direction. Equipment, stats, infusions, toggles and parked slots all come back, and loading a
saved build counts as a step, so you can undo that too. Inside the drawer's text boxes `Ctrl`+`Z`
is left to the browser, where you would want it for typing.

Loading a build no longer reloads the page either — it applies in place, which is what made undo
possible in the first place.

### Keeping builds organised

Each saved build can carry **notes** and **tags**, edited together with its name from *Edit* in
the drawer. Notes for the build you have loaded also appear in the planner itself, in the
description block under the equipment — that block is original to the site and was simply sitting
there hidden because nothing ever filled it.

The drawer has a search box (name, notes and tags), a sort control (recent, name or level, and it
remembers your choice), a strip of your tags to filter by, and a *Duplicate* action for when a new
build starts life as a variation on an old one.

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

## Getting around

Every page of a game now carries a second bar listing that game's tools — planner, weapon attack
and defence, ranged, stamina, armor, spells, items — with the current one marked, and the current
game marked in the menu above it. Previously only the planner listed them, at the bottom of a very
long page, so moving between two calculators meant going out to the home page and back.

Switching game keeps the tool you are on where the other game has it, so Dark Souls 3's weapon
calculator goes straight to Dark Souls'. Dark Souls 2 was only mirrored as a planner, so it falls
back to that.

## The calculators

The attack, defence, stamina, armor, spell and item calculators now remember what you set. Same
deal as builds: state is kept per page and mirrored into a `#c=` link you can share or bookmark.
Their group and infusion filters are included, so a calculator stays set up the way you left it.

They can also **pull stats from a build** instead of you retyping them. The dropdown under the
attributes lists the build currently open in the planner plus every saved build; pick one and the
stats it shares with that calculator are copied across — strength, dexterity, intelligence, faith,
luck, and humanity on Dark Souls. Nothing else is touched, so your weapon filters stay put.

A link made for one calculator is refused by another rather than half-applied, and a corrupt link
falls back to your saved settings instead of wiping them.

## Offline, and installing it

The site registers a service worker, so after the first visit it loads from disk and keeps working
with no connection at all — which is what this mirror was always meant to be.

Two different rules, because the assets are not alike:

* **Pages, fonts, vendors and the persistence layer are always kept.** A few hundred KB, cached on
  the first visit.
* **Game data is only kept once you ask for it**, by opening that game or by pressing *Save for
  offline* on the home page. Dark Souls 3 alone is 11MB (Dark Souls 3.2MB, Dark Souls 2 0.5MB), so
  downloading all of it because you glanced at the home page would be rude.

The home page lists all three with their size and whether they are saved. Open a game page whose
data was never saved and you get a banner saying so, rather than a planner with empty dropdowns.

It also installs as an app. There is an **Install app** button — in the game tool bar, and on the
home page beside the offline list — which appears only when your browser says installation is
possible and disappears once it is installed. Installed, it opens in its own window with no
browser chrome.

After a deploy the new version installs in the background and applies on the next load; you get a
"reload to update" note rather than having bundles swapped underneath a planner you are using. To
force everything to be re-fetched, bump `CACHE_VERSION` in `sw.js`.

Worth knowing if you edit the code: the worker serves the shell cache-first, so a changed script
keeps loading from cache until the worker updates. Add `?nosw` to any URL to skip the worker and
tear down whatever is installed — that is also the way out if a cache ever ends up in a bad state.
Bumping `CACHE_VERSION` forces a clean rebuild for everyone.

### A note on opening the files directly

Chrome refuses `localStorage` to pages opened as `file://`, so saved builds will not stick that
way — share links still work, and Firefox is unaffected. Service workers are not available over
`file://` at all, so the offline caching above needs the folder served rather than opened. Both
work if you serve it:

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
