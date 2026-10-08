# Pumpt!, the showcase video

A 64-second 1920×1080 @ 30 fps video of the mod for X, made with
[fframes](https://github.com/dmtrKovalenko/fframes) and rendered with the Skia (Metal) backend.

The sprites stay the mod's own pixel art (they are what runs in the terminal); everything around
them gets the HD-2D treatment: light passes screened over the scene, bloom, a vignette, scanlines,
parallax, a camera with snap zooms and shakes, impact frames, 集中線 (concentration lines), kinetic
type in Dela Gothic One, and a chiptune score with every effect baked in.

The cut: a cold open on the night-time Pixi and a record scratch (**THIS IS PIXI.**), a rewind; the
day at the desk (prompt, wait, scroll, the belly); the realization; the build as a split-screen
montage; the title crash; the terminal demo, narrated in steps: you prompt Claude; a System One
model reads the prompt and estimates how hard the job is (a probability per difficulty level, each
level with its exercise); the top probability wins and Pixi does squats; every turn it logs, it
learns, it hillclimbs (the estimator's accuracy over turns, a little Pixi climbing the line to the
plateau); all of it local; the seven levels; the
payoff (a new morning, Pumpt! on Pixi's own monitor, Pixi up and doing the set for real, the
belly going); the bow; the end card. Every caption is a slab in the mod's own arcade lettering in
one of four palettes (`tools/media.mjs` builds them and writes their sizes to `src/slabs.rs`) with
behaviours: slam (titles), rise (narration on a band), stamp (tilted punchlines), rich (a caption of parts, its keyword 1.25× in cyan), pointer (pixel rings and an arrow on a thing), staccato
(a colour, tilt and size per word) and callout (a pointer to something on screen); Dela Gothic One
is kept for the katakana accents.

| file | what |
| --- | --- |
| `src/lib.rs` | the video: the look (defs, light, bloom, sunburst, slams), the cut, the beats |
| `src/main.rs` | the command line (`fframes::cli`) |
| `src/fxtest.rs` | `--title fxtest`: one frame checking what the renderer honours |
| `tools/story.mjs` | the room scene (240 × 135, two layers for parallax), drawn with the mod's own rasterizer |
| `tools/media.mjs` | builds `media/`: clip frames at 512 px, the story layers, the title slabs, the head |
| `tools/music.mjs` | synthesises `media/music.wav`: the score and the SFX at the cut's times |
| `tools/build.sh` | `cargo build` with the dyld workaround below |
| `tools/realign.py` | the workaround: pads a dylib's symbol string pool to 8 bytes |
| `media/*.ttf` | Dela Gothic One (display), DM Sans (small copy), JetBrains Mono (the terminal) |

## Build and render

```sh
brew install pkg-config ffmpeg x264 x265 opus nasm ninja   # fframes links libav statically
node showcase/tools/media.mjs                               # from the repo root
node showcase/tools/music.mjs
sh tools/build.sh --release
touch src/lib.rs                                            # cargo does not watch media/: force the re-embed
cargo run --release -- inspect                              # missing media or fonts, clipped text, panics
cargo run --release -- strip -n 16                          # contact sheet → strip.png
cargo run --release -- frame 1.5s,12.3s,18.3s               # single frames → frames/
cargo run --release -- render -o pumpt.mp4
```

Gotchas learned the hard way: `include_media_dir!` embeds only the top level of `media/`, keyed by
bare file name (hence the flat layout); the embed stores decoded pixels, so the binary is large; an
attribute whose value is a CSS colour name (`id="gold"`) is parsed as a colour by `svgr!`; a
translucent pixel in a story layer composites over the video's background, not the room, so the
layers are flattened in `story.mjs`.

### Why `tools/build.sh`

On macOS 27 (Xcode 27) Apple's `ld` can leave a large dylib's symbol string pool at a file offset
that is only 4-byte aligned, and this macOS's dyld refuses to load such a library
("mis-aligned LINKEDIT string pool"). The `fframes_media_dir_macro` proc-macro (20 MB) hits it,
and rustc reports a proc-macro it cannot load as "can't find crate". `-ld_classic` makes no
difference on this toolchain. `build.sh` builds once, pads the string pool of every proc-macro
dylib in `target/*/deps` (`realign.py`, which then re-signs ad hoc) and builds again. It also
bypasses any `rustc-wrapper` from `~/.cargo/config.toml`, since a cached artifact would skip the fix.
