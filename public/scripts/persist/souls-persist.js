/*!
 * souls-persist - build persistence and shareable links for the offline SoulsPlanner.
 *
 * WHY THIS IS SO SMALL
 *
 * soulsplanner.com was server-rendered: PHP injected a `var savedBuild = {...}` global into the
 * page and the bundled planner applied it on DOM ready. Mirroring the site removed the account
 * system that produced that global, but the code that *consumes* it survived untouched in all
 * three planner bundles, guarded by `"undefined" != typeof savedBuild`. So loading a build needs
 * no DOM poking here: define that global and the planner restores equipment, infusions, buff
 * checkboxes and per-weapon panel visibility, then recalculates, exactly as it always did.
 *
 * Saving is the mirror image. Each bundle still carries the serializer that used to feed the
 * removed "save build" request, so the adapters below are transcriptions of it - which means the
 * format we store is the planner's own format and round-trips for free.
 *
 * Two transformations the deleted PHP layer used to perform, now done in the adapters:
 *   - the bundled serializer emits `class`, the applier reads `class_`
 *   - the bundled serializer emits booleans, the applier tests `1 === value`
 *
 * ORDERING - the one thing that must not change: restore() runs at top-level script execution,
 * NOT inside $(document).ready. jQuery runs ready callbacks in registration order and
 * planner.min.js registers its applier first, so a ready callback here would always be too late.
 * The UI setup further down is in a ready callback on purpose - by then the planner has populated
 * every select and applied the restored build.
 */
;(function () {
  'use strict'

  var FORMAT = 1
  var HASH_PREFIX = '#b='
  var DEBOUNCE_MS = 250
  var COMPARE_PARAM = 'sp-compare=1'

  /* This page is an off-screen instance loaded by compare mode purely so the planner will do its
     own maths on a build. It restores the build from the hash exactly as normal, then keeps well
     clear of everything else - no toolbar, no drawer, and above all no writing to localStorage or
     the address bar, which belong to the real page that opened it. */
  var isCompareFrame = window.location.search.indexOf(COMPARE_PARAM) !== -1

  /* ------------------------------------------------------------------ helpers */

  function values(selector) {
    var out = []
    $(selector).each(function () {
      out.push($(this).val())
    })
    return out.join(';')
  }

  /* Slot id plus one value per suffix, flattened - e.g. rh1;rh1-reinforce;rh1-infusion. */
  function slotValues(selector, suffixes) {
    var out = []
    $(selector).each(function () {
      var id = $(this).attr('id')
      out.push($(this).val())
      for (var i = 0; i < suffixes.length; i++) {
        out.push($('#' + id + suffixes[i]).val())
      }
    })
    return out.join(';')
  }

  /* Spells and items pair a select with a "buff" checkbox two levels up. */
  function valuesWithBuffs(selector) {
    var picked = []
    var buffs = []
    $(selector).each(function () {
      picked.push($(this).val())
      buffs.push($(this).parent().parent().children('.buff').is(':checked') ? 1 : 0)
    })
    return { values: picked.join(';'), buffs: buffs.join(';') }
  }

  /* Which stat panel (attack / requirements / ...) is showing for each weapon slot. */
  function paramVisible(selector) {
    var out = []
    $(selector).each(function () {
      var shown = $(this).parent().parent().children('.equipment-params[data-visible=true]').attr('class')
      out.push(shown ? shown.split(' ').pop() : '')
    })
    return out.join(';')
  }

  function flag(selector) {
    return $(selector).is(':checked') ? 1 : 0
  }

  /* ----------------------------------------------------------------- adapters */

  var ADAPTERS = {
    darksouls: {
      required: [
        'class_', 'level', 'gender', 'covenant', 'covenantLevel', 'armor', 'weapons',
        'weaponsParamVisible', 'grip', 'isLowHP', 'isDragonHead', 'isDragonTorso', 'rings',
        'spells', 'spellBuffs', 'arrows', 'bolts', 'items', 'itemBuffs', 'vitality',
        'attunement', 'endurance', 'strength', 'dexterity', 'resistance', 'intelligence',
        'faith', 'humanity'
      ],
      slots: [
        { selector: '.planner .armor .wrapper-protector select', suffixes: ['-reinforce'] },
        { selector: '.planner .weapons .wrapper-weapon select', suffixes: ['-reinforce', '-upgrade'] },
        { selector: '.planner .rings select', suffixes: [] }
      ],
      /* Dark Souls quotes armour as flat defence rather than a damage multiplier, and its rings
         are weightless, so those two columns differ from Dark Souls 3's. */
      info: {
        poiseLabel: 'Poise (adds across pieces)',
        defenceLabel: 'Physical defence at +0 (adds across pieces)',
        defenceUnit: '',
        armor: function (id) {
          /* Dark Souls adds poise and defence up rather than multiplying, and its Protector takes
             a reinforce level - defence rises with upgrades, so this is the +0 figure. */
          var p = new DarkSouls.model.Protector(id, 0)
          return { weight: p.getWeight(), poise: p.getPoise(), defence: p.getPhysicalDEF() }
        },
        weapon: function (id) {
          var w = new DarkSouls.model.Weapon(parseInt(id, 10), 0, 0)
          return { weight: w.getWeight(), req: w.getRequirements() }
        },
        ring: function (id) {
          var r = new DarkSouls.model.Ring(parseInt(id, 10))
          return { effects: r.getDescription() || [] }
        },
        spell: function (id) {
          var sp = new DarkSouls.model.Spell(parseInt(id, 10))
          return { slots: sp.getSlotCount(), req: sp.getRequirements() }
        }
      },
      lists: [
        { key: 'armor', selector: '.planner .armor .wrapper-protector select', extras: ['-reinforce'] },
        { key: 'weapons', selector: '.planner .weapons .wrapper-weapon select', extras: ['-reinforce', '-upgrade'] },
        { key: 'rings', selector: '.planner .rings select', extras: [] },
        { key: 'spells', selector: '.planner .spells select', extras: [], buffs: 'spellBuffs' },
        { key: 'items', selector: '.planner .items select', extras: [], buffs: 'itemBuffs' },
        { key: 'arrows', selector: '.planner .arrows select', extras: [] },
        { key: 'bolts', selector: '.planner .bolts select', extras: [] }
      ],
      serialize: function () {
        var spells = valuesWithBuffs('.planner .spells select')
        var items = valuesWithBuffs('.planner .items select')
        var covenantLevel = parseInt($('#covenant-level').val(), 10)
        return {
          class_: $('#class').val(),
          level: $('#level').val(),
          gender: $('#gender').val(),
          covenant: $('#covenant').val(),
          covenantLevel: isNaN(covenantLevel) ? -1 : covenantLevel,
          armor: slotValues('.planner .armor .wrapper-protector select', ['-reinforce']),
          weapons: slotValues('.planner .weapons .wrapper-weapon select', ['-reinforce', '-upgrade']),
          weaponsParamVisible: paramVisible('.planner .weapons .wrapper-weapon select'),
          grip: $('#grip').is(':checked') ? DarkSouls.grip.TWO_HANDED : DarkSouls.grip.ONE_HANDED,
          isLowHP: flag('#low-hp'),
          isDragonHead: flag('#dragon-head'),
          isDragonTorso: flag('#dragon-torso'),
          rings: values('.planner .rings select'),
          spells: spells.values,
          spellBuffs: spells.buffs,
          arrows: values('.planner .arrows select'),
          bolts: values('.planner .bolts select'),
          items: items.values,
          itemBuffs: items.buffs,
          vitality: $('#vitality').val(),
          attunement: $('#attunement').val(),
          endurance: $('#endurance').val(),
          strength: $('#strength').val(),
          dexterity: $('#dexterity').val(),
          resistance: $('#resistance').val(),
          intelligence: $('#intelligence').val(),
          faith: $('#faith').val(),
          humanity: $('#humanity').val()
        }
      }
    },

    darksouls2: {
      required: [
        'class_', 'gender', 'level', 'covenant', 'armor', 'weapons', 'grip', 'rings', 'spells',
        'items', 'vigor', 'endurance', 'vitality', 'attunement', 'strength', 'dexterity',
        'adaptability', 'intelligence', 'faith'
      ],
      slots: [
        { selector: '.armor select', suffixes: [] },
        { selector: '.weapons .wrapper-weapon select', suffixes: ['-infusion'] },
        { selector: '.rings select', suffixes: [] }
      ],
      /* Dark Souls 2 has no model classes at all - its records already carry the numbers, which
         makes this the simplest of the three. Armour lives in one table per slot. */
      info: {
        poiseLabel: 'Poise (adds across pieces)',
        defenceLabel: 'Physical defence (adds across pieces)',
        defenceUnit: '',
        armor: function (id, slotId) {
          var rec = DarkSouls2[slotId] && DarkSouls2[slotId][id]
          return rec ? { weight: rec.weight, poise: rec.poise, defence: rec.physicalDEF } : null
        },
        weapon: function (id) {
          var rec = DarkSouls2.weapons[id]
          return rec ? { weight: rec.weight, req: rec.require || {} } : null
        },
        ring: function (id) {
          var rec = DarkSouls2.rings[id]
          return rec ? { weight: rec.weight, effects: rec.effects || [] } : null
        },
        spell: function (id) {
          var rec = DarkSouls2.spells[id]
          return rec ? { slots: rec.slots } : null
        }
      },
      lists: [
        { key: 'armor', selector: '.armor select', extras: [] },
        { key: 'weapons', selector: '.weapons .wrapper-weapon select', extras: ['-infusion'] },
        { key: 'rings', selector: '.rings select', extras: [] },
        { key: 'spells', selector: '.spells select', extras: [] },
        { key: 'items', selector: '.items select', extras: [] }
      ],
      serialize: function () {
        return {
          class_: $('#class').val(),
          gender: $('#gender').val(),
          level: $('#level').val(),
          covenant: $('#covenant').val(),
          armor: values('.armor select'),
          weapons: slotValues('.weapons .wrapper-weapon select', ['-infusion']),
          grip: $('#grip').is(':checked') ? DarkSouls2.GRIP_TWO_HANDED : DarkSouls2.GRIP_ONE_HANDED,
          rings: values('.rings select'),
          spells: values('.spells select'),
          items: values('.items select'),
          vigor: $('#vigor').val(),
          endurance: $('#endurance').val(),
          vitality: $('#vitality').val(),
          attunement: $('#attunement').val(),
          strength: $('#strength').val(),
          dexterity: $('#dexterity').val(),
          adaptability: $('#adaptability').val(),
          intelligence: $('#intelligence').val(),
          faith: $('#faith').val()
        }
      }
    },

    darksouls3: {
      required: [
        'class_', 'level', 'gender', 'covenant', 'armor', 'weapons', 'weaponsParamVisible',
        'grip', 'isPVP', 'isLowHP', 'isFullHP', 'useSkillLH1', 'useSkillRH1', 'rings', 'spells',
        'spellBuffs', 'arrows', 'bolts', 'items', 'itemBuffs', 'vigor', 'attunement',
        'endurance', 'vitality', 'strength', 'dexterity', 'intelligence', 'faith', 'luck',
        'hollowing'
      ],
      slots: [
        { selector: '.planner .armor select', suffixes: [] },
        { selector: '.planner .weapons .wrapper-weapon select', suffixes: ['-reinforce', '-infusion'] },
        { selector: '.planner .rings select', suffixes: [] }
      ],
      info: {
        poiseLabel: 'Poise from this piece alone (pieces combine multiplicatively)',
        defenceLabel: 'Physical absorption from this piece alone (pieces combine multiplicatively)',
        defenceUnit: '%',
        armor: function (id) {
          var p = new DarkSouls3.model.Protector(id)
          /* Both poise and absorption are stored as damage multipliers - the planner aggregates
             them as 100 * (1 - product of the four pieces), so a single piece's own contribution
             is 100 * (1 - its multiplier). Reading getPoise() raw gives ~0.9 and disagrees with
             the planner by an order of magnitude. */
          return {
            weight: p.getWeight(),
            poise: (1 - p.getPoise()) * 100,
            defence: (1 - p.getPhysicalABS()) * 100
          }
        },
        weapon: function (id) {
          var w = new DarkSouls3.model.Weapon(parseInt(id, 10), 0, 0)
          return { weight: w.getWeight(), req: w.getRequirements() }
        },
        ring: function (id) {
          var r = new DarkSouls3.model.Ring(id)
          return { weight: r.getWeight(), effects: r.getDescription() || [] }
        },
        spell: function (id) {
          var sp = new DarkSouls3.model.Spell(parseInt(id, 10))
          return { slots: sp.getSlotCount(), fp: sp.getFPUse(), req: sp.getRequirements() }
        }
      },
      lists: [
        { key: 'armor', selector: '.planner .armor select', extras: [] },
        { key: 'weapons', selector: '.planner .weapons .wrapper-weapon select', extras: ['-reinforce', '-infusion'] },
        { key: 'rings', selector: '.planner .rings select', extras: [] },
        { key: 'spells', selector: '.planner .spells select', extras: [], buffs: 'spellBuffs' },
        { key: 'items', selector: '.planner .items select', extras: [], buffs: 'itemBuffs' },
        { key: 'arrows', selector: '.planner .arrows select', extras: [] },
        { key: 'bolts', selector: '.planner .bolts select', extras: [] }
      ],
      serialize: function () {
        var spells = valuesWithBuffs('.planner .spells select')
        var items = valuesWithBuffs('.planner .items select')
        return {
          class_: $('#class').val(),
          level: $('#level').val(),
          gender: $('#gender').val(),
          covenant: $('#covenant').val(),
          armor: values('.planner .armor select'),
          weapons: slotValues('.planner .weapons .wrapper-weapon select', ['-reinforce', '-infusion']),
          weaponsParamVisible: paramVisible('.planner .weapons .wrapper-weapon select'),
          grip: $('#grip').is(':checked') ? DarkSouls3.grip.TWO_HANDED : DarkSouls3.grip.ONE_HANDED,
          isPVP: flag('#mode-pvp'),
          isLowHP: flag('#low-hp'),
          isFullHP: flag('#full-hp'),
          useSkillLH1: flag('#lh1-use-skill'),
          useSkillRH1: flag('#rh1-use-skill'),
          rings: values('.planner .rings select'),
          spells: spells.values,
          spellBuffs: spells.buffs,
          arrows: values('.planner .arrows select'),
          bolts: values('.planner .bolts select'),
          items: items.values,
          itemBuffs: items.buffs,
          vigor: $('#vigor').val(),
          attunement: $('#attunement').val(),
          endurance: $('#endurance').val(),
          vitality: $('#vitality').val(),
          strength: $('#strength').val(),
          dexterity: $('#dexterity').val(),
          intelligence: $('#intelligence').val(),
          faith: $('#faith').val(),
          luck: $('#luck').val(),
          hollowing: $('#hollowing').val()
        }
      }
    }
  }

  /* ------------------------------------------------------------- which game? */

  /* Which page is this? Runs at parse time, before <body> exists, so it cannot ask the DOM -
     the URL is all there is. index.html is the planner; anything else under a game directory is
     one of that game's calculators, which need a much smaller treatment. */
  function detectPage() {
    var match = window.location.pathname.match(/(darksouls[23]?)\/([^/]*)$/)
    var byPath = match && ADAPTERS[match[1]] ? match[1] : null
    var byGlobal = typeof plannerId !== 'undefined' && ADAPTERS[plannerId] ? plannerId : null
    var game = byGlobal || byPath
    if (!game) return null

    var file = (match && match[2]) || 'index.html'
    var planner = byGlobal !== null || file === '' || file === 'index.html'
    return {
      game: game,
      kind: planner ? 'planner' : 'calculator',
      name: file.replace(/\.html$/, '') || 'index'
    }
  }

  var page = detectPage()
  var game = page && page.game
  var adapter = game && ADAPTERS[game]
  if (!adapter) return

  var KEY = {
    autosave: 'soulsPlanner.autosave.' + game,
    builds: 'soulsPlanner.builds.' + game,
    currentId: 'soulsPlanner.currentId.' + game,
    calculator: 'soulsPlanner.calc.' + game + '.' + (page ? page.name : '')
  }

  /* --------------------------------------------------------- parked slots */

  /* A slot can be "parked": emptied so it stops counting towards weight and stats, while this
     module holds on to what was in it so the checkbox puts it straight back. Handy for "what do
     I weigh without leg armour" without having to hunt the piece down again.

     The planner has no concept of this, so parked values ride alongside the build rather than
     inside it - `b` stays byte-for-byte the format the planner's own applier expects. */

  var TOGGLE_TITLE = 'Uncheck to take this slot out of the calculation without losing it'
  var parked = {}
  var applying = false

  /* What this select looks like with nothing equipped. The planner already tells us: it gives
     select2 a placeholder whose id is exactly that value - "-1" for armour and rings, the Bare
     Fists id for weapons. Reading the options is the fallback for the mobile-native-select path,
     where select2 is never initialised. */
  function emptyValue($select) {
    var data = $select.data('select2')
    var placeholder = data && data.options && data.options.options.placeholder
    if (placeholder && placeholder.id !== undefined) return String(placeholder.id)
    if ($select.find('option[value="-1"]').length) return '-1'
    var first = $select.find('option').first()
    return first.length ? first.val() : '-1'
  }

  function optionText($select, value) {
    return $select.find('option').filter(function () { return this.value === value }).text()
  }

  function eachSlot(fn) {
    for (var g = 0; g < adapter.slots.length; g++) {
      var group = adapter.slots[g]
      /* jshint loopfunc:true */
      $(group.selector).each(
        (function (suffixes) {
          return function () { fn($(this), $(this).attr('id'), suffixes) }
        })(group.suffixes)
      )
    }
  }

  function currentParked() {
    var out = {}
    for (var id in parked) {
      if (parked.hasOwnProperty(id)) out[id] = parked[id]
    }
    return out
  }

  /* The checkbox and the label that draws it - see buildToggles. */
  function toggleUi(id) {
    return $('#sp-slot-' + id).add('label[for="sp-slot-' + id + '"]')
  }

  function markParked(id) {
    var $select = $('#' + id)
    var values = parked[id]
    $select.closest('.sp-slot').toggleClass('sp-slot--parked', !!values)
    if (values) {
      toggleUi(id).attr('title', 'Parked: ' + (optionText($select, values[0]) || 'this slot') + ' - re-check to put it back')
    } else {
      toggleUi(id).attr('title', TOGGLE_TITLE)
    }
  }

  function parkSlot(id, suffixes) {
    var $select = $('#' + id)
    var values = [$select.val()]
    for (var i = 0; i < suffixes.length; i++) values.push($('#' + id + suffixes[i]).val())
    parked[id] = values

    applying = true
    $select.val(emptyValue($select)).trigger('change.select2').trigger('change')
    applying = false
    markParked(id)
  }

  function unparkSlot(id, suffixes) {
    var values = parked[id]
    delete parked[id]
    if (!values) return markParked(id)

    applying = true
    var $select = $('#' + id)
    $select.val(values[0]).trigger('change.select2').trigger('change')

    /* Putting the weapon back rebuilds its reinforce and infusion lists from scratch, so those
       are restored afterwards - and in reverse order, which is the order the planner's own
       applier uses (infusion, or DS1's upgrade, before reinforce). */
    for (var i = suffixes.length - 1; i >= 0; i--) {
      var $extra = $('#' + id + suffixes[i])
      var wanted = values[i + 1]
      if (wanted === undefined || !$extra.length) continue
      if (!$extra.find('option').filter(function () { return this.value === wanted }).length) continue
      $extra.val(wanted).trigger('change.select2').trigger('change')
    }
    applying = false
    markParked(id)
  }

  function buildToggles() {
    eachSlot(function ($select, id, suffixes) {
      var cell = $select.closest('.wrapper-protector, .wrapper-weapon')
      var container = cell.length ? cell : $select.parent()
      var toggleId = 'sp-slot-' + id

      /* The cell has to keep the level it already had: the armour and weapon wrappers sit inline
         beside a label and a reinforce dropdown, so turning them into a block-level flex container
         drops them onto their own line, while a ring's row is block-level and would shrink to its
         contents as inline-flex. Ask the element which it is rather than hardcoding it per game. */
      var inline = (window.getComputedStyle(container[0]).display || '').indexOf('inline') === 0
      container.addClass('sp-slot').addClass(inline ? 'sp-slot--inline' : 'sp-slot--block')

      $('<input type="checkbox" class="sp-slot-toggle" checked tabindex="-1" />')
        .attr('id', toggleId)
        .prependTo(container)
        .on('change', function () {
          if ($(this).is(':checked')) unparkSlot(id, suffixes)
          else parkSlot(id, suffixes)
        })

      /* The planner parks real checkboxes off-screen and draws them with a label::before glyph,
         so the box you actually see and click is this label, not the input. */
      $('<label class="sp-slot-label"></label>')
        .attr('for', toggleId)
        .attr('title', TOGGLE_TITLE)
        .insertAfter('#' + toggleId)
    })
  }

  /* The restored build already has these slots empty, so this only has to remember what was in
     them and untick the boxes. */
  function applyParked(map) {
    for (var id in map) {
      if (!map.hasOwnProperty(id) || !$('#sp-slot-' + id).length) continue
      parked[id] = map[id]
      $('#sp-slot-' + id).prop('checked', false)
      markParked(id)
    }
  }

  /* -------------------------------------------------------------- storage */

  /* Every access is guarded: Chrome throws on localStorage over file://, and the planner has to
     keep working there - only persistence degrades, sharing still does. Same defensive shape as
     the Settings object in public/scripts/release/head.min.js. */
  var store = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem(key)
        return raw === null ? fallback : JSON.parse(raw)
      } catch (e) {
        return fallback
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
        return true
      } catch (e) {
        return false
      }
    },
    remove: function (key) {
      try {
        window.localStorage.removeItem(key)
      } catch (e) {}
    }
  }

  /* ---------------------------------------------------------------- codec */

  function wrap(build, parkedMap) {
    var payload = { v: FORMAT, g: game, b: build }
    var d = parkedMap || {}
    for (var id in d) {
      if (d.hasOwnProperty(id)) { payload.d = d; break }
    }
    return payload
  }

  /* Optional and forgiving: links made before slots could be parked simply have no `d`, and a
     malformed one costs you the parked slots rather than the whole build. */
  function parkedOf(payload) {
    var d = payload && payload.d
    if (!d || typeof d !== 'object') return {}
    var out = {}
    for (var id in d) {
      if (d.hasOwnProperty(id) && Object.prototype.toString.call(d[id]) === '[object Array]') {
        out[id] = d[id]
      }
    }
    return out
  }

  function unwrapState(payload) {
    return { build: unwrap(payload), parked: parkedOf(payload) }
  }

  /* Validate rather than patch. The planner's applier does not null-guard - a missing key means a
     thrown TypeError inside its ready handler and a half-dead page - so anything not provably
     complete and provably for this game is rejected outright and the planner keeps its defaults. */
  function unwrap(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('payload is not an object')
    if (payload.v !== FORMAT) throw new Error('unsupported format version ' + payload.v)
    if (payload.g !== game) throw new Error('build is for ' + payload.g + ', this page is ' + game)
    var build = payload.b
    if (!build || typeof build !== 'object') throw new Error('build is not an object')
    for (var i = 0; i < adapter.required.length; i++) {
      if (!(adapter.required[i] in build)) throw new Error('build is missing "' + adapter.required[i] + '"')
    }
    return build
  }

  function encode(state) {
    return LZString.compressToEncodedURIComponent(JSON.stringify(wrap(state.build, state.parked)))
  }

  function decode(token) {
    var json = null
    try {
      /* lz-string throws rather than returning null on malformed input. */
      json = LZString.decompressFromEncodedURIComponent(token)
    } catch (e) {
      json = null
    }
    if (!json) throw new Error('link is not valid compressed data')

    var payload
    try {
      payload = JSON.parse(json)
    } catch (e) {
      throw new Error('link does not decode to valid JSON')
    }
    return unwrapState(payload)
  }

  function baseUrl() {
    return window.location.href.split('#')[0]
  }

  function shareUrl(state) {
    return baseUrl() + HASH_PREFIX + encode(state)
  }

  /* ------------------------------------------------------------- calculators */

  /* The calculator pages are far simpler than the planner: no savedBuild applier, no derived
     format, just a handful of controls with stable ids. So their state is a plain {id: value}
     map, stored per page and mirrored into a #c= hash so a setup can be shared like a build.

     They also had no connection whatsoever to the builds you plan next door, which is the more
     annoying half - you retyped your stats by hand every time. They can now pull them across. */

  var CALC_HASH_PREFIX = '#c='

  function calcControls() {
    return $('.calculator').find('select, input').filter(function () {
      return this.id && !this.readOnly && this.type !== 'button'
    })
  }

  function readCalculator() {
    var state = {}
    calcControls().each(function () {
      state[this.id] = this.type === 'checkbox' ? ($(this).prop('checked') ? 1 : 0) : $(this).val()
    })
    return state
  }

  function applyCalculator(state) {
    calcControls().each(function () {
      if (!state.hasOwnProperty(this.id)) return
      var value = state[this.id]
      if (this.type === 'checkbox') {
        $(this).prop('checked', !!Number(value)).trigger('change')
      } else {
        $(this).val(value).trigger('change.select2').trigger('change')
      }
    })
  }

  function encodeCalculator(state) {
    return LZString.compressToEncodedURIComponent(
      JSON.stringify({ v: FORMAT, g: game, p: page.name, s: state })
    )
  }

  function decodeCalculator(token) {
    var json = null
    try {
      json = LZString.decompressFromEncodedURIComponent(token)
    } catch (e) {
      json = null
    }
    if (!json) throw new Error('link is not valid compressed data')

    var payload = JSON.parse(json)
    if (payload.v !== FORMAT) throw new Error('unsupported format version ' + payload.v)
    if (payload.g !== game || payload.p !== page.name) {
      throw new Error('link is for ' + payload.g + '/' + payload.p + ', this is ' + game + '/' + page.name)
    }
    if (!payload.s || typeof payload.s !== 'object') throw new Error('link carries no settings')
    return payload.s
  }

  /* Stat fields the planner and this particular calculator have in common - which is the whole
     trick behind pulling them across, since both use the planner's own field names. */
  function sharedStatFields(build) {
    var shared = []
    calcControls().each(function () {
      if (build.hasOwnProperty(this.id)) shared.push(this.id)
    })
    return shared
  }

  function buildSources() {
    var sources = []
    var autosave = store.get(KEY.autosave, null)
    try {
      if (autosave) sources.push({ id: '__current', name: 'Current build', build: unwrap(autosave) })
    } catch (e) {
      /* an unusable autosave simply is not offered */
    }
    var builds = loadBuilds()
    for (var i = 0; i < builds.length; i++) {
      sources.push({ id: builds[i].id, name: builds[i].name, build: builds[i].build })
    }
    return sources
  }

  function buildStatPicker() {
    var host = $('.calculator .attributes')
    if (!host.length) return

    var sources = buildSources()
    if (!sources.length) return
    if (!sharedStatFields(sources[0].build).length) return

    var picker = $('<div class="sp-from-build"></div>')
    var select = $('<select></select>').append('<option value="">Use stats from…</option>')
    for (var i = 0; i < sources.length; i++) {
      select.append($('<option></option>').attr('value', sources[i].id).text(sources[i].name))
    }

    select.on('change', function () {
      var id = $(this).val()
      $(this).val('')
      if (!id) return
      var source = null
      for (var s = 0; s < sources.length; s++) if (sources[s].id === id) source = sources[s]
      if (!source) return

      var fields = sharedStatFields(source.build)
      for (var f = 0; f < fields.length; f++) {
        $('#' + fields[f]).val(source.build[fields[f]]).trigger('change')
      }
      toast(fields.length ? 'Stats from ' + source.name : 'Nothing to copy across')
    })

    picker.append(select).insertAfter(host)
  }

  function initCalculator() {
    var timer = null

    function persist() {
      var state = readCalculator()
      store.set(KEY.calculator, { v: FORMAT, g: game, p: page.name, s: state })
      try {
        window.history.replaceState(null, '', CALC_HASH_PREFIX + encodeCalculator(state))
      } catch (e) {
        /* file:// forbids replaceState; storage still works */
      }
    }

    $(document).ready(function () {
      if (!$('.calculator').length) return

      /* Unlike the planner there is no applier to beat to the punch: the calculator has already
         populated its own dropdowns by now, so this is the right moment to put values back. */
      try {
        var restored = null
        var hash = window.location.hash

        if (hash.indexOf(CALC_HASH_PREFIX) === 0) {
          try {
            restored = decodeCalculator(hash.slice(CALC_HASH_PREFIX.length))
          } catch (linkError) {
            /* Same rule as the planner: a mangled link must not cost you the settings you had. */
            warn('ignoring link: ' + linkError.message)
          }
        }

        if (!restored) {
          var saved = store.get(KEY.calculator, null)
          if (saved && saved.v === FORMAT && saved.g === game && saved.p === page.name && saved.s) {
            restored = saved.s
          }
        }

        if (restored) applyCalculator(restored)
      } catch (error) {
        warn('ignoring saved calculator settings: ' + error.message)
      }

      buildStatPicker()

      $('.calculator').on('change', 'select, input', function () {
        window.clearTimeout(timer)
        timer = window.setTimeout(persist, DEBOUNCE_MS)
      })

      persist()
    })

    window.SoulsPersist = {
      game: game,
      page: page,
      toast: toast,
      current: readCalculator,
      shareUrl: function () {
        return baseUrl() + CALC_HASH_PREFIX + encodeCalculator(readCalculator())
      }
    }
  }

  if (page.kind === 'calculator') {
    initCalculator()
    return
  }

  /* -------------------------------------------------- restore (before ready) */

  var restoredFrom = null
  var restoredParked = {}

  function warn(message) {
    if (window.console && console.warn) console.warn('[souls-persist] ' + message)
  }

  try {
    var restored = null
    var hash = window.location.hash

    if (hash.indexOf(HASH_PREFIX) === 0) {
      try {
        restored = decode(hash.slice(HASH_PREFIX.length))
        restoredFrom = 'link'
      } catch (linkError) {
        /* Fall through to the autosave rather than letting a mangled link cost you the build
           you were working on. */
        warn('ignoring link: ' + linkError.message)
      }
    }

    if (!restored) {
      var saved = store.get(KEY.autosave, null)
      if (saved) {
        restored = unwrapState(saved)
        restoredFrom = 'autosave'
      }
    }

    if (restored) {
      window.savedBuild = restored.build
      restoredParked = restored.parked
    }
  } catch (error) {
    /* Deliberately non-fatal: anything unusable here just gives you a clean planner. */
    window.savedBuild = undefined
    restoredFrom = null
    restoredParked = {}
    warn('ignoring saved build: ' + error.message)
  }

  /* --------------------------------------------------------- current state */

  function currentBuild() {
    return adapter.serialize()
  }

  function currentState() {
    return { build: currentBuild(), parked: currentParked() }
  }

  var writeHash = true
  var suspended = false
  var timer = null

  function persistNow() {
    if (suspended || isCompareFrame) return
    var state = currentState()
    pushHistory(state)
    store.set(KEY.autosave, wrap(state.build, state.parked))
    updateStatus()
    if (!writeHash) return
    try {
      window.history.replaceState(null, '', HASH_PREFIX + encode(state))
    } catch (e) {
      /* file:// forbids replaceState. Stop retrying; the share button still builds URLs. */
      writeHash = false
    }
  }

  function schedulePersist() {
    /* applyStateToDom fires a lot of changes on purpose; it persists once itself at the end. */
    if (applying) return
    window.clearTimeout(timer)
    timer = window.setTimeout(persistNow, DEBOUNCE_MS)
  }

  /* ------------------------------------------------------------ named builds */

  function loadBuilds() {
    var stored = store.get(KEY.builds, null)
    if (!stored || stored.v !== FORMAT || stored.g !== game || !stored.builds) return []
    var valid = []
    for (var i = 0; i < stored.builds.length; i++) {
      var entry = stored.builds[i]
      try {
        unwrap(wrap(entry.build))
        valid.push(entry)
      } catch (e) {
        /* drop entries that would break the planner rather than let them through */
      }
    }
    return valid
  }

  function saveBuilds(builds) {
    return store.set(KEY.builds, { v: FORMAT, g: game, builds: builds })
  }

  function newId() {
    return String(Date.now()) + String(Math.floor(Math.random() * 1000))
  }

  function entryFor(name, state) {
    return {
      id: newId(),
      name: name,
      level: state.build.level,
      updatedAt: new Date().toISOString(),
      build: state.build,
      parked: state.parked,
      notes: '',
      tags: []
    }
  }

  function stateOf(entry) {
    return { build: entry.build, parked: parkedOf({ d: entry.parked }) }
  }

  function findIndex(builds, id) {
    for (var i = 0; i < builds.length; i++) {
      if (builds[i].id === id) return i
    }
    return -1
  }

  function saveCurrent(forceNew) {
    var builds = loadBuilds()
    var state = currentState()
    var currentId = store.get(KEY.currentId, null)
    var index = forceNew ? -1 : findIndex(builds, currentId)

    if (index === -1) {
      var name = window.prompt('Name this build:', suggestedName(state.build))
      if (name === null) return null
      name = name.replace(/^\s+|\s+$/g, '')
      if (!name) return null
      var entry = entryFor(name, state)
      builds.unshift(entry)
      store.set(KEY.currentId, entry.id)
    } else {
      builds[index].build = state.build
      builds[index].parked = state.parked
      builds[index].level = state.build.level
      builds[index].updatedAt = new Date().toISOString()
    }

    if (!saveBuilds(builds)) {
      toast('Could not save - storage unavailable')
      return null
    }
    toast(index === -1 ? 'Build saved' : 'Build updated')
    updateStatus()
    return builds[index === -1 ? 0 : index]
  }

  function suggestedName(build) {
    var className = ''
    try {
      var games = { darksouls: window.DarkSouls, darksouls2: window.DarkSouls2, darksouls3: window.DarkSouls3 }
      className = games[game].classes[build.class_].name
    } catch (e) {}
    return (className ? className + ' ' : '') + 'SL' + build.level
  }

  function applyBuild(state) {
    /* Now that a state can be put straight into the live DOM, loading a build no longer costs a
       page reload - and it lands in the undo timeline like any other change. */
    applyStateToDom(state)
    window.clearTimeout(timer)
    persistNow()
    updateStatus()
    renderRows()
    toast('Build loaded')
  }

  /* ------------------------------------------------------------------- UI */

  function toast(message) {
    var el = $('.sp-toast')
    if (!el.length) el = $('<div class="sp-toast"></div>').appendTo(document.body)
    el.text(message).addClass('sp-toast--visible')
    window.clearTimeout(toast.timer)
    toast.timer = window.setTimeout(function () {
      el.removeClass('sp-toast--visible')
    }, 1800)
  }

  function copyToClipboard(text) {
    if (window.navigator.clipboard && window.isSecureContext) {
      window.navigator.clipboard.writeText(text).then(
        function () { toast('Share link copied') },
        function () { legacyCopy(text) }
      )
      return
    }
    legacyCopy(text)
  }

  function legacyCopy(text) {
    /* clipboard API needs a secure context, which file:// and plain http:// are not. */
    var field = $('<textarea class="sp-clipboard"></textarea>').val(text).appendTo(document.body)
    field[0].select()
    var copied = false
    try {
      copied = document.execCommand('copy')
    } catch (e) {}
    field.remove()
    toast(copied ? 'Share link copied' : 'Copy failed - link is in the address bar')
  }

  /* --------------------------------------------------------- list, filtered */

  var KEY_SORT = 'soulsPlanner.drawerSort.' + game
  var tagFilter = null

  function searchTerm() {
    return ($('#builds-drawer .sp-search').val() || '').toLowerCase().replace(/^\s+|\s+$/g, '')
  }

  function entryTags(entry) {
    return Object.prototype.toString.call(entry.tags) === '[object Array]' ? entry.tags : []
  }

  function matchesSearch(entry, term) {
    if (!term) return true
    var haystack = [entry.name, entry.notes || '', entryTags(entry).join(' ')].join(' ').toLowerCase()
    return haystack.indexOf(term) !== -1
  }

  function sortedBuilds(builds) {
    var mode = store.get(KEY_SORT, 'recent')
    var copy = builds.slice()
    copy.sort(function (a, b) {
      if (mode === 'name') return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1
      if (mode === 'level') return (parseInt(b.level, 10) || 0) - (parseInt(a.level, 10) || 0)
      return a.updatedAt < b.updatedAt ? 1 : -1
    })
    return copy
  }

  function allTags(builds) {
    var seen = {}
    var out = []
    for (var i = 0; i < builds.length; i++) {
      var tags = entryTags(builds[i])
      for (var t = 0; t < tags.length; t++) {
        if (seen[tags[t]]) continue
        seen[tags[t]] = true
        out.push(tags[t])
      }
    }
    return out.sort()
  }

  function renderTagStrip(builds) {
    var strip = $('#builds-drawer .sp-tags').empty()
    var tags = allTags(builds)
    strip.toggle(tags.length > 0)
    for (var i = 0; i < tags.length; i++) {
      $('<button type="button" class="sp-tag"></button>')
        .text(tags[i])
        .attr('data-tag', tags[i])
        .toggleClass('sp-tag--on', tagFilter === tags[i])
        .appendTo(strip)
    }
  }

  function buildRow(entry, currentId) {
    var row = $('<li class="sp-build"></li>').attr('data-id', entry.id)
    if (entry.id === currentId) row.addClass('sp-build--current')

    var top = $('<div class="sp-build__top"></div>').appendTo(row)
    $('<input type="checkbox" class="sp-pick" />').appendTo(top)
    $('<span class="sp-build__name"></span>').text(entry.name).appendTo(top)
    $('<span class="sp-build__level"></span>').text('SL ' + entry.level).appendTo(top)

    $('<div class="sp-build__meta"></div>').text(entry.updatedAt.slice(0, 10)).appendTo(row)

    if (entry.notes) $('<div class="sp-build__notes"></div>').text(entry.notes).appendTo(row)

    var tags = entryTags(entry)
    if (tags.length) {
      var chips = $('<div class="sp-build__tags"></div>').appendTo(row)
      for (var t = 0; t < tags.length; t++) {
        $('<span class="sp-chip"></span>').text(tags[t]).appendTo(chips)
      }
    }

    $('<div class="sp-build__actions"></div>')
      .append('<button class="sp-action" data-action="load">Load</button>')
      .append('<button class="sp-action" data-action="share">Copy link</button>')
      .append('<button class="sp-action" data-action="duplicate">Duplicate</button>')
      .append('<button class="sp-action" data-action="edit">Edit</button>')
      .append('<button class="sp-action" data-action="delete">Delete</button>')
      .appendTo(row)

    return row
  }

  /* One inline editor for name, notes and tags, instead of a chain of window.prompt calls. */
  function openEditor(row, entry) {
    if (row.find('.sp-editor').length) return

    var editor = $('<div class="sp-editor"></div>')
    var name = $('<input type="text" class="sp-editor__name" />').val(entry.name)
    var notes = $('<textarea class="sp-editor__notes" rows="3"></textarea>')
      .val(entry.notes || '')
      .attr('placeholder', 'What is this build for?')
    var tags = $('<input type="text" class="sp-editor__tags" />')
      .val(entryTags(entry).join(', '))
      .attr('placeholder', 'tags, comma separated')

    var actions = $('<div class="sp-editor__actions"></div>')
      .append('<button class="sp-action" data-action="save-edit">Save</button>')
      .append('<button class="sp-action" data-action="cancel-edit">Cancel</button>')

    editor.append(name).append(notes).append(tags).append(actions)
    row.append(editor)
    name.focus()
  }

  function renderRows() {
    var all = loadBuilds()
    var currentId = store.get(KEY.currentId, null)
    var list = $('#builds-drawer .sp-builds').empty()
    var term = searchTerm()

    renderTagStrip(all)

    var builds = sortedBuilds(all).filter(function (entry) {
      if (tagFilter && entryTags(entry).indexOf(tagFilter) === -1) return false
      return matchesSearch(entry, term)
    })

    $('#builds-drawer .sp-empty')
      .toggle(builds.length === 0)
      .text(
        all.length === 0
          ? 'No saved builds yet. Use the save button to keep this one.'
          : 'Nothing matches that filter.'
      )

    /* The build on screen is comparable too - most of the time "how does this differ from the one
       I saved earlier" is the actual question. It is never filtered out. */
    var live = $('<li class="sp-build sp-build--live"></li>').attr('data-id', LIVE_ID)
    var liveTop = $('<div class="sp-build__top"></div>').appendTo(live)
    $('<input type="checkbox" class="sp-pick" />').prependTo(liveTop)
    $('<span class="sp-build__name"></span>').text('Current build').appendTo(liveTop)
    $('<span class="sp-build__level"></span>').text('SL ' + currentBuild().level).appendTo(liveTop)
    list.append(live)

    for (var i = 0; i < builds.length; i++) list.append(buildRow(builds[i], currentId))

    syncCompareButton()
  }

  var LIVE_ID = '__current'

  function pickedEntries() {
    var picked = []
    $('#builds-drawer .sp-pick:checked').each(function () {
      var id = $(this).closest('.sp-build').attr('data-id')
      if (id === LIVE_ID) {
        picked.push({ name: 'Current build', state: currentState() })
        return
      }
      var builds = loadBuilds()
      var index = findIndex(builds, id)
      if (index !== -1) picked.push({ name: builds[index].name, state: stateOf(builds[index]) })
    })
    return picked
  }

  function syncCompareButton() {
    var count = $('#builds-drawer .sp-pick:checked').length
    $('#builds-drawer__compare')
      .prop('disabled', count !== 2)
      .text(count === 2 ? 'Compare' : 'Compare (pick 2)')
  }

  function exportBuilds() {
    var payload = JSON.stringify({ v: FORMAT, g: game, builds: loadBuilds() }, null, 2)
    var blob = new Blob([payload], { type: 'application/json' })
    var url = window.URL.createObjectURL(blob)
    var link = $('<a></a>').attr({ href: url, download: 'souls-planner-' + game + '-builds.json' })
    $(document.body).append(link)
    link[0].click()
    link.remove()
    window.URL.revokeObjectURL(url)
  }

  function importBuilds(file) {
    var reader = new FileReader()
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result)
        if (parsed.g !== game) throw new Error('file holds ' + parsed.g + ' builds')
        if (!parsed.builds || !parsed.builds.length) throw new Error('file holds no builds')
        var merged = loadBuilds()
        var added = 0
        for (var i = 0; i < parsed.builds.length; i++) {
          var entry = parsed.builds[i]
          unwrap(wrap(entry.build))
          if (findIndex(merged, entry.id) === -1) {
            merged.push(entry)
            added++
          }
        }
        saveBuilds(merged)
        renderRows()
        toast(added + ' build' + (added === 1 ? '' : 's') + ' imported')
      } catch (error) {
        toast('Import failed: ' + error.message)
      }
    }
    reader.readAsText(file)
  }

  /* --------------------------------------------------------------- undo / redo */

  /* Restoring a build normally means reloading the page, because the planner only applies
     savedBuild inside its ready handler. That is far too heavy for Ctrl+Z, so this puts a state
     back into the live DOM instead, using the same approach parkSlot/unparkSlot already rely on.
     Three things make it work:

       - Class, gender, covenant and the attributes are set SILENTLY - value plus a select2 UI
         nudge, never a real change event. Firing change on #class runs the planner's class
         handler, which resets every attribute to that class's base values and would undo the
         attributes we are in the middle of restoring. The bundle's own applier avoids it for
         exactly this reason.
       - Weapon slots do need a real change, because that is what makes the planner rebuild that
         slot's reinforce and infusion lists; the extras are then set in reverse order, matching
         the order the planner's own applier uses.
       - It finishes by provoking one recalculation. The planner's recalc is a closure we cannot
         call, so the only way to ask for it is to fire a change the planner is listening to.
  */

  var TOGGLE_IDS = {
    grip: 'grip',
    isPVP: 'mode-pvp',
    isLowHP: 'low-hp',
    isFullHP: 'full-hp',
    useSkillLH1: 'lh1-use-skill',
    useSkillRH1: 'rh1-use-skill',
    isDragonHead: 'dragon-head',
    isDragonTorso: 'dragon-torso'
  }

  function setSilently(selector, value) {
    if (value === undefined || value === null) return
    var $el = $(selector)
    if (!$el.length) return
    $el.val(value).trigger('change.select2')
  }

  function applyStateToDom(state) {
    var build = state.build
    applying = true

    for (var key in SCALAR_SELECT) {
      if (SCALAR_SELECT.hasOwnProperty(key)) setSilently(SCALAR_SELECT[key], build[key])
    }

    $('.planner .attributes input, #hollowing, #humanity').each(function () {
      if (!build.hasOwnProperty(this.id)) return
      $(this).val(build[this.id]).data('previous-value', build[this.id])
    })

    var lists = adapter.lists || []
    for (var l = 0; l < lists.length; l++) {
      var list = resolveListIds(lists[l])
      var values = splitField(build, list.key)
      var buffs = list.buffs ? splitField(build, list.buffs) : null
      var stride = 1 + list.extras.length

      for (var i = 0; i < list.ids.length; i++) {
        var id = list.ids[i]
        var $select = $('#' + id)
        var value = values[i * stride]
        if (value === undefined) continue

        if (list.extras.length) {
          /* Real change: the planner rebuilds this slot's extra dropdowns from the new item. */
          $select.val(value).trigger('change.select2').trigger('change')
          for (var e = list.extras.length - 1; e >= 0; e--) {
            var wanted = values[i * stride + 1 + e]
            var $extra = $('#' + id + list.extras[e])
            if (wanted === undefined || !$extra.length) continue
            if (!$extra.find('option').filter(function () { return this.value === wanted }).length) continue
            $extra.val(wanted).trigger('change.select2').trigger('change')
          }
        } else {
          setSilently('#' + id, value)
        }

        if (buffs) {
          var on = Number(buffs[i]) === 1
          var $buff = $select.parent().parent().children('.buff')
          if ($buff.length) {
            /* Turning a buff on has to be a real change - that is what tells the planner which
               buff is the active one when several could apply. */
            if (on) $buff.prop('checked', true).trigger('change')
            else $buff.prop('checked', false)
          }
        }
      }
    }

    for (var flag in TOGGLE_IDS) {
      if (!TOGGLE_IDS.hasOwnProperty(flag) || !build.hasOwnProperty(flag)) continue
      var $toggle = $('#' + TOGGLE_IDS[flag])
      if ($toggle.length) $toggle.prop('checked', Number(build[flag]) === 1).trigger('change')
    }

    if (build.weaponsParamVisible) {
      var panels = String(build.weaponsParamVisible).split(';')
      $(adapter.slots[1].selector).each(function (index) {
        var name = panels[index]
        var wrapper = $(this).parent().parent()
        wrapper.children('.equipment-params').hide().attr('data-visible', false)
        if (name) wrapper.children('.' + name).attr('data-visible', true).show()
      })
    }

    /* Parked slots: the build already has them empty, so this only restores the memory of what
       was in them and the state of their checkboxes. */
    parked = {}
    var map = state.parked || {}
    eachSlot(function ($select, id) {
      var values = map[id]
      if (values) parked[id] = values
      $('#sp-slot-' + id).prop('checked', !values)
      markParked(id)
    })

    applying = false

    /* Provoke the recalculation. */
    $('.planner .attributes input').first().trigger('change')
  }

  var timeline = []
  var timelineAt = -1
  var TIMELINE_LIMIT = 50
  var restoring = false

  function pushHistory(state) {
    if (restoring) return
    var json = JSON.stringify(state)
    if (timelineAt >= 0 && JSON.stringify(timeline[timelineAt]) === json) return
    timeline = timeline.slice(0, timelineAt + 1)
    timeline.push(JSON.parse(json))
    if (timeline.length > TIMELINE_LIMIT) timeline.shift()
    timelineAt = timeline.length - 1
  }

  function stepHistory(delta) {
    var target = timelineAt + delta
    if (target < 0 || target >= timeline.length) {
      toast(delta < 0 ? 'Nothing to undo' : 'Nothing to redo')
      return
    }
    timelineAt = target
    restoring = true
    try {
      applyStateToDom(timeline[timelineAt])
      window.clearTimeout(timer)
      persistNow()
    } finally {
      restoring = false
    }
    toast(delta < 0 ? 'Undo' : 'Redo')
  }

  /* ------------------------------------------------------- item info in dropdowns */

  /* Every dropdown used to show a bare name, so you equipped a chest piece to find out it weighed
     24kg, and a ring's effect only appeared once it was on. The bundles carry all of it - weight,
     poise, absorption, requirements, and for rings the actual effect text - so it can be shown
     while you are still choosing.
     
     Deliberately absent: weapon AR. The planner derives it with a correction step for rings and
     buffs that lives in a closure we cannot reach, so any number computed here would quietly
     disagree with the one shown once the weapon is equipped. Better to say nothing than to
     contradict the panel next to it. */

  var REQUIREMENT_KEYS = ['strength', 'dexterity', 'intelligence', 'faith']

  function totalStat(name) {
    /* Prefer the total, which includes ring and buff bonuses, over the raw attribute. */
    var $total = $('#' + name + '-total')
    var raw = ($total.length ? $total.text() : '') || $('#' + name).val()
    return parseInt(raw, 10) || 0
  }

  function askInfo(kind, value, slotId) {
    var info = adapter.info
    if (!info || !info[kind]) return null
    try {
      return info[kind](value, slotId) || null
    } catch (e) {
      /* A data quirk should cost you the extra columns, never the dropdown. */
      return null
    }
  }

  function numberCell(value, digits, title, suffix) {
    return $('<span class="sp-opt__n"></span>')
      .attr('title', title)
      .text(value === undefined || value === null ? '–' : value.toFixed(digits) + (suffix || ''))
  }

  function requirementCell(req) {
    var cell = $('<span class="sp-opt__req"></span>').attr('title', 'Requirements: STR / DEX / INT / FTH')
    for (var i = 0; i < REQUIREMENT_KEYS.length; i++) {
      var key = REQUIREMENT_KEYS[i]
      var need = req && req[key] ? req[key] : 0
      var part = $('<span></span>').text(need ? need : '–')
      if (need && totalStat(key) < need) part.addClass('sp-opt__req--short')
      cell.append(part)
      if (i < REQUIREMENT_KEYS.length - 1) cell.append(document.createTextNode('/'))
    }
    return cell
  }

  function row(text) {
    var wrap = $('<span class="sp-opt"></span>')
    $('<span class="sp-opt__name"></span>').text(text).appendTo(wrap)
    return wrap
  }

  var RENDERERS = {
    armor: function (option, slotId) {
      var info = askInfo('armor', option.id, slotId)
      if (!info) return null
      var wrap = row(option.text)
      numberCell(info.weight, 1, 'Weight').appendTo(wrap)
      numberCell(info.poise, 1, adapter.info.poiseLabel).appendTo(wrap)
      numberCell(info.defence, 1, adapter.info.defenceLabel, adapter.info.defenceUnit).appendTo(wrap)
      return wrap
    },
    weapon: function (option) {
      var info = askInfo('weapon', option.id)
      if (!info) return null
      var wrap = row(option.text)
      numberCell(info.weight, 1, 'Weight').appendTo(wrap)
      requirementCell(info.req).appendTo(wrap)
      return wrap
    },
    ring: function (option) {
      var info = askInfo('ring', option.id)
      if (!info) return null
      var wrap = row(option.text)
      if (info.weight !== undefined && info.weight !== null) {
        numberCell(info.weight, 1, 'Weight').appendTo(wrap)
      }
      if (info.effects && info.effects.length) {
        $('<span class="sp-opt__note"></span>').text(info.effects.join(' ')).appendTo(wrap)
      }
      return wrap
    },
    spell: function (option) {
      var info = askInfo('spell', option.id)
      if (!info) return null
      var wrap = row(option.text)
      if (info.fp !== undefined) numberCell(info.fp, 0, 'FP cost').appendTo(wrap)
      if (info.slots !== undefined) numberCell(info.slots, 0, 'Attunement slots').appendTo(wrap)
      if (info.req) requirementCell(info.req).appendTo(wrap)
      return wrap
    }
  }

  function templateFor(kind, slotId) {
    return function (option) {
      /* Placeholders and the "nothing equipped" entries have no item behind them. */
      if (!option.id || option.id === '-1' || option.loading) return option.text
      var rendered = RENDERERS[kind](option, slotId)
      return rendered || option.text
    }
  }

  /* Re-initialising is the only way to add a template to a select2 that is already up. The
     planner's own options are read back off the instance rather than guessed, so allowClear and
     each family's placeholder survive untouched. */
  function retemplate($select, kind) {
    var instance = $select.data('select2')
    if (!instance) return
    var options = $.extend({}, instance.options.options)
    options.templateResult = templateFor(kind, $select.attr('id'))
    $select.select2('destroy')
    $select.select2(options)
  }

  function decorateDropdowns() {
    /* No select2 means the mobile native-select path, where there is nothing to template. */
    if (!$.isSelect2Supported || !$.isSelect2Supported()) return
    if (!adapter.info) return

    var groups = [
      { kind: 'armor', selector: adapter.lists[0].selector },
      { kind: 'weapon', selector: adapter.lists[1].selector },
      { kind: 'ring', selector: adapter.lists[2].selector },
      { kind: 'spell', selector: '.planner .spells select, .spells select' }
    ]

    for (var g = 0; g < groups.length; g++) {
      /* jshint loopfunc:true */
      ;(function (kind) {
        $(groups[g].selector).each(function () {
          retemplate($(this), kind)
        })
      })(groups[g].kind)
    }
  }

  /* ------------------------------------------------------------------- status */

  /* "Saved or not" is more useful as a number than as a dot. Because the diff engine already
     knows how to compare two builds, the status line can say exactly how many things you have
     changed since you saved - and clicking it shows you which ones, live build against its own
     saved version. */

  var baseTitle = document.title

  function savedEntry() {
    var id = store.get(KEY.currentId, null)
    if (!id) return null
    var builds = loadBuilds()
    var index = findIndex(builds, id)
    return index === -1 ? null : builds[index]
  }

  function relativeTime(iso) {
    var then = new Date(iso).getTime()
    if (isNaN(then)) return ''
    var seconds = Math.round((nowMs() - then) / 1000)
    if (seconds < 60) return 'just now'
    var minutes = Math.round(seconds / 60)
    if (minutes < 60) return minutes + ' min ago'
    var hours = Math.round(minutes / 60)
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago')
    return iso.slice(0, 10)
  }

  function nowMs() {
    return new Date().getTime()
  }

  /* The mirror kept the original site's build-description block - markup, styling and all - and
     simply hides it while empty. That makes it exactly the right home for build notes. */
  function updateDescription(entry) {
    var output = $('#build-description')
    if (!output.length) return
    var notes = entry && entry.notes ? entry.notes : ''
    output.text(notes)
    output.parent().toggle(notes.length > 0)
  }

  function updateStatus() {
    var chip = $('#sp-status')
    if (!chip.length) return

    var entry = savedEntry()
    updateDescription(entry)
    chip.removeClass('sp-status--draft sp-status--saved sp-status--dirty')

    if (!entry) {
      chip
        .addClass('sp-status--draft')
        .attr('title', 'This build is only in your browser and the link. Click to give it a name.')
        .html('<span class="sp-status__dot">○</span> Unsaved draft')
      document.title = baseTitle
      return
    }

    var changes = diffBuilds(stateOf(entry), currentState())
    if (!changes.length) {
      chip
        .addClass('sp-status--saved')
        .attr('title', 'Saved ' + relativeTime(entry.updatedAt))
        .html('<span class="sp-status__dot">●</span> ')
        .append($('<span></span>').text(entry.name))
        .append(document.createTextNode(' · saved'))
      document.title = baseTitle
      return
    }

    /* Naming the fields is the difference between "something changed" and knowing whether you
       still care. The full before/after goes in the tooltip, and clicking still opens the
       side-by-side. */
    var names = []
    var detail = []
    for (var c = 0; c < changes.length; c++) {
      names.push(changes[c].label)
      detail.push(changes[c].label + ': ' + changes[c].a + ' → ' + changes[c].b)
    }

    var shown = names.slice(0, 3).join(', ')
    if (names.length > 3) shown += ' +' + (names.length - 3) + ' more'

    chip
      .addClass('sp-status--dirty')
      .attr('title', detail.join('\n') + '\n\nClick to compare with the saved build. Ctrl+S saves.')
      .html('<span class="sp-status__dot">●</span> ')
      .append($('<span></span>').text(entry.name))
      .append(document.createTextNode(' · ' + changes.length + (changes.length === 1 ? ' unsaved change' : ' unsaved changes')))
      .append($('<span class="sp-status__fields"></span>').text(shown))
    /* Visible in the tab strip, which matters when several planners are open at once. */
    document.title = '● ' + baseTitle
  }

  function buildStatus() {
    var host = $('.planner .character-class')
    if (!host.length) return
    $('<div id="sp-status" class="sp-status"></div>')
      .appendTo(host)
      .on('click', function () {
        var entry = savedEntry()
        if (!entry) {
          saveCurrent(false)
          updateStatus()
          return
        }
        if (!diffBuilds(stateOf(entry), currentState()).length) {
          openDrawer()
          return
        }
        openDrawer()
        runCompare({ name: entry.name + ' (saved)', state: stateOf(entry) }, { name: 'Current build', state: currentState() })
      })
    updateStatus()
  }

  /* ----------------------------------------------------------------- compare */

  /* Comparing two builds needs more than their stored fields: what you actually want to know is
     which one ends up tankier, and that lives in numbers the planner derives. Rather than
     reimplement any of that arithmetic, each build is loaded into an off-screen same-origin
     iframe of this very page and its results panel is read back - so the figures are, by
     construction, the ones the planner itself would show. */

  /* Longest first: DS 2 adds "-def-bonus" columns alongside the plain "-def" ones, and matching
     the short suffix first would label them both the same. */
  var RESULT_SUFFIXES = [
    ['-def-bonus', ' (def bonus)'],
    ['-res-bonus', ' (res bonus)'],
    ['-abs', ' (abs)'],
    ['-def', ' (def)'],
    ['-res', ' (res)']
  ]

  /* Rows in the defence/absorption grid carry one label for several columns, so the absorption
     and armour-resistance inputs have no label of their own to borrow - their name has to come
     from the id instead. */
  function labelFromId(id) {
    return id
      .replace(/^armor-/, '')
      .replace(/-(def|res)-bonus$/, '')
      .replace(/-(def|abs|res)$/, '')
      .replace(/-/g, ' ')
      .replace(/^./, function (c) { return c.toUpperCase() })
  }

  function resultLabel(el, doc) {
    var id = el.id
    var base = $(el).closest('div', doc).find('label').first().text().replace(/^\s+|\s+$/g, '')

    for (var i = 0; i < RESULT_SUFFIXES.length; i++) {
      var suffix = RESULT_SUFFIXES[i][0]
      if (id.slice(-suffix.length) !== suffix) continue
      /* An armour resistance and a character resistance would otherwise both read "Bleed (res)". */
      var armour = id.indexOf('armor-') === 0
      return (armour || !base ? labelFromId(id) : base) + (armour ? ' (armor)' : RESULT_SUFFIXES[i][1])
    }
    return base || labelFromId(id)
  }

  /* Everything the planner reports about a finished build, in the order it displays it. */
  function readResults(doc) {
    var rows = []
    var seen = {}
    $('.planner .perfomance-1, .planner .perfomance-2', doc).find('input[readonly], output').each(function () {
      if (!this.id) return
      var label = resultLabel(this, doc)
      if (seen[label]) label += ' [' + this.id + ']'
      seen[label] = true
      rows.push({ id: this.id, label: label, value: this.value !== undefined ? this.value : $(this).text() })
    })
    return rows
  }

  function compareUrl(state) {
    var base = baseUrl()
    return base + (base.indexOf('?') === -1 ? '?' : '&') + COMPARE_PARAM + HASH_PREFIX + encode(state)
  }

  /* Loads each state in its own frame and hands back their results panels. */
  function computeStates(states, done) {
    var results = new Array(states.length)
    var frames = []
    var pending = states.length

    function finish() {
      for (var f = 0; f < frames.length; f++) {
        if (frames[f].parentNode) frames[f].parentNode.removeChild(frames[f])
      }
      done(results)
    }

    for (var i = 0; i < states.length; i++) {
      ;(function (index) {
        var frame = document.createElement('iframe')
        frame.className = 'sp-compare-frame'
        frame.setAttribute('aria-hidden', 'true')
        frame.setAttribute('tabindex', '-1')
        frame.src = compareUrl(states[index])
        document.body.appendChild(frame)
        frames.push(frame)

        var tries = 0
        var poll = window.setInterval(function () {
          tries++
          var ready = false
          try {
            ready = !!(frame.contentWindow && frame.contentWindow.spCompareReady)
          } catch (e) {
            ready = false
          }
          /* ~10s before giving up on a frame; the bundle is big but it is served locally. */
          if (!ready && tries < 200) return
          window.clearInterval(poll)
          try {
            results[index] = ready ? readResults(frame.contentDocument) : null
          } catch (e) {
            results[index] = null
          }
          if (--pending === 0) finish()
        }, 50)
      })(i)
    }
  }

  /* ------------------------------------------------------------- input diffing */

  var FIELD_LABELS = {
    class_: 'Class',
    level: 'Level',
    gender: 'Gender',
    covenant: 'Covenant',
    covenantLevel: 'Covenant level',
    grip: 'Two-handed',
    isPVP: 'PvP mode',
    isLowHP: 'Low HP',
    isFullHP: 'Full HP',
    isDragonHead: 'Dragon head stone',
    isDragonTorso: 'Dragon torso stone',
    useSkillLH1: 'Left hand skill',
    useSkillRH1: 'Right hand skill'
  }

  var SCALAR_SELECT = {
    class_: '#class',
    gender: '#gender',
    covenant: '#covenant',
    covenantLevel: '#covenant-level'
  }

  /* Purely which stat panel a weapon slot is showing - not part of the build. */
  var IGNORED_FIELDS = { weaponsParamVisible: true, level: true }

  function prettify(key) {
    if (FIELD_LABELS[key]) return FIELD_LABELS[key]
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ')
  }

  /* head -> Head, ring-1 -> Ring 1, rh1 -> RH1, spell-12 -> Spell 12 */
  function slotLabel(id) {
    if (/^[lr]h\d$/.test(id)) return id.toUpperCase()
    return id
      .replace(/-/g, ' ')
      .replace(/(\d+)/, ' $1')
      .replace(/\s+/g, ' ')
      .replace(/^./, function (c) { return c.toUpperCase() })
  }

  function isBoolField(key, value) {
    return key === 'grip' || key.indexOf('is') === 0 || key.indexOf('useSkill') === 0
      ? value === 0 || value === 1 || value === '0' || value === '1'
      : false
  }

  function scalarText(key, value) {
    if (value === undefined || value === null || value === '') return '—'
    if (isBoolField(key, value)) return Number(value) ? 'yes' : 'no'
    if (SCALAR_SELECT[key]) {
      var $select = $(SCALAR_SELECT[key])
      if ($select.length) return optionText($select, String(value)) || String(value)
    }
    return String(value)
  }

  /* Reads an entry out of one of the semicolon-joined list fields, resolving ids to the names the
     planner itself shows by looking them up in that slot's own dropdown. */
  function listEntryText(list, values, index, parkedMap, buffs) {
    var $select = $('#' + list.ids[index])
    var stride = 1 + list.extras.length
    var base = values[index * stride]
    var parkedValues = parkedMap && parkedMap[list.ids[index]]
    var text

    if (parkedValues) {
      text = (optionText($select, parkedValues[0]) || parkedValues[0]) + ' (parked)'
    } else {
      text = optionText($select, base) || (base === '-1' || base === undefined ? '—' : base)
      for (var e = 0; e < list.extras.length; e++) {
        var extraValue = values[index * stride + 1 + e]
        if (extraValue === undefined) continue
        var suffix = list.extras[e]
        if (suffix === '-reinforce') {
          if (Number(extraValue) > 0) text += ' +' + extraValue
        } else {
          var $extra = $('#' + list.ids[index] + suffix)
          var extraText = $extra.length ? optionText($extra, extraValue) : ''
          if (extraText && !/^no /i.test(extraText)) text += ' (' + extraText + ')'
          else if (!extraText && extraValue && extraValue !== '0') text += ' (' + extraValue + ')'
        }
      }
    }

    if (buffs && Number(buffs[index]) === 1) text += ' [buff on]'
    return text
  }

  function resolveListIds(list) {
    if (!list.ids) {
      list.ids = $(list.selector).map(function () { return this.id }).get()
    }
    return list
  }

  function splitField(build, key) {
    var raw = build[key]
    return typeof raw === 'string' ? raw.split(';') : []
  }

  /* What actually differs between two builds, in planner order and in planner words. */
  function diffBuilds(a, b) {
    var changes = []
    var handled = { }
    var lists = adapter.lists || []
    var i

    for (i = 0; i < lists.length; i++) {
      var list = resolveListIds(lists[i])
      handled[list.key] = true
      if (list.buffs) handled[list.buffs] = true

      var aValues = splitField(a.build, list.key)
      var bValues = splitField(b.build, list.key)
      var aBuffs = list.buffs ? splitField(a.build, list.buffs) : null
      var bBuffs = list.buffs ? splitField(b.build, list.buffs) : null

      for (var slot = 0; slot < list.ids.length; slot++) {
        var aText = listEntryText(list, aValues, slot, a.parked, aBuffs)
        var bText = listEntryText(list, bValues, slot, b.parked, bBuffs)
        if (aText !== bText) changes.push({ label: slotLabel(list.ids[slot]), a: aText, b: bText })
      }
    }

    for (var k = 0; k < adapter.required.length; k++) {
      var key = adapter.required[k]
      if (handled[key] || IGNORED_FIELDS[key]) continue
      var aRaw = a.build[key]
      var bRaw = b.build[key]
      if (String(aRaw) === String(bRaw)) continue
      var change = { label: prettify(key), a: scalarText(key, aRaw), b: scalarText(key, bRaw) }
      if (!isNaN(parseFloat(aRaw)) && !isNaN(parseFloat(bRaw)) && !isBoolField(key, aRaw)) {
        change.delta = parseFloat(bRaw) - parseFloat(aRaw)
      }
      changes.push(change)
    }

    return changes
  }

  /* Leading number of things like "764 (993)" or "34.2 / 69.0 - 49.6%", so a delta can be shown
     for the values where one is meaningful. */
  function leadingNumber(text) {
    var match = /^-?\d+(\.\d+)?/.exec(String(text).replace(/^\s+/, ''))
    return match ? parseFloat(match[0]) : null
  }

  function formatDelta(delta, decimals) {
    var rounded = Math.round(delta * Math.pow(10, decimals)) / Math.pow(10, decimals)
    if (rounded === 0) return ''
    return (rounded > 0 ? '+' : '−') + Math.abs(rounded).toFixed(decimals)
  }

  /* ------------------------------------------------------------------ drawer */

  /* A drawer rather than a modal so the planner stays usable while it is open - you can leave the
     list up, tweak a stat, and save again without closing anything. Deliberately no overlay and
     no click-outside-to-close for the same reason. */

  function buildDrawer() {
    var markup =
      '<aside id="builds-drawer" class="sp-drawer" aria-hidden="true">' +
      '<header class="sp-drawer__head">' +
      '<h2>Saved builds</h2>' +
      '<button type="button" class="sp-drawer__close" title="Close (Esc)" aria-label="Close">&times;</button>' +
      '</header>' +
      '<div class="sp-drawer__body">' +
      '<div class="sp-pane sp-pane--list">' +
      '<div class="sp-filters">' +
      '<input type="search" class="sp-search" placeholder="Search name, notes, tags" />' +
      '<select class="sp-sort">' +
      '<option value="recent">Recent</option>' +
      '<option value="name">Name</option>' +
      '<option value="level">Level</option>' +
      '</select>' +
      '</div>' +
      '<div class="sp-tags"></div>' +
      '<ul class="sp-builds"></ul>' +
      '<p class="sp-empty">No saved builds yet. Use the save button to keep this one.</p>' +
      '</div>' +
      '<div class="sp-pane sp-pane--compare"></div>' +
      '</div>' +
      '<footer class="sp-drawer__foot">' +
      '<button class="default" id="builds-drawer__save-as">Save current as new</button>' +
      '<button id="builds-drawer__compare" disabled>Compare (pick 2)</button>' +
      '<button id="builds-drawer__export">Export</button>' +
      '<button id="builds-drawer__import">Import</button>' +
      '</footer>' +
      '<input type="file" accept="application/json" class="sp-file" />' +
      '</aside>'

    var el = $(markup).appendTo(document.body)

    el.on('click', '.sp-action', function () {
      var action = $(this).attr('data-action')
      var id = $(this).closest('.sp-build').attr('data-id')
      var builds = loadBuilds()
      var index = findIndex(builds, id)
      if (index === -1) return

      if (action === 'load') {
        store.set(KEY.currentId, id)
        applyBuild(stateOf(builds[index]))
      } else if (action === 'share') {
        copyToClipboard(shareUrl(stateOf(builds[index])))
      } else if (action === 'duplicate') {
        var copy = entryFor(builds[index].name + ' copy', stateOf(builds[index]))
        copy.notes = builds[index].notes || ''
        copy.tags = entryTags(builds[index]).slice()
        builds.unshift(copy)
        saveBuilds(builds)
        renderRows()
        toast('Duplicated')
      } else if (action === 'edit') {
        openEditor($(this).closest('.sp-build'), builds[index])
      } else if (action === 'save-edit') {
        var row = $(this).closest('.sp-build')
        var newName = row.find('.sp-editor__name').val().replace(/^\s+|\s+$/g, '')
        if (newName) builds[index].name = newName
        builds[index].notes = row.find('.sp-editor__notes').val().replace(/^\s+|\s+$/g, '')
        builds[index].tags = row
          .find('.sp-editor__tags')
          .val()
          .split(',')
          .map(function (tag) {
            return tag.replace(/^\s+|\s+$/g, '')
          })
          .filter(function (tag) {
            return tag.length > 0
          })
        saveBuilds(builds)
        renderRows()
        updateStatus()
      } else if (action === 'cancel-edit') {
        $(this).closest('.sp-build').find('.sp-editor').remove()
      } else if (action === 'delete') {
        if (!window.confirm('Delete "' + builds[index].name + '"?')) return
        builds.splice(index, 1)
        saveBuilds(builds)
        if (store.get(KEY.currentId, null) === id) store.remove(KEY.currentId)
        renderRows()
      }
    })

    el.on('input', '.sp-search', function () {
      renderRows()
    })

    el.on('change', '.sp-sort', function () {
      store.set(KEY_SORT, $(this).val())
      renderRows()
    })

    el.on('click', '.sp-tag', function () {
      var tag = $(this).attr('data-tag')
      tagFilter = tagFilter === tag ? null : tag
      renderRows()
    })

    el.on('change', '.sp-pick', function () {
      /* Two at a time: past that a side-by-side stops being readable. */
      if ($('#builds-drawer .sp-pick:checked').length > 2) $(this).prop('checked', false)
      syncCompareButton()
    })

    el.find('#builds-drawer__compare').on('click', function () {
      var picked = pickedEntries()
      if (picked.length !== 2) return
      runCompare(picked[0], picked[1])
    })

    el.on('click', '.sp-back', showList)

    el.find('#builds-drawer__save-as').on('click', function () {
      if (saveCurrent(true)) renderRows()
    })
    el.find('#builds-drawer__export').on('click', exportBuilds)
    el.find('#builds-drawer__import').on('click', function () {
      el.find('.sp-file').val('').trigger('click')
    })
    el.find('.sp-file').on('change', function () {
      if (this.files && this.files[0]) importBuilds(this.files[0])
    })
    el.find('.sp-drawer__close').on('click', closeDrawer)

    $(document).on('keydown', function (event) {
      if (event.which === 27 && drawerIsOpen()) closeDrawer()
    })

    return el
  }

  /* --------------------------------------------------------- compare rendering */

  function decimalsOf(text) {
    var match = /^-?\d+\.(\d+)/.exec(String(text))
    return match ? match[1].length : 0
  }

  function showList() {
    $('#builds-drawer').removeClass('sp-drawer--wide')
    $('#builds-drawer .sp-pane--list').show()
    $('#builds-drawer .sp-pane--compare').hide()
    $('#builds-drawer .sp-drawer__foot').show()
  }

  function showComparePane() {
    $('#builds-drawer').addClass('sp-drawer--wide')
    $('#builds-drawer .sp-pane--list').hide()
    $('#builds-drawer .sp-pane--compare').show()
    $('#builds-drawer .sp-drawer__foot').hide()
  }

  function runCompare(a, b) {
    showComparePane()
    $('#builds-drawer .sp-pane--compare')
      .empty()
      .append('<button type="button" class="sp-back">&larr; Back to builds</button>')
      .append($('<p class="sp-empty"></p>').text('Calculating both builds…'))

    computeStates([a.state, b.state], function (results) {
      renderCompare(a, b, results[0], results[1])
    })
  }

  function compareTable(rows, withDelta) {
    var table = $('<table class="sp-cmp"></table>')
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      var tr = $('<tr></tr>').toggleClass('sp-cmp--diff', !!row.differs)
      $('<th></th>').text(row.label).appendTo(tr)
      $('<td></td>').text(row.a).appendTo(tr)
      $('<td></td>').text(row.b).appendTo(tr)
      if (withDelta) {
        var cell = $('<td class="sp-cmp__delta"></td>').text(row.delta || '')
        if (row.delta) cell.addClass(row.delta.charAt(0) === '+' ? 'sp-cmp__delta--up' : 'sp-cmp__delta--down')
        cell.appendTo(tr)
      }
      table.append(tr)
    }
    return table
  }

  function renderCompare(a, b, resultsA, resultsB) {
    var pane = $('#builds-drawer .sp-pane--compare').empty()
    pane.append('<button type="button" class="sp-back">&larr; Back to builds</button>')

    $('<div class="sp-cmp__names"></div>')
      .append($('<span></span>').text(a.name))
      .append($('<span></span>').text(b.name))
      .appendTo(pane)

    if (resultsA && resultsB) {
      var resultRows = []
      for (var i = 0; i < resultsA.length; i++) {
        var ra = resultsA[i]
        var rb = resultsB[i] || { value: '' }
        var differs = ra.value !== rb.value
        var na = leadingNumber(ra.value)
        var nb = leadingNumber(rb.value)
        resultRows.push({
          label: ra.label,
          a: ra.value,
          b: rb.value,
          differs: differs,
          delta: differs && na !== null && nb !== null ? formatDelta(nb - na, decimalsOf(ra.value)) : ''
        })
      }
      $('<h3></h3>').text('Result').appendTo(pane)
      compareTable(resultRows, true).appendTo(pane)
    } else {
      $('<p class="sp-empty"></p>')
        .text('Could not calculate one of the builds - the planner did not finish loading in time.')
        .appendTo(pane)
    }

    var changes = diffBuilds(a.state, b.state)
    $('<h3></h3>').text(changes.length ? 'Changed (' + changes.length + ')' : 'Changed').appendTo(pane)
    if (changes.length) {
      for (var c = 0; c < changes.length; c++) changes[c].differs = true
      compareTable(changes, false).appendTo(pane)
    } else {
      $('<p class="sp-empty"></p>').text('These two builds are identical.').appendTo(pane)
    }
  }

  function drawerIsOpen() {
    return $('#builds-drawer').hasClass('sp-drawer--open')
  }

  function openDrawer() {
    if (!$('#builds-drawer').length) {
      buildDrawer()
      $('#builds-drawer .sp-sort').val(store.get(KEY_SORT, 'recent'))
    }
    renderRows()
    $('#builds-drawer').addClass('sp-drawer--open').attr('aria-hidden', 'false')
    $('#sp-button-builds').addClass('sp-button--active')
  }

  function closeDrawer() {
    showList()
    $('#builds-drawer').removeClass('sp-drawer--open').attr('aria-hidden', 'true')
    $('#sp-button-builds').removeClass('sp-button--active')
  }

  function toggleDrawer() {
    if (drawerIsOpen()) closeDrawer()
    else openDrawer()
  }

  function buildToolbar() {
    var options = $('.planner .character-class .options')
    if (!options.length) return

    /* Separates the planner's own actions from the ones this adds. */
    $('<span class="sp-toolbar__sep"></span>').appendTo(options)

    $('<button class="material-icons" id="sp-button-save" title="Save build (Ctrl+S)">save</button>')
      .on('click', function () {
        saveCurrent(false)
      })
      .appendTo(options)

    $('<button class="material-icons" id="sp-button-builds" title="Saved builds">folder</button>')
      .on('click', toggleDrawer)
      .appendTo(options)

    $('<button class="material-icons" id="sp-button-share" title="Copy share link">link</button>')
      .on('click', function () {
        copyToClipboard(shareUrl(currentState()))
      })
      .appendTo(options)
  }

  function rebindStockButtons() {
    /* Both of these were written for the live site and are wrong in an offline copy. */

    /* "/darksouls3" is an absolute path that only resolves on the original domain. */
    $('#button-new')
      .off('click')
      .on('click', function () {
        window.open('index.html')
      })

    /* A plain reload would just restore the build from the hash again. */
    $('#button-reset')
      .off('click')
      .on('click', function () {
        suspended = true
        window.clearTimeout(timer)
        store.remove(KEY.autosave)
        store.remove(KEY.currentId)
        try {
          window.history.replaceState(null, '', baseUrl())
        } catch (e) {
          window.location.href = baseUrl()
        }
        window.location.reload()
      })
  }

  $(document).ready(function () {
    if (!$('.planner').length) return

    if (isCompareFrame) {
      /* By the time this runs the planner has already applied the build from the hash and done
         its own recalculation - which is the entire reason this frame exists. Flag it and stop. */
      window.spCompareReady = true
      return
    }

    buildToolbar()
    rebindStockButtons()
    buildToggles()
    applyParked(restoredParked)
    buildStatus()
    decorateDropdowns()

    /* Choosing something for a parked slot obviously means you want it back. */
    $('.planner').on('change', 'select', function () {
      if (applying || !parked.hasOwnProperty(this.id)) return
      delete parked[this.id]
      $('#sp-slot-' + this.id).prop('checked', true)
      markParked(this.id)
    })

    /* One delegated listener covers every control in every game. Delegation matters: the event
       reaches .planner only after the planner's own handler has run on the element itself, so by
       the time we serialize, the recalculation is already done. The +/- stat buttons and the
       arrow-key handlers all go through .val(x).trigger('change'), so they are covered too. */
    $('.planner').on('change', 'select, input', schedulePersist)

    $(document).on('keydown', function (event) {
      if (!(event.ctrlKey || event.metaKey)) return

      /* Leave the drawer's own text fields to the browser's undo. */
      if ($(event.target).closest('#builds-drawer').length) return

      if (event.which === 83) {
        event.preventDefault()
        saveCurrent(false)
      } else if (event.which === 90 && !event.shiftKey) {
        event.preventDefault()
        stepHistory(-1)
      } else if ((event.which === 90 && event.shiftKey) || event.which === 89) {
        event.preventDefault()
        stepHistory(1)
      }
    })

    if (restoredFrom === 'link') toast('Build loaded from link')

    /* Seed the hash and the autosave so the address bar is a valid share link from the start. */
    persistNow()

    /* Cheap drift check: the required list above must stay in step with serialize(). */
    if (Object.keys(currentBuild()).sort().join(',') !== adapter.required.slice().sort().join(',')) {
      warn('required[] is out of sync with serialize() for ' + game)
    }
  })

  /* Exposed for debugging from the console. */
  window.SoulsPersist = {
    game: game,
    toast: toast,
    current: currentBuild,
    state: currentState,
    parked: currentParked,
    shareUrl: function () {
      return shareUrl(currentState())
    },
    builds: loadBuilds,
    encode: encode,
    decode: decode
  }
})()
