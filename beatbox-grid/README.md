# Beatbox → Drum Grid

A single-page web app that records your vocal beatboxing and turns it into a
Logic-style step-sequencer pattern (Hi-hat / Snare / Kick, 16 steps per bar).
It uses plain HTML, CSS and JavaScript, with no build step, no backend and no
dependencies.

## How to start

1. Open `beatbox-grid/index.html` in Chrome (double-click it, or drag it into
   a Chrome window). No server is needed.
2. Click **Record** (or press `R`) and allow microphone access when Chrome asks.
3. Beatbox a bar or more, then click **Stop**:
   - **Kick**: "boom", "bum" (low and dark)
   - **Snare**: "ka", "pam", "tam", "da" (mid-range burst)
   - **Hi-hat**: "ts", "tss", "chh" (bright hiss)
4. The grid fills in. Click **Play pattern** (or press `Space`) to hear it with
   synthesised drums. Tick **play recording along** to hear your voice over it.

Tips: start on beat 1 and keep a steady tempo. Leave a short gap between hits,
and use headphones if you play audio while recording. You can also use
**Load audio file…** to analyse an existing recording.

> If Chrome refuses the microphone on `file://` (some managed or enterprise
> setups block it), serve the folder locally instead:
> `cd beatbox-grid && python3 -m http.server 8000`, then open
> <http://localhost:8000>.

## Controls

| Control | What it does |
|---|---|
| Record / Stop | Captures raw microphone audio. Echo cancellation, noise suppression and auto-gain are turned off because they smear percussive sounds. |
| Play recording | Plays back what you recorded. Click anywhere on the waveform to play from that point. |
| Hit sensitivity | Sets how easily a sound counts as a hit. Raise it if quiet hits are missed, lower it if you get extra hits. |
| BPM | The detected tempo. Edit it to re-quantise and redraw the grid. ÷2 / ×2 fix half-time or double-time guesses, and **Auto** goes back to the detected value. |
| Shift ◀ ▶ | Moves the whole pattern one 16th step earlier or later, in case beat 1 landed in the wrong place. |
| Grid cells | Click a cell to toggle a hit. To fix a wrong label, click the wrong cell off and the correct cell on in the same column. The hit then keeps its recorded timing, so the fix survives BPM changes. |
| Reset edits | Discards your grid edits and goes back to the detected labels. |

Hover over a lit cell to see when the hit happened and its spectral features.

## How it works (`analysis.js`)

1. **Spectrogram**: STFT with a 1024-sample Hann window and a 256-sample hop
   (about 5 ms).
2. **Onset detection**: log-compressed spectral flux (the sum of positive
   changes in magnitude per frame). A frame counts as a hit when it beats an
   adaptive threshold (the moving median plus a margin set by the
   sensitivity slider) and is a local peak. Hits closer than 70 ms are merged,
   and hits much quieter than the loudest one are ignored.
3. **Classification**: for about 50 ms after each onset, the app computes
   power in three bands (low 40–300 Hz, mid 300–4000 Hz, high > 4 kHz) and the
   spectral centroid, after subtracting a per-bin background-noise estimate.
   - **Hi-hat**: high-band share ≥ 35 % or centroid ≥ 3.5 kHz.
   - **Kick vs snare**: if the remaining hits split cleanly into a dark group
     and a bright group (an Otsu split on log-centroid), that split is used, so
     it adapts to your voice and microphone. Otherwise fixed thresholds are
     used: low-band share ≥ 45 % or centroid < 650 Hz means kick.
4. **Tempo**: tries every BPM from 60 to 180 and scores how well the gaps
   between nearby hits fit whole 16th notes. The score also counts how well
   kicks and snares line up on beats, with a mild preference for about
   105 BPM to settle half-time or double-time ties. A least-squares fit of
   hit times against their step numbers then refines the result.
5. **Quantisation**: the 16th-note grid's phase is the weighted circular mean
   of the hit times. The 16th that carries the most kick and snare weight
   becomes "on the beat". Bar 1, beat 1 is the first beat at or before your
   first hit. A longer recording gets more bars.

You can tune the thresholds in the `CONFIG` object at the top of
`analysis.js`.

## Tests

The analysis is tested headlessly against synthesised beatbox-like recordings
(voiced "boom", "ka" + vowel, "ts" hiss) at several tempos, with timing jitter
and background noise:

```sh
node beatbox-grid/test/analysis.test.js
```
