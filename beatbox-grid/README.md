# Beatbox → Drum Grid

A single-page web app that records your vocal beatboxing and turns it into a
Logic-style step-sequencer pattern (Hi-hat / Snare / Kick, 16 steps per bar).
It uses plain HTML, CSS and JavaScript, with no build step, no backend and no
dependencies.

## How to start

1. Open `beatbox-grid/index.html` in Chrome (double-click it, or drag it into
   a Chrome window). No server is needed.
2. Set the **Tempo** (BPM) you want to beatbox at.
3. Click **Record** (or press `R`) and allow microphone access when Chrome
   asks. You get a one-bar count-in (clicks plus a big 1-2-3-4 on screen),
   then the metronome keeps clicking while you record.
4. Beatbox a bar or more, then click **Stop**:
   - **Kick**: "tu" (dark vowel)
   - **Snare**: "ta" (open vowel)
   - **Hi-hat**: "ts" (hiss)
5. The grid fills in, lined up with the metronome's bars. Click
   **Play pattern** (or press `Space`) to hear it with synthesised drums. Tick
   **play recording along** to hear your voice over it.

Tips: headphones work best, but the metronome can also play through the
speaker. Its clicks are pure tones, so the analysis recognises them and
ignores them. Leave a short gap between hits. You can also use
**Load audio file…** to analyse an existing recording.

On a phone the page has to be served over `https://` for microphone access,
for example from GitHub Pages.

> If Chrome refuses the microphone on `file://` (some managed or enterprise
> setups block it), serve the folder locally instead:
> `cd beatbox-grid && python3 -m http.server 8000`, then open
> <http://localhost:8000>.

## Controls

| Control | What it does |
|---|---|
| Record / Stop | Captures raw microphone audio. Echo cancellation, noise suppression and auto-gain are turned off because they smear percussive sounds. |
| Play recording | Plays back what you recorded. Click anywhere on the waveform to play from that point. |
| Tempo (BPM) | Sets the metronome speed before recording and the grid tempo after. Changing it after recording re-quantises and redraws the grid. ÷2 / ×2 halve or double it. |
| Metronome | Clicks on every beat while recording. Beat 1 is accented, and the four lights show the beat. |
| Count-in (1 bar) | Counts 4 clicks before the take starts. The count-in is cut from the recording, and bar 1 of the grid starts right after it. If you come in a bar late, the empty bar is skipped. |
| Detect tempo from recording | Ignores the BPM you set: no metronome or count-in, just beatbox freely, and the tempo is estimated from the spacing of your hits. |
| Hit sensitivity | Sets how easily a sound counts as a hit. Raise it if quiet hits are missed, lower it if you get extra hits. |
| Shift ◀ ▶ | Moves the whole pattern one 16th step earlier or later, in case beat 1 landed in the wrong place. |
| Settings | Tempo, metronome, count-in and tempo detection are remembered in this browser. |
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
   **Metronome bleed**: the clicks are pure sines (2400 Hz on beat 1, 1800 Hz
   on other beats). Their frequencies are left out of the flux. Any remaining
   peak with over 85 % of its energy in those tones is treated as a click and
   dropped, unless it also carries clearly more other energy than the purest
   click (a vocal hit on top of a click).
3. **Classification**: the app skips the first 12 ms after each onset, because
   the "t" consonant sounds the same in "tu", "ta" and "ts". It then looks at
   the next ~70 ms (the vowel or hiss). There it computes power in three bands
   (low 40–300 Hz, mid 300–4000 Hz, high > 4 kHz) and the spectral centroid,
   after subtracting a per-bin background-noise estimate.
   - **Hi-hat**: high-band share ≥ 35 % or centroid ≥ 3.5 kHz.
   - **Kick vs snare**: if the remaining hits split cleanly into a dark group
     and a bright group (an Otsu split on log-centroid), that split is used, so
     it adapts to your voice and microphone. Otherwise fixed thresholds are
     used: low-band share ≥ 45 % or centroid < 650 Hz means kick.
4. **Tempo** (only with *Detect tempo from recording*): tries every BPM from 60 to 180 and scores how well the gaps
   between nearby hits fit whole 16th notes. The score also counts how well
   kicks and snares line up on beats, with a mild preference for about
   105 BPM to settle half-time or double-time ties. A least-squares fit of
   hit times against their step numbers then refines the result.
5. **Quantisation**: the 16th-note grid's phase is the weighted circular mean
   of the hit times, which absorbs consistent latency and timing habits.
   - **With the metronome or count-in**, bar 1 is the metronome's downbeat.
     Its position in the recording is estimated from the audio clock and the
     reported output latency. The app may correct it by up to 2 steps toward
     where the kicks and snares actually are, which covers Bluetooth
     headphone lag.
   - **Without them**, the 16th carrying the most kick and snare weight
     becomes "on the beat", and bar 1 starts at the first beat at or before
     your first hit.

   A longer recording gets more bars.

You can tune the thresholds in the `CONFIG` object at the top of
`analysis.js`.

## Tests

The analysis is tested headlessly against synthesised beatbox-like recordings
at several tempos, with timing jitter and background noise. The sounds are
"tu" / "ta" / "ts" and the older "boom" / "ka" / "ts". Some takes have
metronome clicks leaking into the mic, a count-in, latency up to 200 ms, a
pattern that doesn't start on beat 1, or a late entry:

```sh
node beatbox-grid/test/analysis.test.js
```
