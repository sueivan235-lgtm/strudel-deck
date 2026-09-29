// Built-in songs. A deck preset gives the mixer state and scenes a song starts with.
// Scenes are written as differences: listed layers play (at the given gain), the
// rest are muted; listed controls take the given value, the rest their value in the code.
import ferrum from './ferrum.strudel';
import starter from './starter.strudel';

const ferrumMix = {
  kick: 0.9, pump: 1, rumble: 0.8, rolling: 0.6, noise: 0.5, drone: 0.8,
  hats: 0.5, openhat: 0.45, ride: 0.4, crash: 0.5, breaks: 0.35,
  clap: 0.6, perc: 0.6, toms: 0.45, acid: 0.6, stab: 0.6, hoover: 0.6,
  vox: 0.7, riser: 0.7, snroll: 0.7,
};
const always = { kick: 0.9, pump: 1, rumble: 0.8, riser: 0.7, snroll: 0.7 };
const groove = { ...always, openhat: 0.45, hats: 0.5, clap: 0.6, perc: 0.6, rolling: 0.6 };
const acid = { ...groove, acid: 0.6, ride: 0.4 };

export const BUILTIN = [
  {
    id: 'ferrum',
    name: 'FERRUM',
    about: 'Hard industrial techno, 150 BPM. 20 layers, 37 controls, 8 scenes along an 18-minute route.',
    code: ferrum,
    preset: {
      master: 0.6,
      gains: ferrumMix,
      playing: ['kick', 'pump', 'rumble', 'riser', 'snroll'],
      soloSafe: ['pump'],
      scenes: [
        { name: 'Intro', layers: always },
        { name: 'Groove', layers: groove },
        { name: 'Acid', layers: acid, controls: { ACID_LP: 1000, HARD: 0.7 } },
        {
          name: 'Peak',
          layers: { ...acid, toms: 0.45, breaks: 0.35, crash: 0.5 },
          controls: { ACID_PAT: 1, ACID_LP: 1600, HARD: 0.8 },
        },
        {
          name: 'Break',
          layers: { pump: 1, rumble: 0.8, riser: 0.8, snroll: 0.8, drone: 0.8, noise: 0.5, perc: 0.45 },
          controls: { DRONE_CH: 1, FILTER: 0.32, BUILD: 1, LOWCUT: 500 },
        },
        {
          name: 'Drop',
          layers: { ...always, hats: 0.5, openhat: 0.45, clap: 0.6, perc: 0.6, rolling: 0.7, stab: 0.6, vox: 0.7, crash: 0.5, ride: 0.4 },
          controls: { KICK_SND: 1, CLAP_RHY: 2 },
        },
        {
          name: 'Industrial',
          layers: { ...always, hats: 0.5, openhat: 0.4, perc: 0.7, breaks: 0.4, clap: 0.5, rolling: 0.6 },
          controls: { KICK_RHY: 3, GRIT: 3, HARD: 1, HAT_RHY: 3, PERC_KIT: 2, BRK_RHY: 2, CLAP_RHY: 3, ROLL_RHY: 1 },
        },
        {
          name: 'Gabber',
          layers: {
            ...always, hats: 0.5, openhat: 0.45, ride: 0.45, clap: 0.6, perc: 0.6, rolling: 0.7,
            acid: 0.6, hoover: 0.6, breaks: 0.4, crash: 0.5,
          },
          controls: { KICK_SND: 3, TRANS: 2, HARD: 0.8, ACID_PAT: 3, ACID_LP: 1500, BRK_RHY: 1 },
        },
      ],
    },
  },
  {
    id: 'starter',
    name: 'Starter',
    about: 'A small groove that shows how the deck reads code. Good to copy from.',
    code: starter,
    preset: {
      master: 0.8,
      gains: {},
      playing: null, // everything plays
      soloSafe: [],
      scenes: [
        { name: 'Drums', layers: { kick: 1, hats: 1, openhat: 1, clap: 1 } },
        { name: 'Full', layers: { kick: 1, hats: 1, openhat: 1, clap: 1, bass: 1, chords: 1 } },
        { name: 'Breakdown', layers: { hats: 1, chords: 1 }, controls: { CHORD_SPACE: 0.8 } },
      ],
    },
  },
];

export const BLANK_CODE = `// New song. Layers are  name: pattern  lines; controls are slider() calls.
setcpm(130/4)

// ─── MAIN ───────────────────────────────────────────
const CUTOFF = slider(1200, 200, 8000)   // filter cutoff in Hz

kick: s("bd*4")

hats: s("[~ hh]*4").gain(0.6)

synth: note("c2 [~ c3] eb2 [~ g2]").s("sawtooth").lpf(CUTOFF).decay(0.2).sustain(0)
`;
