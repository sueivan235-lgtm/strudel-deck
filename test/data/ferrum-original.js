// ════════════════════════════════════════════════════════════════════
//  FERRUM · hard industrial techno · live set for strudel.cc
// ════════════════════════════════════════════════════════════════════
//  Ctrl+Enter  start / apply code edits          Ctrl+.  stop
//  Sliders act instantly, no Ctrl+Enter needed.
//    Faders: 0 = layer off (it stops generating events, saves CPU).
//    Whole-number sliders switch patterns and sounds.
//  Hard mute: _kick:     Solo: Skick:     (edit the label, Ctrl+Enter)
//  First run downloads Dirt-Samples; give it a few bars to fill in.
//  If the audio crackles, keep layers you are not using at 0.
//  Set map (a route through ~18 minutes) is at the bottom.
// ════════════════════════════════════════════════════════════════════

samples('github:tidalcycles/dirt-samples')

const BPM  = 150       // 145–160
const ROOT = 29        // F1 as a MIDI note; 31 = G1, 27 = D#1
const BEAT = 60 / BPM
setcpm(BPM / 4)

// ─── MACROS ──────────────────────────────────────────────────────────
const MASTER    = slider(0.6, 0, 1.2)       // the browser hard-clips at 0 dB: ease off if it crunches
const HARD      = slider(0.6, 0, 1)        // drive on every distorted layer + crush on perc
const GRIT      = slider(1, 0, 4, 1)       // drive flavour: 0 soft · 1 diode · 2 hard clip · 3 wavefold · 4 chebyshev (3/4 spare the sub)
const FILTER    = slider(0.5, 0, 1)        // DJ filter on everything but the kick: <.5 low-pass · >.5 high-pass
const LOWCUT    = slider(20, 20, 800)      // high-pass on the low bus (rumble, bass, noise, drone)
const PUMP      = slider(0.9, 0, 1)        // sidechain depth; keeps pumping with the kick fader down
const PUMP_REL  = slider(0.25, 0.05, 0.6)  // sidechain recovery (s)
const SPACE     = slider(0.5, 0, 1)        // reverb sends on the fx bus
const ECHO      = slider(0.5, 0, 1)        // dotted-8th delay sends on the fx bus
const BUILD     = slider(0, 0, 1)          // riser + snare roll: push up over 8–16 bars, snap to 0 on the drop
const TRANS     = slider(0, -5, 7, 1)      // key shift (semitones): synth kick, rumble, bass, acid, stabs, drone

// ─── KICK ────────────────────────────────────────────────────────────
const KICK      = slider(0.9, 0, 1.2)
const KICK_SND  = slider(0, 0, 3, 1)       // 0 909 · 1 synth · 2 hardkick · 3 gabba
const KICK_RHY  = slider(0, 0, 5, 1)       // 0 4/4 · 1 pickup · 2 gallop · 3 broken · 4 half-time · 5 8ths
const KICK_N    = slider(0, 0, 5, 1)       // sample variant for sounds 2 and 3
const FILL      = slider(1, 0, 2, 1)       // last bar of every 8: 0 none · 1 drop beat 4 · 2 roll on beat 4

// ─── LOW END · sidechained ───────────────────────────────────────────
const RUMBLE    = slider(0.8, 0, 1.2)      // dark reverb tail on the kick grid, in key
const RUMBLE_LP = slider(160, 60, 500)     // rumble tone (Hz)
const ROLLING   = slider(0, 0, 1.2)        // rolling bass between the kicks
const ROLL_RHY  = slider(0, 0, 4, 1)       // 0 ~xxx · 1 ~x~x · 2 ~~xx · 3 ~xx~ · 4 offbeat
const ROLL_LP   = slider(220, 80, 1200)
const NOISE     = slider(0, 0, 1.2)        // pumping brown-noise bed
const DRONE     = slider(0, 0, 1.2)        // pumping pad, retriggers every 4 bars
const DRONE_CH  = slider(0, 0, 3, 1)       // 0 fifth · 1 flat-2 cluster · 2 minor 7 · 3 moving
const DRONE_LP  = slider(900, 200, 4000)

// ─── TOPS ────────────────────────────────────────────────────────────
const HATS      = slider(0, 0, 1.2)        // 909 closed hats
const HAT_RHY   = slider(0, 0, 3, 1)       // 0 16ths · 1 offbeat 16ths · 2 8ths · 3 euclid 11/16
const HAT_DEC   = slider(1, 0, 5, 1)       // 909 closed-hat decay
const OPENHAT   = slider(0, 0, 1.2)        // offbeat 909 open hat
const OH_DEC    = slider(2, 0, 5, 1)
const RIDE      = slider(0, 0, 1.2)        // 909 ride on 8ths
const CRASH     = slider(0, 0, 1.2)        // bar 1 of every 8
const BREAKS    = slider(0, 0, 1.2)        // chopped amen, low end removed
const BRK_RHY   = slider(0, 0, 2, 1)       // 0 straight · 1 stutter · 2 random
const BRK_SEED  = slider(0, 0, 64, 1)      // new random loop per number

// ─── CLAP / PERC ─────────────────────────────────────────────────────
const CLAP      = slider(0, 0, 1.2)
const CLAP_RHY  = slider(0, 0, 3, 1)       // 0 on 2+4 · 1 with pickup · 2 clap+snare · 3 broken
const PERC      = slider(0, 0, 1.2)        // metallic industrial hits
const PERC_KIT  = slider(0, 0, 3, 1)       // 0 industrial · 1 metal · 2 noise · 3 alternating
const PERC_RHY  = slider(0, 0, 3, 1)       // euclid 5/16 · 7/16 · 9/16 · syncopated
const PERC_SEED = slider(0, 0, 64, 1)      // new random groove per number
const TOMS      = slider(0, 0, 1.2)
const TOM_RHY   = slider(0, 0, 3, 1)       // 0 3-3-2 · 1 offbeat · 2 fill · 3 tribal 16ths

// ─── SYNTHS ──────────────────────────────────────────────────────────
const ACID      = slider(0, 0, 1.2)
const ACID_PAT  = slider(0, 0, 4, 1)       // 0 driver · 1 roller · 2 sparse · 3 three-over-four · 4 climbing
const ACID_LP   = slider(400, 100, 4000)
const ACID_RES  = slider(10, 0, 28)        // ladder resonance; screams near the top
const ACID_ENV  = slider(3, 0, 8)
const STAB      = slider(0, 0, 1.2)
const STAB_SND  = slider(0, 0, 1, 1)       // 0 supersaw chord · 1 rave stab sample
const STAB_RHY  = slider(0, 0, 4, 1)       // 0 bar end · 1 offbeats · 2 euclid · 3 syncopated · 4 every 4 bars
const STAB_LP   = slider(2500, 300, 8000)
const HOOVER    = slider(0, 0, 1.2)        // every other bar

// ─── VOX / FX ────────────────────────────────────────────────────────
const VOX       = slider(0, 0, 1.2)
const VOX_PAT   = slider(0, 0, 3, 1)       // 0 rave:0 every 8 bars · 1 rave:4 end of 4 · 2 rave:5 every 4 · 3 stutter
const RISER     = slider(0.7, 0, 1.2)      // noise riser, follows BUILD
const SNROLL    = slider(0.7, 0, 1.2)      // snare roll, follows BUILD

// ════════════════════════════════════════════════════════════════════
//  ENGINE · no need to touch anything below while playing
// ════════════════════════════════════════════════════════════════════

// channel strip: fader 0 drops the layer's events, fader × MASTER sets its level
const strip = (pat, fader) => pat
  .mask(fader.fmap(v => v > 0.001))
  .postgain(fader.mul(MASTER))

// shared drive stage: HARD sets the amount, GRIT the algorithm
// (the kick and low bus swap wavefold/chebyshev for tanh/cubic so the sub survives)
const DTYPE     = GRIT.pick([0, 4, 2, 6, 8])          // superdough: scurve, diode, hard, fold, chebyshev
const DTYPE_LOW = GRIT.pick([0, 4, 2, 1, 3])          // scurve, diode, hard, soft, cubic
const GRIT_TRIM     = GRIT.pick([1.26, 1, 1, 1.58, 1.35]) // evens out loudness between flavours
const GRIT_TRIM_LOW = GRIT.pick([1.26, 1, 1, 0.9, 0.85])
const drive = (pat, lo, hi, vol = 0.7) => pat
  .distort(HARD.range(lo, hi)).distortvol(GRIT_TRIM.mul(vol)).distorttype(DTYPE)
const driveLow = (pat, lo, hi, vol = 0.7) => pat
  .distort(HARD.range(lo, hi)).distortvol(GRIT_TRIM_LOW.mul(vol)).distorttype(DTYPE_LOW)

// orbit 2 · low bus: ducked by the pump, one dark reverb for the rumble
const lowBus = (pat, verb = 0) => pat
  .room(verb).roomsize(3).roomlp(500).roomdim(80)
  .hpf(LOWCUT).djf(FILTER).orbit(2)

// orbit 3 · fx bus: shared reverb + dotted-8th delay
const fxBus = (pat, verb = 0.3, echo = 0) => pat
  .room(SPACE.mul(verb * 2)).roomsize(2.5).roomlp(9000)
  .delay(ECHO.mul(echo * 2)).delaytime(BEAT * 0.75).delayfeedback(0.45)
  .djf(FILTER).orbit(3)

// orbit 4 · dry tops
const topBus = pat => pat.djf(FILTER).orbit(4)

// ─── kick ────────────────────────────────────────────────────────────
const KICK_SOUNDS = [
  driveLow(s("bd:5"), 3, 7, 0.48),                    // 0 · 909: low tune, long decay
  stack(                                              // 1 · tuned sine with pitch drop + 909 click
    driveLow(note(TRANS.add(ROOT)).s("sine").penv(36).pdecay(0.08).pcurve(1).decay(0.38), 4, 9, 0.52),
    s("bd:22").bpf(3500).velocity(0.8),
  ),
  driveLow(s("hardkick").n(KICK_N), 2.5, 4, 0.41),    // 2 · pre-distorted kicks
  driveLow(s("gabbalouder").n(KICK_N), 2.5, 4, 0.48), // 3 · gabber
]

const KICK_RHYTHMS = [
  "x*4",
  "x x x [x ~ ~ x]",
  "x [~ ~ ~ x] x [~ ~ ~ x]",
  "[x ~ ~ x] [~ ~ x ~] [x ~ ~ x] [~ ~ x ~]",
  "x ~ x ~",
  "x*8",
]
const RHY = KICK_RHY.pick(KICK_RHYTHMS)
const KICK_GRID = FILL.pick([
  RHY,
  RHY.lastOf(8, x => x.mask("1 1 1 0")),
  RHY.lastOf(8, x => x.ply("1 1 1 4")),
])
const KICK_CORE = KICK_SND.pick(KICK_SOUNDS).struct(KICK_GRID)

kick: strip(KICK_CORE.clip(1).orbit(1), KICK)

// silent trigger on the kick grid that ducks the low bus, even with the kick fader down
pump: s("sine").struct(KICK_GRID).decay(0.01).sustain(0).postgain(0)
  .duckorbit(2).duckdepth(PUMP).duckattack(PUMP_REL)
  .mask(PUMP.fmap(v => v > 0.01))

// ─── low end ─────────────────────────────────────────────────────────
// rumble: a tuned sine thump on the kick grid, driven, sent only to the dark reverb
const RUMBLE_SRC = note(TRANS.add(ROOT)).s("sine").penv(24).pdecay(0.1).pcurve(1).decay(0.4)
  .struct(KICK_GRID)
rumble: strip(lowBus(
  driveLow(RUMBLE_SRC.lpf(RUMBLE_LP), 3, 6, 0.09).dry(0),
  1), RUMBLE)

rolling: strip(lowBus(
  driveLow(note(TRANS.add(ROOT)).s("sawtooth")
    .struct(ROLL_RHY.pick(["[~ x x x]*4", "[~ x ~ x]*4", "[~ ~ x x]*4", "[~ x x ~]*4", "[~ x]*4"]))
    .decay(0.09).sustain(0).lpf(ROLL_LP), 3, 6, 0.29)
  ), ROLLING)

noise: strip(lowBus(
  driveLow(s("brown").struct("x*4").clip(1).gain(2.5).lpf(RUMBLE_LP.mul(1.5)), 3, 4.5, 0.18)
  ), NOISE)

drone: strip(lowBus(
  driveLow(note(DRONE_CH.pick(["[0,7,12]", "[0,1,7]", "[0,3,7,10]", "<[0,7] [0,7] [1,8] [-2,5]>/4"])
      .add(TRANS).add(ROOT + 24))
    .s("supersaw").struct("<x ~ ~ ~>").clip(4).attack(1.5).release(2.5)
    .lpf(DRONE_LP), 2.5, 4, 0.11),
  0.35), DRONE)

// ─── tops ────────────────────────────────────────────────────────────
hats: strip(topBus(
  s(HAT_RHY.pick(["hc*16", "[~ hc]*8", "hc*8", "hc(11,16,3)"]))
    .n(HAT_DEC).gain(1.05).velocity("[.55 .75 1 .75]*4").hpf(3000)
    .pan(sine.range(0.4, 0.6).fast(2))
  ), HATS)

openhat: strip(topBus(s("[~ ho]*4").n(OH_DEC).gain(0.7).hpf(3500)), OPENHAT)

ride: strip(topBus(s("cr*8").n(3).gain(0.5).velocity("[.7 1]*4").hpf(3000)), RIDE)   // cr = 909 ride in Dirt-Samples

crash: strip(fxBus(s("<cc:2 ~ ~ ~ ~ ~ ~ ~>").gain(0.4).hpf(400), 0.4), CRASH)

breaks: strip(topBus(
  drive(s("amencutup*16")
    .n(BRK_RHY.pick([run(16), "0 1 2 3 0 1 2 3 8 8 9 9 12 13 14 15", irand(32).segment(16)]))
    .clip(1).hpf(350), 3, 6, 0.145)
    .ribbon(BRK_SEED, 1)
  ), BREAKS)

// ─── clap / perc ─────────────────────────────────────────────────────
clap: strip(fxBus(
  drive(s(CLAP_RHY.pick(["~ cp ~ cp", "~ cp ~ [cp ~ ~ cp]", "~ [cp,sn:51] ~ [cp,sn:51]", "~ ~ [~ cp] ~ ~ ~ cp ~"]))
    .hpf(200), 2.5, 5, 0.23),
  0.35, 0.1), CLAP)

perc: strip(fxBus(
  s(PERC_KIT.pick(["industrial", "metal", "noise2", "<industrial metal>"]))
    .struct(PERC_RHY.pick(["x(5,16)", "x(7,16,2)", "x(9,16,1)", "[~ x ~ x x ~ x ~]*2"]))
    .n(irand(32)).gain(PERC_KIT.pick([0.3, 0.76, 0.62, 0.32])).speed(rand.range(0.8, 1.4))
    .hpf(400).crush(HARD.range(16, 5)).pan(rand)
    .ribbon(PERC_SEED, 2),
  0.2, 0.3), PERC)

toms: strip(fxBus(
  drive(s(TOM_RHY.pick([
    "lt:3 ~ ~ lt:3 ~ ~ lt:3 ~ ~ ~ mt:7 ~ ~ ~ ~ ~",
    "[~ lt:3] [~ mt:7] [~ lt:3] [ht:11 mt:7]",
    "~ ~ ~ ~ ~ ~ ~ ~ lt:3 ~ lt:3 ~ mt:7 mt:7 ht:11 ht:11",
    "[lt:3 lt:3 mt:7 ht:11]*4",
  ])).hpf(60), 3, 6, 0.112),
  0.3, 0.15), TOMS)

// ─── synths ──────────────────────────────────────────────────────────
acid: strip(fxBus(
  drive(note(ACID_PAT.pick([
      "0 0 12 0 0 0 1 0 0 12 0 0 3 0 1 0",
      "0 12 0 3 0 12 0 1 0 12 0 7 0 12 5 3",
      "0 ~ ~ 0 ~ ~ 12 ~ 0 ~ ~ 1 ~ ~ 12 ~",
      "{0 12 1}%16",
      "<[0 0 12 0]*4 [1 1 13 1]*4 [3 3 15 3]*4 [1 1 13 1]*4>",
    ]).add(TRANS).add(ROOT + 12))
    .s("sawtooth").decay(0.13).sustain(0)
    .lpf(ACID_LP).lpq(ACID_RES).lpenv(ACID_ENV).lpdecay(0.12).ftype("ladder")
    .velocity("[1 .6 .8 .6]*4"), 3, 6, 0.163),
  0.1, 0.3), ACID)

const STAB_SOUNDS = [
  drive(note("[0,3,7,12]".add(TRANS).add(ROOT + 24)).s("supersaw").decay(0.22).sustain(0), 2.5, 5, 0.16),
  s("stab").n(4).gain(1.4),
]
stab: strip(fxBus(
  STAB_SND.pick(STAB_SOUNDS)
    .struct(STAB_RHY.pick(["~ ~ ~ [~ x]", "[~ x] ~ [~ x] ~", "x(3,8,2)", "~ x ~ ~ ~ ~ x ~", "<x ~ ~ ~>"]))
    .lpf(STAB_LP),
  0.35, 0.35), STAB)

hoover: strip(fxBus(
  drive(s("<hoover:0 ~ hoover:2 ~ hoover:4 ~ hoover:2 ~>").hpf(150), 2.5, 4, 0.38),
  0.35, 0.25), HOOVER)

// ─── vox / fx ────────────────────────────────────────────────────────
vox: strip(fxBus(
  VOX_PAT.pick([
    s("<rave:0 ~ ~ ~ ~ ~ ~ ~>"),
    s("<~ ~ ~ [~ ~ ~ rave:4]>"),
    s("<[rave:5 ~ ~ ~] ~ ~ ~>"),
    s("<[~ ~ ~ rave:4*4] ~>").end(0.2),
  ]).gain(0.4).hpf(250),
  0.4, 0.45), VOX)

riser: strip(fxBus(
  s("white").seg(16).clip(1).gain(1.8)
    .hpf(BUILD.range(300, 9000)).velocity(BUILD.range(0.1, 1))
    .mask(BUILD.fmap(b => b > 0.02)),
  0.5, 0.3), RISER)

snroll: strip(fxBus(
  drive(s(BUILD.mul(4).pick(["~", "sn:42*4", "sn:42*8", "sn:42*16", "sn:42*32"]))
    .velocity(BUILD.range(0.3, 1)).hpf(BUILD.range(150, 1500)), 2.5, 4.5, 0.097),
  0.3, 0.2), SNROLL)

// ─── SET MAP · about 18 min at 150 BPM (16 bars ≈ 26 s) ──────────────
//  0:00  KICK + RUMBLE alone. OPENHAT, then HATS over 32 bars.
//  1:30  CLAP, PERC (new PERC_SEED every 16–32 bars), ROLLING under the rumble.
//  3:00  ACID pattern 0, open ACID_LP slowly. HARD towards 0.8. RIDE.
//  5:00  Break: KICK fader to 0 (PUMP keeps the low end breathing), DRONE in,
//        FILTER down to ~0.3, then BUILD 0→1 over 16 bars with LOWCUT rising.
//  5:45  Drop: BUILD and LOWCUT back down, FILTER 0.5, KICK_SND 1, STAB, VOX.
//  6:00  Peak 1: TOMS, BREAKS low, ACID_PAT 3, GRIT 3 for a few phrases.
//  9:00  Industrial: ACID out, KICK_RHY 3, PERC_KIT 2, HAT_RHY 3, HARD 1.
// 11:00  Break 2: down to DRONE + NOISE + HOOVER, VOX 3, BUILD again.
// 12:00  Peak 2: KICK_SND 3, TRANS +2, BREAKS stutter, KICK_RHY 5 for 2 bars at phrase ends.
// 15:30  Outro: back to KICK + RUMBLE + PERC, KICK_RHY 4, FILTER down, MASTER out.
