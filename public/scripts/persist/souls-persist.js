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
    calculator: 'soulsPlanner.calc.' + game + '.' + (page ? page.name : ''),
    owned: 'soulsPlanner.owned.' + game,
    ownedFilter: 'soulsPlanner.ownedFilter.' + game
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

  /* Which reinforce and infusion dropdowns belong to a slot, recorded when the toggles are built
     so the parked display can reach them without every caller passing them along. */
  var slotSuffixes = {}

  /* What each of a slot's dropdowns said at the moment it was parked. Kept apart from `parked`,
     which is serialised into saved builds and share links and must keep its shape. A build arriving
     from a link has no labels, so the display falls back to looking the values up. */
  var parkedLabels = {}

  function paintParked($select, text) {
    var $rendered = $select.next('.select2-container').find('.select2-selection__rendered')
    if (!$rendered.length) return

    if (text === null) {
      /* Nothing to put back by hand: unparking sets a real value and select2 redraws from it. */
      $rendered.removeClass('sp-parked-name')
      return
    }
    $rendered.addClass('sp-parked-name').text(text).attr('title', text)
  }

  /* A parked slot used to fall back to the dropdown's "Naked" placeholder, which threw away the
     one thing you were looking at: what is in the slot you are doing without. The planner still
     gets an empty value - that is the entire point of parking - but the name stays on screen,
     greyed and struck through, so the slot reads as "this, switched off" rather than as empty.
     The reinforce and infusion beside it are shown the same way, since a weapon at +5 parked as a
     bare +0 loses half of what you were looking at. */
  function showParkedName(id, $select, values) {
    var labels = parkedLabels[id]
    var suffixes = slotSuffixes[id] || []

    paintParked($select, values ? (labels && labels[0]) || optionText($select, values[0]) || null : null)

    for (var i = 0; i < suffixes.length; i++) {
      var $extra = $('#' + id + suffixes[i])
      if (!$extra.length) continue
      var text = null
      if (values) {
        text = (labels && labels[i + 1]) || optionText($extra, values[i + 1]) || null
      }
      paintParked($extra, text)
    }
  }

  /* Emptying the slot makes the planner rebuild its reinforce and infusion lists, and select2
     redraws them by rewriting the same rendered element - which lands after the paint above and
     puts "+0" back over the "+10" we just wrote. It keeps the class, so only the text is lost.
     Re-painting when those dropdowns change catches every redraw the planner announces, and the
     deferred pass catches the rest. Neither fires a change event, so this cannot loop. */
  function repaintParked(id) {
    if (!parked[id]) return
    showParkedName(id, $('#' + id), parked[id])
  }

  function markParked(id) {
    var $select = $('#' + id)
    var values = parked[id]
    $select.closest('.sp-slot').toggleClass('sp-slot--parked', !!values)
    showParkedName(id, $select, values)
    if (values) {
      toggleUi(id).attr('title', 'Parked: ' + (optionText($select, values[0]) || 'this slot') + ' - re-check to put it back')
    } else {
      toggleUi(id).attr('title', TOGGLE_TITLE)
    }
  }

  function parkSlot(id, suffixes) {
    var $select = $('#' + id)
    var values = [$select.val()]
    /* Read the labels off the page before anything is cleared - once the weapon goes the planner
       rebuilds its reinforce and infusion lists, and "+5" may no longer be in there to look up. */
    var labels = [optionText($select, values[0])]

    for (var i = 0; i < suffixes.length; i++) {
      var $extra = $('#' + id + suffixes[i])
      values.push($extra.val())
      labels.push(optionText($extra, $extra.val()))
    }
    parked[id] = values
    parkedLabels[id] = labels

    applying = true
    $select.val(emptyValue($select)).trigger('change.select2').trigger('change')
    applying = false
    markParked(id)
    window.setTimeout(function () { repaintParked(id) }, 0)
  }

  function unparkSlot(id, suffixes) {
    var values = parked[id]
    delete parked[id]
    delete parkedLabels[id]
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
      slotSuffixes[id] = suffixes

      /* jshint loopfunc:true */
      ;(function (slotId) {
        for (var i = 0; i < suffixes.length; i++) {
          $('#' + slotId + suffixes[i]).on('change', function () {
            window.setTimeout(function () { repaintParked(slotId) }, 0)
          })
        }
      })(id)

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
    var link = document.createElement('a')
    link.href = window.location.href
    link.hash = ''

    /* Never hand someone a link that turns their offline cache off - ?nosw is a debugging flag
       and has no business travelling with a shared build. */
    var params = link.search.replace(/^\?/, '').split('&').filter(function (part) {
      return part && part.split('=')[0] !== 'nosw'
    })
    link.search = params.length ? '?' + params.join('&') : ''
    return link.href.replace(/#$/, '')
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

  function syncHistoryButtons() {
    $('#sp-button-undo').prop('disabled', timelineAt <= 0)
    $('#sp-button-redo').prop('disabled', timelineAt >= timeline.length - 1)
  }

  function pushHistory(state) {
    if (restoring) return
    var json = JSON.stringify(state)
    if (timelineAt >= 0 && JSON.stringify(timeline[timelineAt]) === json) return
    timeline = timeline.slice(0, timelineAt + 1)
    timeline.push(JSON.parse(json))
    if (timeline.length > TIMELINE_LIMIT) timeline.shift()
    timelineAt = timeline.length - 1
    syncHistoryButtons()
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
    syncHistoryButtons()
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
    options.matcher = makeMatcher($select)
    $select.select2('destroy')
    $select.select2(options)
  }

  function browseGroups() {
    return [
      { kind: 'armor', selector: adapter.lists[0].selector, extras: adapter.lists[0].extras },
      { kind: 'weapon', selector: adapter.lists[1].selector, extras: adapter.lists[1].extras },
      { kind: 'ring', selector: adapter.lists[2].selector, extras: [] },
      { kind: 'spell', selector: '.planner .spells select, .spells select', extras: [] }
    ]
  }

  /* Registering a slot needs the option list and nothing else, so this runs whatever the page is.
     It used to live inside decorateDropdowns, which bails on the mobile native-select path - with
     the result that the item browser was empty on every phone, and on Android in particular, where
     $.isSelect2Supported is false by definition. That is also the platform where it is most
     useful: without select2 there are no stat columns in the dropdowns and no hover preview, so
     the browser is the only place those numbers appear at all. */
  function registerBrowseSlots() {
    if (!adapter.info) return
    var groups = browseGroups()

    for (var g = 0; g < groups.length; g++) {
      if (!BROWSE_COLUMNS[groups[g].kind]) continue
      /* jshint loopfunc:true */
      ;(function (kind) {
        $(groups[g].selector).each(function () {
          registerBrowseSlot($(this).attr('id'), kind)
        })
      })(groups[g].kind)
    }
  }

  function decorateDropdowns() {
    /* No select2 means the mobile native-select path, where there is nothing to template. */
    if (!$.isSelect2Supported || !$.isSelect2Supported()) return
    if (!adapter.info) return

    var groups = browseGroups()

    for (var g = 0; g < groups.length; g++) {
      /* jshint loopfunc:true */
      ;(function (kind, extras) {
        $(groups[g].selector).each(function () {
          retemplate($(this), kind)
          attachPreview($(this), extras)
        })
      })(groups[g].kind, groups[g].extras || [])
    }

    /* Re-templating destroys and rebuilds select2, which redraws the placeholder over any parked
       name already on screen. */
    for (var id in parked) {
      if (Object.prototype.hasOwnProperty.call(parked, id)) markParked(id)
    }
  }

  /* --------------------------------------------------------------- what-if preview */

  /* Hovering an option shows what it would do to the build. The numbers come from the planner
     itself rather than being recomputed here, which is what makes weapon AR possible at all -
     stage B leaves it out precisely because it cannot be derived accurately from outside.

     The probe sets the candidate, lets the planner recalculate, reads the outputs and puts
     everything back, all inside ONE synchronous task. jQuery's trigger and the planner's recalc
     are both synchronous, so the browser never gets a chance to paint the intermediate state and
     there is no flicker - the build is back before the frame is drawn. */

  var PREVIEW_DELAY = 120
  var PREVIEW_KEEP = {
    hp: 1, fp: 1, stamina: 1, 'equipment-load': 1, 'weight-left': 1, poise: 1,
    'item-discovery': 1, 'attunement-slots': 1
  }

  function prettyOutputId(id, slotId) {
    return id
      .replace(slotId + '-', '')
      .replace(/-/g, ' ')
      .replace(/\batk\b/, 'attack')
      .replace(/^./, function (c) { return c.toUpperCase() })
  }

  /* The summary panels, plus the hovered slot's own attack readout for weapons. */
  function readProbe(slotId) {
    var rows = readResults(document)
    $('#' + slotId).parent().parent().find('.equipment-params.attack output').each(function () {
      if (!this.id) return
      rows.push({ id: this.id, label: prettyOutputId(this.id, slotId), value: $(this).text() })
    })
    return rows
  }

  function probeOption($select, extras, value) {
    var slotId = $select.attr('id')
    var current = $select.val()
    if (String(value) === String(current)) return null

    var saved = [current]
    for (var i = 0; i < extras.length; i++) saved.push($('#' + slotId + extras[i]).val())

    var before = readProbe(slotId)
    applying = true
    $select.val(value).trigger('change')
    var after = readProbe(slotId)

    /* Put it back, extras in reverse order, exactly as unparkSlot does. */
    $select.val(saved[0]).trigger('change')
    for (var e = extras.length - 1; e >= 0; e--) {
      var $extra = $('#' + slotId + extras[e])
      var want = saved[e + 1]
      if (want === undefined || !$extra.length) continue
      if (!$extra.find('option').filter(function () { return this.value === want }).length) continue
      $extra.val(want).trigger('change')
    }
    applying = false

    var changes = []
    for (var r = 0; r < before.length; r++) {
      var was = before[r]
      var now = after[r]
      if (!now || was.value === now.value) continue
      /* Everything from the slot's own panel is interesting; from the summary only the headline
         rows, or a ring preview turns into forty lines of absorption noise. */
      var headline = PREVIEW_KEEP[was.id] || was.id.indexOf(slotId + '-') === 0
      if (!headline) continue
      changes.push({ label: was.label, from: was.value, to: now.value })
    }
    return changes
  }

  function previewCard() {
    var card = $('#sp-preview')
    if (!card.length) card = $('<div id="sp-preview" class="sp-preview"></div>').appendTo(document.body)
    return card
  }

  function hidePreview() {
    $('#sp-preview').removeClass('sp-preview--on')
  }

  function showPreview(changes, name, anchor) {
    var card = previewCard().empty()
    $('<div class="sp-preview__name"></div>').text(name).appendTo(card)

    if (!changes || !changes.length) {
      $('<div class="sp-preview__none"></div>').text('No change to your numbers').appendTo(card)
    } else {
      for (var i = 0; i < changes.length; i++) {
        var line = $('<div class="sp-preview__row"></div>')
        $('<span></span>').text(changes[i].label).appendTo(line)
        $('<b></b>').text(changes[i].to).appendTo(line)
        var delta = leadingNumber(changes[i].to) - leadingNumber(changes[i].from)
        if (!isNaN(delta) && delta !== 0) {
          $('<i></i>')
            .text(formatDelta(delta, decimalsOf(changes[i].from)))
            .addClass(delta > 0 ? 'sp-preview__up' : 'sp-preview__down')
            .appendTo(line)
        }
        card.append(line)
      }
    }

    var box = anchor.getBoundingClientRect()
    card.addClass('sp-preview--on')
    var height = card.outerHeight()
    card.css({
      left: Math.min(box.right + 10, window.innerWidth - card.outerWidth() - 8) + 'px',
      top: Math.max(8, Math.min(box.top, window.innerHeight - height - 8)) + 'px'
    })
  }

  function attachPreview($select, extras) {
    var timer = null

    $select.on('select2:open', function () {
      /* The results list is built fresh on every open, so binding has to happen here. */
      window.setTimeout(function () {
        /* Only the outermost list: weapons are grouped, so binding to the nested lists as well
           would run this twice for the same row. */
        $('.select2-container--open .select2-results__options')
          .not('.select2-results__options--nested')
          .off('.spPreview')
          .on('mouseenter.spPreview', '.select2-results__option', function () {
            var data = $(this).data('data')
            var anchor = this

            /* Group headers ("Axes", "Straight Swords") are themselves .select2-results__option and
               enclose their options, so hovering an option fires this for the option and then for
               its group. Returning rather than falling through matters: the group has no id, and
               clearing the timer there would cancel the probe the option just scheduled - which is
               exactly why weapons showed nothing while armour, which has no groups, worked. */
            if (data && data.children) return

            window.clearTimeout(timer)
            if (!data || !data.id || data.id === '-1') return hidePreview()
            timer = window.setTimeout(function () {
              var changes = probeOption($select, extras, data.id)
              if (changes === null) return hidePreview()
              showPreview(changes, data.text, anchor)
            }, PREVIEW_DELAY)
          })
          .on('mouseleave.spPreview', function () {
            window.clearTimeout(timer)
            hidePreview()
          })
      }, 0)
    })

    $select.on('select2:close', function () {
      window.clearTimeout(timer)
      hidePreview()
    })
  }

  /* --------------------------------------------------------------- item browser */

  /* A dropdown is the wrong shape for "which chest piece gives me the most poise for its weight".
     This is the same data as the dropdown columns, as a table you can order by any column and
     filter, including by what still fits in your remaining equip load.

     One entry point in the toolbar rather than a button on all fourteen slots, with the slot
     chosen inside - which also means you can flick between slots while comparing. */

  var browseSlots = []
  var browseState = { slot: null, sort: { key: 'name', dir: 1 }, fits: false, ownedOnly: false, shown: [] }

  var BROWSE_COLUMNS = {
    armor: [
      { key: 'name', label: 'Name', text: true },
      { key: 'weight', label: 'Wt', digits: 1 },
      { key: 'poise', label: 'Poise', digits: 1 },
      { key: 'defence', label: 'Def', digits: 1 },
      { key: 'ratio', label: 'Poise/wt', digits: 2 }
    ],
    weapon: [
      { key: 'name', label: 'Name', text: true },
      { key: 'weight', label: 'Wt', digits: 1 },
      { key: 'strength', label: 'Str', digits: 0, requirement: true },
      { key: 'dexterity', label: 'Dex', digits: 0, requirement: true },
      { key: 'intelligence', label: 'Int', digits: 0, requirement: true },
      { key: 'faith', label: 'Fth', digits: 0, requirement: true }
    ],
    ring: [
      { key: 'name', label: 'Name', text: true },
      { key: 'weight', label: 'Wt', digits: 1 },
      { key: 'effect', label: 'Effect', text: true }
    ],
    /* Everything at once, so a name can be searched for without knowing which slot it belongs to.
       The per-kind columns cannot all fit side by side, so this keeps what every item has - where
       it goes, what it weighs - plus the two armour figures, blank on anything that has none. */
    all: [
      { key: 'where', label: 'Where', text: true },
      { key: 'name', label: 'Name', text: true },
      { key: 'weight', label: 'Wt', digits: 1 },
      { key: 'poise', label: 'Poise', digits: 1 },
      { key: 'defence', label: 'Def', digits: 1 }
    ]
  }

  var ALL_SLOT = { id: '*', kind: 'all', label: 'All items' }

  var BROWSE_GROUPS = { armor: 'Armor', weapon: 'Weapons', ring: 'Rings', spell: 'Spells' }

  /* The picker was a flat list of fourteen slot names and nothing else, so choosing the slot you
     meant involved remembering which of LH1 and RH2 currently holds the shield. It now groups them
     by what they take and says what is in each one. */
  /* Coalesced: scrubbing a stat with the arrow buttons fires a change per step, and the table can
     be three hundred rows. One redraw per burst rather than one per event. */
  var browseRefreshTimer = null

  function scheduleBrowseRefresh() {
    if (!browseIsOpen()) return
    if (browseRefreshTimer) window.clearTimeout(browseRefreshTimer)
    browseRefreshTimer = window.setTimeout(function () {
      browseRefreshTimer = null
      if (!browseIsOpen()) return
      renderSlotPicker()
      renderBrowse()
    }, 60)
  }

  function renderSlotPicker() {
    var picker = $('#browse-drawer .sp-browse__slot')
    if (!picker.length) return
    picker.empty()

    /* First, because "which slot is that in again" is the question it answers. */
    picker.append(
      $('<option></option>').attr('value', ALL_SLOT.id).text(ALL_SLOT.label + ' · search everything')
    )

    var groups = {}
    for (var i = 0; i < browseSlots.length; i++) {
      var slot = browseSlots[i]
      var name = BROWSE_GROUPS[slot.kind] || 'Other'
      if (!groups[name]) groups[name] = $('<optgroup></optgroup>').attr('label', name).appendTo(picker)

      var $select = $('#' + slot.id)
      var held
      if (parked[slot.id]) {
        held = (optionText($select, parked[slot.id][0]) || 'something') + ' (parked)'
      } else {
        var value = $select.val()
        held = value && value !== '-1' && value !== emptyValue($select) ? optionText($select, value) : 'empty'
      }

      groups[name].append(
        $('<option></option>').attr('value', slot.id).text(slot.label + ' · ' + held)
      )
    }
    if (browseState.slot) picker.val(browseState.slot.id)
  }

  /* Working out every row means constructing a model object per item - the best part of a second
     on Dark Souls 3 - and doing it when the panel is first opened made that click feel broken. It
     is done ahead of time instead, one slot per turn of the event loop so nothing blocks, well
     after the page has settled. */
  function warmBrowseCache() {
    var index = 0

    function step() {
      if (index >= browseSlots.length) {
        allRows()
        return
      }
      browseRows(browseSlots[index++])
      window.setTimeout(step, 0)
    }

    window.setTimeout(step, 1200)
  }

  function registerBrowseSlot(id, kind) {
    browseSlots.push({ id: id, kind: kind, label: slotLabel(id) })
  }

  /* Everything the slot offers, enriched with the same accessors the dropdown columns use. */
  /* Rows come from the option list and the game's model classes, both fixed for the life of the
     page, so each slot is worked out once and kept. It matters here: building a row means
     constructing a model object per item, and the everything view on Dark Souls 3 is 885 of them.
     Without this, every keystroke in the search box paid for all of it again. */
  var browseRowCache = {}

  /* Every item in the game, once. Six weapon slots share one list and four ring slots share
     another, so the same weapon would otherwise appear six times; the slots an item turned up in
     are remembered instead, which is also what decides whether it can be equipped from here
     without guessing. */
  function allRows() {
    if (browseRowCache[ALL_SLOT.id]) return browseRowCache[ALL_SLOT.id]

    var seen = {}
    var rows = []

    for (var s = 0; s < browseSlots.length; s++) {
      var slot = browseSlots[s]
      var slotRows = browseRows(slot)
      for (var r = 0; r < slotRows.length; r++) {
        var row = slotRows[r]
        var key = slot.kind + '|' + row.value
        if (seen[key]) {
          seen[key].slots.push(slot.id)
          continue
        }
        var copy = $.extend({}, row)
        copy.kind = slot.kind
        copy.slots = [slot.id]
        seen[key] = copy
        rows.push(copy)
      }
    }

    /* Named by its slot where there is only one - "Head" - and by its family where there are
       several, since "Left hand 1" would be an arbitrary pick out of six. */
    for (var i = 0; i < rows.length; i++) {
      var only = rows[i].slots.length === 1 ? slotById(rows[i].slots[0]) : null
      rows[i].where = only ? only.label : BROWSE_GROUPS[rows[i].kind] || 'Other'
    }

    browseRowCache[ALL_SLOT.id] = rows
    return rows
  }

  function browseRows(slot) {
    if (browseRowCache[slot.id]) return browseRowCache[slot.id]
    var $select = $('#' + slot.id)
    var empty = emptyValue($select)
    var rows = []

    $select.find('option').each(function () {
      var value = this.value
      if (value === empty || value === '-1') return
      var info = askInfo(slot.kind, value, slot.id)
      if (!info) return

      var row = { value: value, name: $(this).text(), weight: info.weight }
      if (slot.kind === 'armor') {
        row.poise = info.poise
        row.defence = info.defence
        row.ratio = info.weight ? info.poise / info.weight : 0
      } else if (slot.kind === 'weapon') {
        var req = info.req || {}
        row.strength = req.strength || 0
        row.dexterity = req.dexterity || 0
        row.intelligence = req.intelligence || 0
        row.faith = req.faith || 0
      } else if (slot.kind === 'ring') {
        row.effect = (info.effects || []).join(' ')
      }
      rows.push(row)
    })
    browseRowCache[slot.id] = rows
    return rows
  }

  /* What you could still put in this slot: whatever is left over, plus whatever the slot is
     already carrying, since equipping something replaces it rather than adding to it. */
  function weightBudget(slot) {
    var left = leadingNumber($('#weight-left').val() || $('#weight-left').text())
    if (left === null) return null
    var current = askInfo(slot.kind, $('#' + slot.id).val(), slot.id)
    return left + (current && current.weight ? current.weight : 0)
  }

  function esc(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /* One budget per slot rather than one per row: "only what fits" counts the item the slot is
     already carrying, and in the everything view a row's slot varies from row to row. */
  function budgetsBySlot() {
    var out = {}
    for (var i = 0; i < browseSlots.length; i++) {
      out[browseSlots[i].id] = weightBudget(browseSlots[i])
    }
    return out
  }

  function renderBrowse() {
    var slot = browseState.slot
    if (!slot) return
    var pane = $('#browse-drawer')
    var everything = slot.kind === 'all'
    var columns = BROWSE_COLUMNS[slot.kind]
    var term = ($('#browse-drawer .sp-browse__search').val() || '').toLowerCase()
    var budgets = browseState.fits ? budgetsBySlot() : null
    var budget = browseState.fits && !everything ? weightBudget(slot) : null

    /* In the everything view an item counts as equipped if it is in any of the slots it fits. */
    var equipped = {}
    if (everything) {
      for (var e = 0; e < browseSlots.length; e++) equipped[$('#' + browseSlots[e].id).val()] = browseSlots[e].id
    } else {
      equipped[$('#' + slot.id).val()] = slot.id
    }

    var source = everything ? allRows() : browseRows(slot)
    var rows = []
    for (var f = 0; f < source.length; f++) {
      var candidate = source[f]
      if (term && candidate.name.toLowerCase().indexOf(term) === -1) continue
      if (browseState.ownedOnly && !isOwned(everything ? candidate.kind : slot.kind, candidate.value)) continue
      if (budgets) {
        var allowance = everything ? budgets[candidate.slots[0]] : budget
        if (allowance !== null && allowance !== undefined && candidate.weight > allowance) continue
      }
      rows.push(candidate)
    }

    var sort = browseState.sort
    rows.sort(function (a, b) {
      var x = a[sort.key]
      var y = b[sort.key]
      if (typeof x === 'string' || typeof y === 'string') {
        x = String(x).toLowerCase()
        y = String(y).toLowerCase()
        return x < y ? -sort.dir : x > y ? sort.dir : 0
      }
      return ((x || 0) - (y || 0)) * sort.dir
    })

    /* Built as one string and handed over in a single assignment. Nine hundred rows of five cells
       is four and a half thousand elements, and creating them one jQuery object at a time was
       what made the everything view feel slow rather than the data behind it. */
    var html = ['<table class="sp-browse"><tr>']
    html.push('<th class="sp-browse__own-head" title="Mark what you have">Own</th>')
    html.push('<th class="sp-browse__equip-head"></th>')

    for (var c = 0; c < columns.length; c++) {
      var col = columns[c]
      var arrow = sort.key === col.key ? (sort.dir > 0 ? ' \u25b2' : ' \u25bc') : ''
      html.push(
        '<th data-sort="' + esc(col.key) + '" class="' +
          (sort.key === col.key ? 'sp-browse__sorted ' : '') +
          (col.text ? 'sp-browse__text' : '') + '">' + esc(col.label + arrow) + '</th>'
      )
    }
    html.push('</tr>')

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r]
      var kind = everything ? row.kind : slot.kind
      var here = equipped[row.value]
      var target = everything ? (here || row.slots[0]) : slot.id
      /* Armour belongs to one slot, so it can be equipped straight from the everything view. A
         weapon fits six slots and a ring four - choosing one would be a guess, so those offer to
         take you to the slot instead. */
      var single = !everything || row.slots.length === 1

      html.push(
        '<tr class="sp-browse__row' + (here ? ' sp-browse__row--equipped' : '') +
          '" data-value="' + esc(row.value) + '" data-kind="' + esc(kind) + '">'
      )
      html.push('<td class="sp-browse__own-cell"><input type="checkbox" class="sp-browse__own"' + (isOwned(kind, row.value) ? ' checked' : '') + ' />')
      if (kind === 'armor' && setSiblings(row.value).length > 1) {
        html.push('<button type="button" class="sp-browse__set" title="Own the whole set">set</button>')
      }
      html.push('</td>')

      html.push('<td class="sp-browse__equip-cell">')
      if (here) {
        html.push('<button type="button" class="sp-browse__equip" disabled title="Already in ' + esc(slotById(here) ? slotById(here).label : 'this slot') + '">Equipped</button>')
      } else if (single) {
        html.push('<button type="button" class="sp-browse__equip" data-slot="' + esc(target) + '" title="Put this in ' + esc(slotById(target) ? slotById(target).label : slot.label) + '">Equip</button>')
      } else {
        html.push('<button type="button" class="sp-browse__equip sp-browse__show" data-slot="' + esc(row.slots[0]) + '" title="Open the slots this goes in, so you can pick which one">Show</button>')
      }
      html.push('</td>')

      for (var i = 0; i < columns.length; i++) {
        var column = columns[i]
        var value = row[column.key]
        if (column.text) {
          html.push('<td class="sp-browse__text">' + esc(value) + '</td>')
        } else if (value === undefined || value === null) {
          html.push('<td>\u2013</td>')
        } else {
          var short = column.requirement && value && totalStat(column.key) < value
          html.push('<td' + (short ? ' class="sp-browse__short"' : '') + '>' + Number(value).toFixed(column.digits) + '</td>')
        }
      }
      html.push('</tr>')
    }
    html.push('</table>')

    browseState.shown = rows.map(function (item) {
      return { kind: everything ? item.kind : slot.kind, value: item.value }
    })

    pane.find('.sp-browse__body')[0].innerHTML = html.join('')

    pane.find('.sp-browse__where').text(' · ' + slot.label)
    pane.find('.sp-browse__count').text(
      rows.length + (rows.length === 1 ? ' item' : ' items') + ' · ' + ownedCount() + ' owned'
    )
    pane.find('.sp-browse__fits').prop('disabled', everything ? false : weightBudget(slot) === null)

    /* Naming the count matters most here: in the everything view "all shown" can be every item in
       the game, and the button used to say the same thing whether it meant four pieces or 885. */
    var allShownOwned = rows.length > 0
    for (var m = 0; m < rows.length; m++) {
      if (!isOwned(everything ? rows[m].kind : slot.kind, rows[m].value)) allShownOwned = false
    }
    pane
      .find('.sp-browse__mark')
      .prop('disabled', !rows.length)
      .text((allShownOwned ? 'Unmark ' : 'Mark ') + rows.length + ' shown')

    pane
      .find('#browse-drawer__inventory')
      .text('Copy inventory for an AI (' + ownedCount() + ')')
  }

  /* Its own drawer, not a third pane inside the saved-builds one. Browsing what could go in a
     slot has nothing to do with the builds you have saved, and sharing the panel meant inheriting
     its "Saved builds" heading and a "back to builds" link that made no sense. */
  function buildBrowseDrawer() {
    var markup =
      '<aside id="browse-drawer" class="sp-drawer sp-drawer--browse" aria-hidden="true">' +
      '<header class="sp-drawer__head">' +
      '<h2>Items<span class="sp-browse__where"></span></h2>' +
      '<button type="button" class="sp-drawer__close" title="Close (Esc)" aria-label="Close">&times;</button>' +
      '</header>' +
      '<div class="sp-drawer__body">' +
      '<div class="sp-browse__controls">' +
      '<label class="sp-browse__slot-label">Slot' +
      '<select class="sp-browse__slot"></select>' +
      '</label>' +
      '<input type="search" class="sp-browse__search" placeholder="Search" />' +
      '<label class="sp-browse__fits-label">' +
      '<input type="checkbox" class="sp-browse__fits" /> Only what fits' +
      '</label>' +
      '<label class="sp-browse__fits-label">' +
      '<input type="checkbox" class="sp-browse__owned" /> Only owned' +
      '</label>' +
      '<button type="button" class="sp-action sp-browse__mark">Mark all shown</button>' +
      '<span class="sp-browse__count"></span>' +
      '</div>' +
      '<div class="sp-browse__body"></div>' +
      '</div>' +
      '<footer class="sp-drawer__foot">' +
      '<button class="default" id="browse-drawer__inventory">Copy inventory for an AI</button>' +
      '</footer>' +
      '</aside>'

    var el = $(markup).appendTo(document.body)

    el.find('.sp-drawer__close').on('click', closeBrowse)

    /* The panel that manages what you own is the place to hand it over, rather than the share
       panel, which is about the build. */
    el.find('#browse-drawer__inventory').on('click', function () {
      var count = ownedCount()
      copyToClipboard(inventoryReport())
      toast(count ? 'Copied ' + count + ' owned items' : 'Copied - nothing marked as owned yet')
    })

    el.on('change', '.sp-browse__slot', function () {
      var slot = slotById($(this).val())
      if (!slot) return
      browseState.slot = slot
      browseState.sort = { key: 'name', dir: 1 }
      renderBrowse()
    })

    /* Debounced: a redraw is a few hundred rows of table, and typing "knight" should cost one of
       them rather than six. */
    var searchTimer = null
    el.on('input', '.sp-browse__search', function () {
      if (searchTimer) window.clearTimeout(searchTimer)
      searchTimer = window.setTimeout(function () {
        searchTimer = null
        renderBrowse()
      }, 120)
    })

    el.on('change', '.sp-browse__fits', function () {
      browseState.fits = $(this).is(':checked')
      renderBrowse()
    })

    el.on('change', '.sp-browse__owned', function () {
      browseState.ownedOnly = $(this).is(':checked')
      renderBrowse()
    })

    /* Combined with the search box this is how a set gets marked in one go - type "Fallen
       Knight", mark all four. */
    el.on('click', '.sp-browse__mark', function () {
      var values = browseState.shown || []
      var everyOneOwned = values.length > 0
      for (var i = 0; i < values.length; i++) if (!isOwned(values[i].kind, values[i].value)) everyOneOwned = false
      for (var j = 0; j < values.length; j++) setOwned(values[j].kind, values[j].value, !everyOneOwned)
      syncOwnedButton()
      updateStatus()
      renderBrowse()
      toast((everyOneOwned ? 'Unmarked ' : 'Marked ') + values.length + ' items')
    })

    el.on('click', '.sp-browse__set', function (event) {
      event.stopPropagation()
      var pieces = setSiblings($(this).closest('.sp-browse__row').attr('data-value'))
      var allOwned = true
      for (var i = 0; i < pieces.length; i++) if (!isOwned('armor', pieces[i])) allOwned = false
      for (var j = 0; j < pieces.length; j++) setOwned('armor', pieces[j], !allOwned)
      syncOwnedButton()
      updateStatus()
      renderBrowse()
      toast((allOwned ? 'Unmarked ' : 'Marked ') + pieces.length + '-piece set')
    })

    el.on('change', '.sp-browse__own', function (event) {
      event.stopPropagation()
      var $row = $(this).closest('.sp-browse__row')
      setOwned($row.attr('data-kind'), $row.attr('data-value'), $(this).is(':checked'))
      syncOwnedButton()
      updateStatus()
    })

    /* The checkbox is inside the row, whose click equips - keep them apart. */
    el.on('click', '.sp-browse__own', function (event) {
      event.stopPropagation()
    })

    el.on('click', '.sp-browse th[data-sort]', function () {
      var key = $(this).attr('data-sort')
      if (browseState.sort.key === key) browseState.sort.dir = -browseState.sort.dir
      else browseState.sort = { key: key, dir: key === 'name' ? 1 : -1 }
      renderBrowse()
    })

    /* Equip in place and stay open, so you can try a few against each other. */
    el.on('click', '.sp-browse__equip', function () {
      /* The everything view equips into the slot the item belongs to, which is not the slot the
         table is showing - hence the target on the button rather than reading browseState. */
      var target = $(this).attr('data-slot') || (browseState.slot && browseState.slot.id)
      if (!target || target === ALL_SLOT.id) return
      $('#' + target)
        .val($(this).closest('.sp-browse__row').attr('data-value'))
        .trigger('change.select2')
        .trigger('change')
      /* The change above is what redraws this table, through scheduleBrowseRefresh. */
    })

    /* Where the item fits more than one slot, "Show" hands you over to that family of slots with
       the name already in the search box, so you choose the hand or the finger yourself. */
    el.on('click', '.sp-browse__show', function (event) {
      event.stopPropagation()
      var slot = slotById($(this).attr('data-slot'))
      if (!slot) return
      browseState.slot = slot
      browseState.sort = { key: 'name', dir: 1 }
      el.find('.sp-browse__search').val($(this).closest('.sp-browse__row').find('.sp-browse__text').eq(1).text())
      renderSlotPicker()
      renderBrowse()
    })

    $(document).on('keydown', function (event) {
      if (event.which === 27 && browseIsOpen()) closeBrowse()
    })

    return el
  }

  function shareIsOpen() {
    return $('#share-drawer').hasClass('sp-drawer--open')
  }

  /* The tips were the last thing on a page that is several screens long, under the calculators
     links, which is a strange place for the notes explaining how the planner works. They move into
     a panel of their own so they are one click from the top, and the block at the bottom goes -
     the content is adopted rather than copied, so there is only ever one of it. */
  function buildTipsDrawer() {
    var $source = $('.planner .planner-tips')
    var $list = $source.children('ul')
    if (!$list.length) return false

    var markup =
      '<aside id="tips-drawer" class="sp-drawer" aria-hidden="true">' +
      '<header class="sp-drawer__head">' +
      '<h2>Tips</h2>' +
      '<button type="button" class="sp-drawer__close" title="Close (Esc)" aria-label="Close">&times;</button>' +
      '</header>' +
      '<div class="sp-drawer__body"><p class="sp-tips__hint">How this planner expects to be ' +
      'used - written by the original site, kept as it was.</p></div>' +
      '</aside>'

    var el = $(markup).appendTo(document.body)
    el.find('.sp-drawer__close').on('click', closeTips)
    el.find('.sp-drawer__body').append($list)
    $source.remove()
    return true
  }

  function tipsIsOpen() {
    return $('#tips-drawer').hasClass('sp-drawer--open')
  }

  function openTips() {
    if (!$('#tips-drawer').length) return
    closeDrawer()
    closeBrowse()
    closeShare()
    $('#tips-drawer').addClass('sp-drawer--open').attr('aria-hidden', 'false')
    setPanelOpen('sp-button-tips', 'tips-drawer', true)
  }

  function closeTips() {
    $('#tips-drawer').removeClass('sp-drawer--open').attr('aria-hidden', 'true')
    setPanelOpen('sp-button-tips', 'tips-drawer', false)
  }

  function buildShareDrawer() {
    var markup =
      '<aside id="share-drawer" class="sp-drawer" aria-hidden="true">' +
      '<header class="sp-drawer__head">' +
      '<h2>Share build</h2>' +
      '<button type="button" class="sp-drawer__close" title="Close (Esc)" aria-label="Close">&times;</button>' +
      '</header>' +
      '<div class="sp-drawer__body">' +
      '<p class="sp-share__hint">A picture for posting where a link would not help, the same thing ' +
      'as text, or a full readout to hand to an AI assistant.</p>' +
      '<div class="sp-share__preview"></div>' +
      '</div>' +
      '<footer class="sp-drawer__foot">' +
      '<button class="default" id="share-drawer__png">Download image</button>' +
      '<button id="share-drawer__markdown">Copy as text</button>' +
      '<button id="share-drawer__agent">Copy for an AI</button>' +
      '<button id="share-drawer__link">Copy link</button>' +
      '</footer>' +
      '</aside>'

    var el = $(markup).appendTo(document.body)
    el.find('.sp-drawer__close').on('click', closeShare)

    el.find('#share-drawer__png').on('click', function () {
      var canvas = el.find('.sp-share__preview canvas')[0]
      if (!canvas) return
      canvas.toBlob(function (blob) {
        var url = window.URL.createObjectURL(blob)
        var base = shareSummary && shareSummary.name ? shareSummary.name : 'build'
        var link = $('<a></a>').attr({ href: url, download: base.replace(/[^\w -]+/g, '') + '.png' })
        $(document.body).append(link)
        link[0].click()
        link.remove()
        window.URL.revokeObjectURL(url)
        toast('Image saved')
      })
    })

    el.find('#share-drawer__markdown').on('click', function () {
      if (shareSummary) copyToClipboard(buildMarkdown(shareSummary))
    })

    el.find('#share-drawer__agent').on('click', function () {
      if (shareSummary) copyToClipboard(agentReport(shareSummary))
    })

    el.find('#share-drawer__link').on('click', function () {
      copyToClipboard(shareUrl(currentState()))
    })

    $(document).on('keydown', function (event) {
      if (event.which === 27 && shareIsOpen()) closeShare()
    })

    return el
  }

  var shareSummary = null

  function openShare() {
    if (!$('#share-drawer').length) buildShareDrawer()
    closeDrawer()
    closeBrowse()
    closeTips()

    shareSummary = buildSummary()
    var canvas = drawCard(shareSummary)
    /* Shown at the drawer's width while exporting at full resolution. */
    $(canvas).css({ width: '100%', height: 'auto' })
    $('#share-drawer .sp-share__preview').empty().append(canvas)

    $('#share-drawer').addClass('sp-drawer--open').attr('aria-hidden', 'false')
    setPanelOpen('sp-button-image', 'share-drawer', true)
  }

  function closeShare() {
    $('#share-drawer').removeClass('sp-drawer--open').attr('aria-hidden', 'true')
    setPanelOpen('sp-button-image', 'share-drawer', false)
  }

  function browseIsOpen() {
    return $('#browse-drawer').hasClass('sp-drawer--open')
  }

  function openBrowse(slot) {
    if (!$('#browse-drawer').length) buildBrowseDrawer()
    /* Everything, unless a slot was asked for or one was already being looked at: "where is that
       item" is the question you arrive with more often than "what else fits here". */
    browseState.slot = slot || browseState.slot || ALL_SLOT
    if (!browseState.slot) return

    /* They are all anchored to the same edge, so only one is up at a time. */
    closeDrawer()
    closeShare()
    closeTips()

    renderSlotPicker()

    $('#browse-drawer').addClass('sp-drawer--open').attr('aria-hidden', 'false')
    setPanelOpen('sp-button-browse', 'browse-drawer', true)
    renderBrowse()
  }

  function closeBrowse() {
    $('#browse-drawer').removeClass('sp-drawer--open').attr('aria-hidden', 'true')
    setPanelOpen('sp-button-browse', 'browse-drawer', false)
  }

  function slotById(id) {
    if (id === ALL_SLOT.id) return ALL_SLOT
    for (var i = 0; i < browseSlots.length; i++) if (browseSlots[i].id === id) return browseSlots[i]
    return null
  }

  /* ------------------------------------------------------------------ share card */

  /* A link is the right way to hand a build to someone who will open it. A picture is the right
     way to post one somewhere people are only reading - Discord, Reddit - where a link to a
     planner is a worse answer than the build itself.
     
     Drawn onto a canvas by hand rather than pulling in a DOM-to-image library: no new dependency,
     nothing to break offline, and full control of the layout. */

  var CARD = {
    width: 760,
    pad: 28,
    ink: '#e8e4dc',
    dim: '#8f8a80',
    gold: '#d0a24c',
    rule: '#33312d',
    back: '#171717'
  }

  function attributeSummary() {
    var rows = []
    $('.planner .attributes input, #hollowing, #humanity').each(function () {
      if (!this.id) return
      /* The planner capitalises these in CSS, so the text in the DOM is lowercase and a canvas
         would render it that way. */
      var label = ($('label[for="' + this.id + '"]').text() || this.id).replace(/^./, function (c) {
        return c.toUpperCase()
      })
      var total = $('#' + this.id + '-total').text()
      rows.push({ label: label, value: (total || $(this).val() || '').toString() })
    })
    return rows
  }

  function equipmentSummary() {
    var rows = []
    var lists = adapter.lists || []
    for (var l = 0; l < lists.length; l++) {
      var list = resolveListIds(lists[l])
      if (['armor', 'weapons', 'rings'].indexOf(list.key) === -1) continue

      for (var i = 0; i < list.ids.length; i++) {
        var id = list.ids[i]
        var $select = $('#' + id)
        var value = $select.val()
        var parkedValues = parkedSlotValues(id)
        var empty = emptyValue($select)
        /* Parking an already-empty slot is not worth reporting as "Naked [parked]". */
        if (parkedValues && parkedValues[0] === empty) continue
        if (!parkedValues && value === empty) continue
        var text = optionText($select, parkedValues ? parkedValues[0] : value)
        if (!text) continue

        for (var e = 0; e < list.extras.length; e++) {
          var suffix = list.extras[e]
          var extraValue = parkedValues ? parkedValues[e + 1] : $('#' + id + suffix).val()
          if (extraValue === undefined) continue
          if (suffix === '-reinforce') {
            if (Number(extraValue) > 0) text += ' +' + extraValue
          } else {
            var extraText = optionText($('#' + id + suffix), extraValue)
            if (extraText && !/^no /i.test(extraText)) text += ' (' + extraText + ')'
          }
        }
        rows.push({ label: slotLabel(id), value: text + (parkedValues ? ' [parked]' : '') })
      }
    }
    return rows
  }

  function parkedSlotValues(id) {
    return parked.hasOwnProperty(id) ? parked[id] : null
  }

  function numberSummary() {
    var wanted = ['hp', 'fp', 'stamina', 'equipment-load', 'weight-left', 'poise']
    var rows = readResults(document)
    var out = []
    for (var i = 0; i < rows.length; i++) {
      if (wanted.indexOf(rows[i].id) === -1) continue
      out.push({ label: rows[i].label, value: rows[i].value })
    }
    return out
  }

  function buildSummary() {
    var entry = savedEntry()
    var build = currentBuild()
    var meta = []
    var $class = $('#class')
    if ($class.length) meta.push(optionText($class, build.class_))
    var $gender = $('#gender')
    if ($gender.length) meta.push(optionText($gender, build.gender))
    var covenant = optionText($('#covenant'), build.covenant)
    if (covenant && !/^no /i.test(covenant)) meta.push(covenant)

    return {
      name: entry ? entry.name : 'Unsaved build',
      notes: entry ? entry.notes || '' : '',
      level: build.level,
      game: (document.title || '').replace(/^●\s*/, '').replace(/ Character Planner$/, ''),
      meta: meta.filter(Boolean),
      attributes: attributeSummary(),
      equipment: equipmentSummary(),
      numbers: numberSummary(),
      link: shareUrl(currentState())
    }
  }

  function drawCard(summary) {
    var canvas = document.createElement('canvas')
    var ratio = window.devicePixelRatio || 1
    var pad = CARD.pad
    var colWidth = (CARD.width - pad * 2) / 2

    /* Two side-by-side blocks, so the taller one sets the height of each band. */
    var attrRows = Math.ceil(summary.attributes.length / 2)
    var bodyRows = Math.max(attrRows, summary.numbers.length)
    var height = pad + 40 + 22 + 18 + bodyRows * 20 + 26 + summary.equipment.length * 19 + 30
    if (summary.notes) height += 22

    canvas.width = CARD.width * ratio
    canvas.height = height * ratio
    var ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)

    ctx.fillStyle = CARD.back
    ctx.fillRect(0, 0, CARD.width, height)

    var y = pad + 20
    ctx.fillStyle = CARD.gold
    ctx.font = "22px Aclonica, sans-serif"
    ctx.textAlign = 'left'
    ctx.fillText(summary.name, pad, y)

    ctx.fillStyle = CARD.ink
    ctx.font = '18px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('SL ' + summary.level, CARD.width - pad, y)

    y += 20
    ctx.textAlign = 'left'
    ctx.fillStyle = CARD.dim
    ctx.font = '13px sans-serif'
    ctx.fillText(summary.meta.join('  ·  '), pad, y)

    if (summary.notes) {
      y += 18
      ctx.fillStyle = CARD.dim
      ctx.font = 'italic 12px sans-serif'
      ctx.fillText(summary.notes.slice(0, 90), pad, y)
    }

    y += 14
    ctx.strokeStyle = CARD.rule
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(CARD.width - pad, y)
    ctx.stroke()
    y += 20

    var bodyTop = y
    ctx.font = '13px sans-serif'
    for (var a = 0; a < summary.attributes.length; a++) {
      var col = a < attrRows ? 0 : 1
      var row = a % attrRows
      var x = pad + col * (colWidth / 2)
      ctx.fillStyle = CARD.dim
      ctx.textAlign = 'left'
      ctx.fillText(summary.attributes[a].label, x, bodyTop + row * 20)
      ctx.fillStyle = CARD.ink
      ctx.textAlign = 'right'
      ctx.fillText(summary.attributes[a].value, x + colWidth / 2 - 16, bodyTop + row * 20)
    }

    for (var nIndex = 0; nIndex < summary.numbers.length; nIndex++) {
      var ny = bodyTop + nIndex * 20
      ctx.fillStyle = CARD.dim
      ctx.textAlign = 'left'
      ctx.fillText(summary.numbers[nIndex].label, pad + colWidth, ny)
      ctx.fillStyle = CARD.ink
      ctx.textAlign = 'right'
      ctx.fillText(summary.numbers[nIndex].value, CARD.width - pad, ny)
    }

    y = bodyTop + bodyRows * 20 + 8
    ctx.strokeStyle = CARD.rule
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(CARD.width - pad, y)
    ctx.stroke()
    y += 18

    ctx.font = '13px sans-serif'
    for (var e = 0; e < summary.equipment.length; e++) {
      ctx.fillStyle = CARD.dim
      ctx.textAlign = 'left'
      ctx.fillText(summary.equipment[e].label, pad, y)
      ctx.fillStyle = CARD.ink
      ctx.fillText(summary.equipment[e].value, pad + 82, y)
      y += 19
    }

    ctx.fillStyle = CARD.dim
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(summary.game, pad, height - 12)

    return canvas
  }

  /* A handoff for an assistant, which wants different things from a forum post: everything,
     unambiguously, with the numbers it would otherwise have to ask for. The markdown above is
     deliberately short and pretty; this is deliberately complete. */
  var REQUIREMENT_SHORT = { strength: 'str', dexterity: 'dex', intelligence: 'int', faith: 'fth' }

  /* Everything you have marked as owned, written out for an assistant. The build readout answers
     "what am I wearing"; this answers "what may you suggest", which is the question that stops it
     recommending a weapon you have never found. Grouped the way the game groups it, with the
     numbers that actually decide a choice, and with what is on you right now marked - so it can
     tell owning something from wearing it. */
  function inventoryRows() {
    var lists = adapter.lists || []
    var index = {}
    var rows = []

    for (var l = 0; l < lists.length; l++) {
      var kind = OWN_KINDS[lists[l].key]
      if (!kind) continue
      var resolved = resolveListIds(lists[l])

      for (var i = 0; i < resolved.ids.length; i++) {
        var $select = $('#' + resolved.ids[i])
        if (!$select.length) continue

        /* jshint loopfunc:true */
        ;(function ($slot, slotId, slotKind) {
          var equipped = $slot.val()
          var empty = emptyValue($slot)

          $slot.find('option').each(function () {
            var value = this.value
            if (!value || value === '-1' || value === empty) return
            if (!isOwned(slotKind, value)) return

            var key = slotKind + '|' + value
            if (!index[key]) {
              index[key] = { kind: slotKind, value: value, name: $(this).text(), slots: [], equipped: false }
              rows.push(index[key])
            }
            index[key].slots.push(slotId)
            if (value === equipped) index[key].equipped = true
          })
        })($select, resolved.ids[i], kind)
      }
    }
    return rows
  }

  function inventoryDetail(row) {
    var info = askInfo(row.kind, row.value, row.slots[0])
    if (!info) return ''
    var bits = []
    var unit = (adapter.info && adapter.info.defenceUnit) || ''

    if (info.weight !== undefined && info.weight !== null) bits.push(info.weight.toFixed(1) + ' wt')

    if (row.kind === 'armor') {
      if (info.poise !== undefined && info.poise !== null) bits.push(info.poise.toFixed(1) + ' poise')
      if (info.defence !== undefined && info.defence !== null) {
        bits.push(info.defence.toFixed(1) + unit + (unit ? ' absorption' : ' defence'))
      }
    } else if (row.kind === 'weapon' && info.req) {
      var needs = []
      for (var r = 0; r < REQUIREMENT_KEYS.length; r++) {
        var key = REQUIREMENT_KEYS[r]
        if (info.req[key]) needs.push(info.req[key] + ' ' + REQUIREMENT_SHORT[key])
      }
      if (needs.length) bits.push('needs ' + needs.join('/'))
    } else if (row.kind === 'ring' && info.effects && info.effects.length) {
      bits.push(info.effects.join(' '))
    } else if (row.kind === 'spell') {
      if (info.fp !== undefined && info.fp !== null) bits.push(info.fp + ' FP')
      if (info.slots) bits.push(info.slots + (info.slots === 1 ? ' slot' : ' slots'))
    }
    return bits.join(', ')
  }

  function inventoryReport() {
    var rows = inventoryRows()
    var game = (document.title || '').replace(/^●\s*/, '').replace(/ Character Planner$/, '')
    var lines = []

    if (!rows.length) {
      return (
        'I have not marked anything as owned in my ' + game + ' planner yet, so treat my ' +
        'inventory as unknown rather than empty.'
      )
    }

    lines.push(
      'Here is my ' + game + ' inventory, exported from a planner: ' + rows.length +
      ' items I have marked as owned. Please only suggest gear from this list, and use these ' +
      'exact numbers rather than estimating. Items marked (equipped) are what I have on now.'
    )

    /* Grouped by slot where an item only goes in one - a helm is a helm - and by family where it
       could go in several, since naming one of six hands would be arbitrary. */
    var groups = {}
    var order = []
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      var label = row.slots.length === 1 ? slotLabel(row.slots[0]) : BROWSE_GROUPS[row.kind] || row.kind
      if (!groups[label]) {
        groups[label] = []
        order.push(label)
      }
      groups[label].push(row)
    }

    for (var g = 0; g < order.length; g++) {
      var group = groups[order[g]]
      group.sort(function (a, b) {
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
      })

      lines.push('')
      lines.push(order[g].toUpperCase() + ' (' + group.length + ')')
      for (var m = 0; m < group.length; m++) {
        var detail = inventoryDetail(group[m])
        lines.push(
          '  ' + group[m].name + (group[m].equipped ? ' (equipped)' : '') + (detail ? ' - ' + detail : '')
        )
      }
    }

    var missing = unownedInBuild()
    if (missing.length) {
      lines.push('')
      lines.push(
        'NOT IN MY INVENTORY BUT CURRENTLY EQUIPPED: ' + missing.join(', ') +
        ' - I have not marked these as owned, so do not assume I have them.'
      )
    }

    return lines.join('\n')
  }

  function agentReport(summary) {
    var build = currentBuild()
    var lines = []

    lines.push(
      "Here is my " + summary.game + " character, exported from a planner. Please use these exact " +
      'numbers rather than estimating, and tell me if something looks wrong.'
    )
    lines.push('')
    lines.push('CHARACTER')
    lines.push('  Name: ' + summary.name + '   Level: ' + summary.level)
    if (summary.meta.length) lines.push('  ' + summary.meta.join('   '))
    if (summary.notes) lines.push('  Notes: ' + summary.notes)

    lines.push('')
    lines.push('ATTRIBUTES (total, including ring and buff effects)')
    for (var a = 0; a < summary.attributes.length; a++) {
      lines.push('  ' + summary.attributes[a].label + ': ' + summary.attributes[a].value)
    }

    lines.push('')
    lines.push('EQUIPMENT')
    if (!summary.equipment.length) lines.push('  nothing equipped')
    for (var e = 0; e < summary.equipment.length; e++) {
      lines.push('  ' + summary.equipment[e].label + ': ' + summary.equipment[e].value)
    }

    /* Requirements the character does not meet are the single most common reason a build does not
       work, and an assistant cannot infer them from the numbers above. */
    var short = requirementShortfalls()
    if (short.length) {
      lines.push('')
      lines.push('REQUIREMENTS NOT MET')
      for (var r = 0; r < short.length; r++) lines.push('  ' + short[r])
    }

    var toggles = []
    for (var flag in TOGGLE_IDS) {
      if (!TOGGLE_IDS.hasOwnProperty(flag) || !build.hasOwnProperty(flag)) continue
      if (Number(build[flag]) === 1) toggles.push(prettify(flag))
    }
    if (toggles.length) {
      lines.push('')
      lines.push('ACTIVE: ' + toggles.join(', '))
    }

    lines.push('')
    lines.push('RESULTING STATS (calculated by the planner)')
    var results = readResults(document)
    for (var i = 0; i < results.length; i++) {
      lines.push('  ' + results[i].label + ': ' + results[i].value)
    }

    var missing = unownedInBuild()
    if (missing.length || ownedCount()) {
      lines.push('')
      lines.push('INVENTORY')
      lines.push('  ' + ownedCount() + ' items marked as owned.')
      if (missing.length) {
        lines.push('  Equipped but not marked as owned: ' + missing.join(', '))
      }
    }

    lines.push('')
    lines.push('Planner link (opens this exact build): ' + summary.link)
    return lines.join('\n')
  }

  /* Every equipped weapon whose requirements the character does not meet. */
  function requirementShortfalls() {
    var out = []
    var lists = adapter.lists || []
    for (var l = 0; l < lists.length; l++) {
      if (lists[l].key !== 'weapons') continue
      var list = resolveListIds(lists[l])
      for (var i = 0; i < list.ids.length; i++) {
        var $select = $('#' + list.ids[i])
        var value = $select.val()
        if (!value || value === emptyValue($select)) continue
        var info = askInfo('weapon', value)
        if (!info || !info.req) continue
        var lacking = []
        for (var k = 0; k < REQUIREMENT_KEYS.length; k++) {
          var key = REQUIREMENT_KEYS[k]
          var need = info.req[key] || 0
          var have = totalStat(key)
          if (need && have < need) lacking.push(key + ' ' + have + '/' + need)
        }
        if (lacking.length) {
          out.push(slotLabel(list.ids[i]) + ' ' + optionText($select, value) + ' needs ' + lacking.join(', '))
        }
      }
    }
    return out
  }

  function buildMarkdown(summary) {
    var lines = []
    lines.push('**' + summary.name + '** — SL ' + summary.level + ' · ' + summary.game)
    if (summary.meta.length) lines.push(summary.meta.join(' · '))
    if (summary.notes) lines.push('_' + summary.notes + '_')
    lines.push('')

    var stats = []
    for (var a = 0; a < summary.attributes.length; a++) {
      stats.push(summary.attributes[a].label + ' ' + summary.attributes[a].value)
    }
    lines.push('`' + stats.join('  ') + '`')
    lines.push('')

    for (var e = 0; e < summary.equipment.length; e++) {
      lines.push('- **' + summary.equipment[e].label + ':** ' + summary.equipment[e].value)
    }
    lines.push('')

    var numbers = []
    for (var n = 0; n < summary.numbers.length; n++) {
      numbers.push(summary.numbers[n].label + ' ' + summary.numbers[n].value)
    }
    lines.push(numbers.join(' · '))
    lines.push('')
    lines.push(summary.link)
    return lines.join('\n')
  }

  /* -------------------------------------------------------------- owned items */

  /* Marking what you actually have turns the planner from "what is the best build" into "what is
     the best build I can make right now", which is the more useful question mid-playthrough.

     The hard part is not storing it - it is filling it in. Dark Souls 3 alone has 360 armour
     pieces, 305 weapons, 115 rings and 105 spells, and nobody is ticking a thousand boxes. So the
     list fills itself: anything you equip is evidently something you own, and gets marked. The
     browser adds bulk marking on top for when you want to catch up in one go.

     Deliberately excluded: upgrade level. Owning a Falchion is the right granularity; tracking
     "+10 Heavy" would make this a materials tracker, which is a different tool. And owned state
     never travels in a share link - it describes you, not the build. */

  var owned = store.get(KEY.owned, null) || {}
  var ownedFilter = store.get(KEY.ownedFilter, false) === true

  /* An item is its kind as well as its id. The games reuse ids across lists - on Dark Souls 3
     Vilhelm's Helm and the Buckler are both 20000000, and Black Hand Hat and the Torch are both
     23000000 - so an inventory keyed by the bare id had marking a shield mark a helmet, and
     unmarking one unmark the other. */
  var OWN_KINDS = { armor: 'armor', weapons: 'weapon', rings: 'ring', spells: 'spell' }
  var ownKindBySelect = null

  function ownKey(kind, value) {
    return kind + '|' + String(value)
  }

  function kindOfSelect(id) {
    if (!ownKindBySelect) {
      ownKindBySelect = {}
      var lists = adapter.lists || []
      for (var l = 0; l < lists.length; l++) {
        var kind = OWN_KINDS[lists[l].key]
        if (!kind) continue
        var resolved = resolveListIds(lists[l])
        for (var i = 0; i < resolved.ids.length; i++) ownKindBySelect[resolved.ids[i]] = kind
      }
    }
    return ownKindBySelect[id] || null
  }

  function isOwned(kind, value) {
    if (!kind) return false
    return Object.prototype.hasOwnProperty.call(owned, ownKey(kind, value))
  }

  /* "-1" is the planner's marker for an empty slot. It is not a thing you can own, and an old
     inventory had picked up three of them - one per family - which then showed up as a count that
     did not match anything you could see. */
  function ownableValue(value) {
    return !!value && value !== '-1'
  }

  function setOwned(kind, value, on) {
    if (!kind || !ownableValue(value)) return
    if (on) owned[ownKey(kind, value)] = 1
    else delete owned[ownKey(kind, value)]
    store.set(KEY.owned, owned)
  }

  /* Inventories written before ids were qualified carry bare ids. Each is resolved against the
     lists it could have come from; where an id is ambiguous, recording both is the only honest
     reading - it is what the old code meant by that key anyway. */
  function migrateOwned() {
    var bare = []
    var junk = []
    for (var key in owned) {
      if (!Object.prototype.hasOwnProperty.call(owned, key)) continue
      if (!ownableValue(key.split('|').pop())) junk.push(key)
      else if (key.indexOf('|') === -1) bare.push(key)
    }

    for (var j = 0; j < junk.length; j++) delete owned[junk[j]]
    if (!bare.length) {
      if (junk.length) store.set(KEY.owned, owned)
      return
    }

    var lists = adapter.lists || []
    for (var b = 0; b < bare.length; b++) {
      for (var l = 0; l < lists.length; l++) {
        var kind = OWN_KINDS[lists[l].key]
        if (!kind) continue
        /* Every select in the list, not just the first: the four armour slots hold four
           different lists, so probing only the head slot loses every chest, hand and leg piece. */
        var resolved = resolveListIds(lists[l])
        for (var i = 0; i < resolved.ids.length; i++) {
          var $probe = $('#' + resolved.ids[i])
          if (!$probe.length) continue
          /* jshint loopfunc:true */
          var wanted = bare[b]
          if ($probe.find('option').filter(function () { return this.value === wanted }).length) {
            owned[ownKey(kind, wanted)] = 1
            break
          }
        }
      }
      delete owned[bare[b]]
    }
    store.set(KEY.owned, owned)
  }

  /* Armour comes in sets of four spread across four slots, and the browser only shows one slot at
     a time - so searching a set name finds a single piece. The ids encode the set, though:
     19000000 / 19001000 / 19002000 / 19003000 are the Fallen Knight helm, armour, gauntlets and
     trousers, so dividing by 10000 groups them. That turns owning a set into one click instead of
     four searches. Dark Souls 2 keys its items by name rather than number, so there it degrades to
     marking the single piece. */
  /* Worked out once. This used to walk every armour option on every call, and the browser calls
     it once per row while rendering - which is most of what made the everything view take a
     second to draw. */
  var setBuckets = null

  function armourSets() {
    if (setBuckets) return setBuckets
    setBuckets = {}
    if (!adapter.lists || !adapter.lists.length) return setBuckets

    $(adapter.lists[0].selector).each(function () {
      $(this)
        .find('option')
        .each(function () {
          var id = parseInt(this.value, 10)
          if (isNaN(id)) return
          var key = Math.floor(id / 10000)
          if (!setBuckets[key]) setBuckets[key] = []
          if (setBuckets[key].indexOf(this.value) === -1) setBuckets[key].push(this.value)
        })
    })
    return setBuckets
  }

  function setSiblings(value) {
    var id = parseInt(value, 10)
    if (isNaN(id)) return [value]
    var found = armourSets()[Math.floor(id / 10000)]
    return found && found.length ? found : [value]
  }

  function ownedCount() {
    var count = 0
    for (var key in owned) if (owned.hasOwnProperty(key)) count++
    return count
  }

  /* The slots whose contents are things you can own - the same families the browser covers. */
  /* Equipping does not mark anything as owned. It used to - it was the cheapest way to fill the
     list in - but the two are simply not the same claim: planning around a weapon you are working
     towards, or trying a set to see what it would weigh, is the ordinary case, and it would quietly
     tell you that you owned it. Owning is now always something you say, never something inferred
     from what is in a slot.

     Which leaves this: marking everything the build currently uses, in one go, when that is what
     you actually mean. It is offered from the status line whenever a build wears something
     unmarked, and it covers the case the automatic rule was there for. */
  function markEquippedOwned() {
    var marked = 0
    var lists = adapter.lists || []
    for (var l = 0; l < lists.length; l++) {
      if (['armor', 'weapons', 'rings', 'spells'].indexOf(lists[l].key) === -1) continue
      var list = resolveListIds(lists[l])
      for (var i = 0; i < list.ids.length; i++) {
        var $select = $('#' + list.ids[i])
        var value = $select.val()
        if (!value || value === '-1' || value === emptyValue($select)) continue
        if (isOwned(OWN_KINDS[lists[l].key], value)) continue
        setOwned(OWN_KINDS[lists[l].key], value, true)
        marked++
      }
      /* Parked slots hold something you own too - it is just not on you right now. */
      for (var p in parked) {
        var parkedKind = kindOfSelect(p)
        if (parked.hasOwnProperty(p) && parked[p][0] && parkedKind && !isOwned(parkedKind, parked[p][0])) {
          setOwned(parkedKind, parked[p][0], true)
          marked++
        }
      }
    }
    return marked
  }

  function unownedInBuild() {
    var missing = []
    var lists = adapter.lists || []
    for (var l = 0; l < lists.length; l++) {
      if (['armor', 'weapons', 'rings', 'spells'].indexOf(lists[l].key) === -1) continue
      var list = resolveListIds(lists[l])
      for (var i = 0; i < list.ids.length; i++) {
        var $select = $('#' + list.ids[i])
        var value = $select.val()
        if (!value || value === '-1' || value === emptyValue($select)) continue
        if (!isOwned(OWN_KINDS[lists[l].key], value)) missing.push(optionText($select, value) || value)
      }
    }
    return missing
  }

  /* Reads ownedFilter at call time, so toggling the filter takes effect without rebuilding any
     of the dropdowns. */
  function matchOne(term, data, $select) {
    if (!data || data.id === undefined) return null
    if (term && String(data.text).toLowerCase().indexOf(term) === -1) return null
    if (!ownedFilter) return data
    if (!data.id || data.id === '-1') return data
    /* Whatever is equipped stays selectable even if you have not marked it. */
    if (String($select.val()) === String(data.id)) return data
    return isOwned(kindOfSelect($select.attr('id')), data.id) ? data : null
  }

  function makeMatcher($select) {
    return function (params, data) {
      var term = $.trim(params.term || '').toLowerCase()
      if (data.children) {
        var kept = []
        for (var i = 0; i < data.children.length; i++) {
          var child = matchOne(term, data.children[i], $select)
          if (child) kept.push(child)
        }
        if (!kept.length) return null
        var group = $.extend({}, data, true)
        group.children = kept
        return group
      }
      return matchOne(term, data, $select)
    }
  }

  function syncOwnedButton() {
    var $button = $('#sp-button-owned')
    $button
      .toggleClass('sp-button--active', ownedFilter)
      .attr('aria-pressed', ownedFilter ? 'true' : 'false')
      .attr(
        'title',
        ownedFilter
          ? 'Showing only what you own (' + ownedCount() + ' marked) - click to show everything'
          : 'Show only items you own (' + ownedCount() + ' marked)'
      )
    $button.find('.material-icons').first().text(ownedFilter ? 'toggle_on' : 'toggle_off')
  }

  function toggleOwnedFilter() {
    ownedFilter = !ownedFilter
    store.set(KEY.ownedFilter, ownedFilter)
    syncOwnedButton()
    updateStatus()
    if ($('#browse-drawer').length) renderBrowse()
    toast(ownedFilter ? 'Showing only what you own' : 'Showing everything')
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

  /* Quiet, not a warning: planning around something you have not picked up yet is a normal thing
     to do, and the tool should not nag about it. */
  /* The status was one run-on sentence: a bare dot, the build name, a count, a list of field
     names and a note about unowned gear, all the same size and colour, with two different things
     happening depending on where in it you clicked and nothing saying so. It is now a state chip
     that names its own state, the build it refers to, and the actions as actual buttons. */
  var STATUS_STATES = {
    draft: { icon: 'radio_button_unchecked', word: 'Draft' },
    saved: { icon: 'check_circle', word: 'Saved' },
    dirty: { icon: 'edit', word: 'Unsaved' }
  }

  function statusState(kind, title) {
    var look = STATUS_STATES[kind]
    return $('<span class="sp-status__state"></span>')
      .attr('title', title)
      .append($('<i class="material-icons"></i>').text(look.icon))
      .append($('<span></span>').text(look.word))
  }

  function statusAction(label, title, handler) {
    return $('<button type="button" class="sp-status__action"></button>')
      .text(label)
      .attr('title', title)
      .on('click', handler)
  }

  /* Its own line with its own button: what you own has nothing to do with whether the build is
     saved, and the two were sharing a sentence. */
  function noteMissing(chip, missing) {
    if (!missing.length) return

    $('<div class="sp-status__line sp-status__missing"></div>')
      .append($('<i class="material-icons"></i>').text('error_outline'))
      .append(
        $('<span></span>')
          .text(missing.length + (missing.length === 1 ? ' item' : ' items') + " in this build you have not marked as owned")
          .attr('title', missing.join('\n'))
      )
      .append(statusAction('Mark them owned', 'Add all of them to your inventory', function () {
        var marked = markEquippedOwned()
        syncOwnedButton()
        updateStatus()
        if ($('#browse-drawer').length) renderBrowse()
        toast(marked ? 'Marked ' + marked + ' items as owned' : 'Nothing left to mark')
      }))
      .appendTo(chip)
  }

  function updateStatus() {
    var chip = $('#sp-status')
    if (!chip.length) return

    var entry = savedEntry()
    var missing = unownedInBuild()
    updateDescription(entry)
    chip.removeClass('sp-status--draft sp-status--saved sp-status--dirty').empty()

    var line = $('<div class="sp-status__line"></div>').appendTo(chip)

    if (!entry) {
      chip.addClass('sp-status--draft')
      line
        .append(statusState('draft', 'Kept in this browser and in the address bar, but not under a name'))
        .append($('<span class="sp-status__name"></span>').text('This build has no name yet'))
        .append(statusAction('Save it', 'Give this build a name (Ctrl+S)', function () {
          saveCurrent(false)
          updateStatus()
        }))
      noteMissing(chip, missing)
      document.title = baseTitle
      return
    }

    var changes = diffBuilds(stateOf(entry), currentState())

    if (!changes.length) {
      chip.addClass('sp-status--saved')
      line
        .append(statusState('saved', 'Matches the build you saved'))
        .append($('<span class="sp-status__name"></span>').text(entry.name))
        .append($('<span class="sp-status__when"></span>').text('saved ' + relativeTime(entry.updatedAt)))
        .append(statusAction('Your builds', 'Load, rename or compare your saved builds', openDrawer))
      noteMissing(chip, missing)
      document.title = baseTitle
      return
    }

    /* Naming the fields is the difference between "something changed" and knowing whether you
       still care. The full before/after stays in the tooltip. */
    var names = []
    var detail = []
    for (var c = 0; c < changes.length; c++) {
      names.push(changes[c].label)
      detail.push(changes[c].label + ': ' + changes[c].a + ' \u2192 ' + changes[c].b)
    }

    var shown = names.slice(0, 3).join(', ')
    if (names.length > 3) shown += ' +' + (names.length - 3) + ' more'

    chip.addClass('sp-status--dirty')
    line
      .append(statusState('dirty', 'Differs from the build you saved'))
      .append($('<span class="sp-status__name"></span>').text(entry.name))
      .append(
        $('<span class="sp-status__count"></span>')
          .text(changes.length + (changes.length === 1 ? ' change' : ' changes'))
      )
      .append(statusAction('Save', 'Overwrite ' + entry.name + ' (Ctrl+S)', function () {
        saveCurrent(true)
        updateStatus()
      }))
      .append(statusAction('See what changed', 'Compare this against the saved build', function () {
        openDrawer()
        runCompare(
          { name: entry.name + ' (saved)', state: stateOf(entry) },
          { name: 'Current build', state: currentState() }
        )
      }))

    $('<div class="sp-status__line sp-status__fields"></div>')
      .attr('title', detail.join('\n'))
      .append($('<span class="sp-status__fields-label"></span>').text('Changed'))
      .append($('<span></span>').text(shown))
      .appendTo(chip)

    noteMissing(chip, missing)
    /* Visible in the tab strip, which matters when several planners are open at once. */
    document.title = '\u25cf ' + baseTitle
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
    /* "LH1" is the planner's own shorthand, and it is opaque anywhere the slot is named on its
       own - a picker, a share card, the readout for an assistant. */
    var hand = id.match(/^([lr])h(\d)$/)
    if (hand) return (hand[1] === 'l' ? 'Left hand ' : 'Right hand ') + hand[2]
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
    closeBrowse()
    closeShare()
    closeTips()
    if (!$('#builds-drawer').length) {
      buildDrawer()
      $('#builds-drawer .sp-sort').val(store.get(KEY_SORT, 'recent'))
    }
    renderRows()
    $('#builds-drawer').addClass('sp-drawer--open').attr('aria-hidden', 'false')
    setPanelOpen('sp-button-builds', 'builds-drawer', true)
  }

  function closeDrawer() {
    showList()
    $('#builds-drawer').removeClass('sp-drawer--open').attr('aria-hidden', 'true')
    setPanelOpen('sp-button-builds', 'builds-drawer', false)
  }

  function toggleDrawer() {
    if (drawerIsOpen()) closeDrawer()
    else openDrawer()
  }

  /* Ten unlabelled icons crammed into the ~140px beside the class dropdown was a guessing game.
     The actions now live in their own full-width bar under the page title, where there is room to
     label every one of them and group related ones together. The planner's own new/reset buttons
     move in too, so every action is in one place rather than split across two. */

  var TOOLBAR_GROUPS = [
    {
      name: 'build',
      buttons: [
        { adopt: 'button-new', kind: 'action', icon: 'add', label: 'New', title: 'Start a fresh build in a new tab' },
        { adopt: 'button-reset', kind: 'danger', icon: 'refresh', label: 'Reset', title: 'Clear this build and start over' },
        { id: 'sp-button-undo', kind: 'action', icon: 'undo', label: 'Undo', title: 'Undo (Ctrl+Z)', action: function () { stepHistory(-1) } },
        { id: 'sp-button-redo', kind: 'action', icon: 'redo', label: 'Redo', title: 'Redo (Ctrl+Shift+Z)', action: function () { stepHistory(1) } }
      ]
    },
    {
      name: 'saved',
      buttons: [
        { id: 'sp-button-save', kind: 'action', icon: 'save', label: 'Save', title: 'Save this build (Ctrl+S)', action: function () { saveCurrent(false) } },
        { id: 'sp-button-share', kind: 'action', icon: 'link', label: 'Copy link', title: 'Copy a link to this exact build', action: function () { copyToClipboard(shareUrl(currentState())) } }
      ]
    },
    {
      name: 'view',
      buttons: [
        /* A switch, not a panel: it stays on across pages and reloads until you turn it off, so it
           gets a switch's icon rather than the same treatment as a drawer that happens to be
           open. */
        { id: 'sp-button-owned', kind: 'switch', icon: 'toggle_off', label: 'Owned only', title: 'Show only items you own', action: toggleOwnedFilter }
      ]
    },
    /* The three panel buttons sit apart from the rest, over on the side the panels come in from.
       Where a button is says more about what it does than any glyph on it can: everything on the
       left happens to your build the moment you click it, everything on the right opens a panel
       against the right-hand edge. */
    {
      name: 'panels',
      side: 'right',
      buttons: [
        { id: 'sp-button-builds', kind: 'panel', icon: 'folder', label: 'Builds', title: 'Your saved builds', action: toggleDrawer },
        { id: 'sp-button-browse', kind: 'panel', icon: 'table_rows', label: 'Items', title: 'Browse and compare everything for a slot', action: function () { if (browseIsOpen()) closeBrowse(); else openBrowse() } },
        { id: 'sp-button-image', kind: 'panel', icon: 'image', label: 'Share', title: 'Share as an image, as text, or for an AI assistant', action: function () { if (shareIsOpen()) closeShare(); else openShare() } },
        { id: 'sp-button-tips', kind: 'panel', icon: 'help_outline', label: 'Tips', title: 'How the planner expects to be used', action: function () { if (tipsIsOpen()) closeTips(); else openTips() } }
      ]
    }
  ]

  /* A panel that slides over the button that opened it is a magic trick rather than an interface:
     press Items and the button - along with most of the planner - disappears underneath 780px of
     table. So where the window has room the page steps aside instead of being covered, which puts
     the button right beside the panel it just opened. Where it does not, it overlays as before,
     because that is all a narrow screen can do. */
  var pushedDrawer = null

  function layoutForDrawer(drawerId, open) {
    var root = $('.modal-overlay')
    var planner = $('.planner')
    if (!root.length || !planner.length) return
    var width = open ? $('#' + drawerId).outerWidth() : 0
    /* Measured, not assumed: the drawers are different widths and the planner is a fixed 958px, so
       whether both fit is a question about this window rather than a breakpoint. */
    var fits = open && window.innerWidth - width >= planner.outerWidth() + 40
    root.toggleClass('sp-pushed', !!fits)
    root.css('padding-right', fits ? width + 'px' : '')
  }

  /* One place that knows how an open panel looks, so the three of them cannot drift apart. */
  function setPanelOpen(id, drawerId, open) {
    var $button = $('#' + id)
    if ($button.length) {
      $button.toggleClass('sp-button--active', open).attr('aria-expanded', open ? 'true' : 'false')
      $button.find('.sp-tool__close').remove()
      if (open) $button.append($('<i class="material-icons sp-tool__close"></i>').text('close'))
    }
    if (open) pushedDrawer = drawerId
    else if (pushedDrawer === drawerId) pushedDrawer = null
    layoutForDrawer(drawerId, open)
  }

  $(window).on('resize', function () {
    if (pushedDrawer) layoutForDrawer(pushedDrawer, true)
  })

  function toolbarButton(spec) {
    /* The planner's own buttons are moved rather than recreated, so its handlers survive. */
    var $button = spec.adopt ? $('#' + spec.adopt) : $('<button type="button"></button>').attr('id', spec.id)
    if (spec.adopt) $button.empty().removeClass('material-icons')

    $button
      .addClass('sp-tool')
      .addClass('sp-tool--' + (spec.kind || 'action'))
      .attr('title', spec.title)
      .append($('<i class="material-icons"></i>').text(spec.icon))
      .append($('<span class="sp-tool__label"></span>').text(spec.label))

    /* No caret on panel buttons: a downward chevron promises a menu dropping down, and what
       actually happens is a panel sliding in from the right. Instead the button says what the
       click will do - it picks up a close mark once its panel is open, see setPanelOpen. */

    if (spec.action) $button.on('click', spec.action)
    return $button
  }

  /* The three blocks at the bottom of a planner - the optimiser buttons, the tool links and the
     tips - were left at browser defaults by the mirror. The styling is in the stylesheet; what has
     to happen here is the part CSS cannot do: say what the two buttons are for, drop a container
     that is now always empty, label the link list, and make the tips header work from the
     keyboard. The bundle owns the tips toggle itself, including remembering it, so this only
     forwards a keypress to the click it already listens for. */
  function polishFooter() {
    var OPTIMISERS = {
      'button-optimal-armor': {
        icon: 'shield',
        label: 'Find optimal armor',
        title: 'Pick the armour set with the best absorption for the weight you have left'
      },
      'button-optimal-class': {
        icon: 'person_search',
        label: 'Find optimal class',
        title: 'Work out which starting class reaches these stats for the fewest levels'
      }
    }

    for (var id in OPTIMISERS) {
      if (!Object.prototype.hasOwnProperty.call(OPTIMISERS, id)) continue
      var spec = OPTIMISERS[id]
      var $button = $('#' + id)
      if (!$button.length) continue
      $button
        .empty()
        .attr('title', spec.title)
        .append($('<i class="material-icons"></i>').text(spec.icon))
        .append($('<span></span>').text(spec.label))
    }

    /* The planner ships a second, empty div beside the buttons; with the row now laid out as flex
       it shows up as a gap. */
    $('.planner .footer .controls > div').filter(function () {
      return !$.trim($(this).html())
    }).remove()

    var $links = $('.planner .footer .links')
    if ($links.length && !$links.prev('.sp-links-caption').length) {
      $('<div class="sp-links-caption"></div>').text('More tools for this game').insertBefore($links)
    }
  }

  function buildToolbar() {
    var planner = $('.planner')
    if (!planner.length) return

    var bar = $('<div id="sp-toolbar"></div>')
    var actions = $('<div class="sp-toolbar__actions"></div>').appendTo(bar)

    for (var g = 0; g < TOOLBAR_GROUPS.length; g++) {
      var group = $('<div class="sp-toolbar__group"></div>')
      if (TOOLBAR_GROUPS[g].side === 'right') group.addClass('sp-toolbar__group--panels')
      for (var b = 0; b < TOOLBAR_GROUPS[g].buttons.length; b++) {
        toolbarButton(TOOLBAR_GROUPS[g].buttons[b]).appendTo(group)
      }
      group.appendTo(actions)
    }

    /* The status belongs with the actions that change it, not stranded under the class field. */
    /* No handlers here any more: every action in the status is a button that says what it does,
       rather than a click somewhere on a line that did different things in different places. */
    $('<div id="sp-status" class="sp-status"></div>').appendTo(bar)

    var caption = planner.children('.page-caption')
    if (caption.length) bar.insertAfter(caption)
    else planner.prepend(bar)

    updateStatus()
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

    /* Before anything reads the inventory - the toolbar draws the status from it. */
    migrateOwned()

    /* Before the toolbar, so the button can be dropped when a page has no tips to show. */
    var hasTips = buildTipsDrawer()
    buildToolbar()
    if (!hasTips) $('#sp-button-tips').remove()
    polishFooter()
    syncHistoryButtons()
    syncOwnedButton()
    rebindStockButtons()
    buildToggles()
    applyParked(restoredParked)
    registerBrowseSlots()
    decorateDropdowns()

    warmBrowseCache()

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

    /* The browser is a view of the planner, so it has to follow it. Changing the Head dropdown in
       the planner while the table is open left the old row marked "Equipped" and the slot picker
       naming an item no longer in the slot. It is not only the slot's own dropdown either: a stat
       change moves which requirements are shown in red, and a weight change moves what "Only what
       fits" hides, so any planner change is a reason to redraw. */
    $('.planner').on('change', 'select, input', scheduleBrowseRefresh)

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
