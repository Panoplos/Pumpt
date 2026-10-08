//! Pumpt!, the showcase: a 40 s landscape video for X.
//!
//! HD-2D treatment of the mod's own pixel art: the sprites stay pixels (they are
//! what runs in the terminal); the world around them gets light passes, bloom,
//! a vignette, scanlines, parallax, a camera, impact frames, 集中線 and kinetic
//! type (Dela Gothic One), and a chiptune score (media/music.wav, tools/music.mjs).
//!
//! One timeline: a cold open on the night-time Pixi, a record scratch, a rewind;
//! the day at the desk (tools/story.mjs, 240 x 135 in two layers scaled by 8);
//! the realization; the build as a split-screen montage; the title crash; the
//! terminal demo; the seven levels; the bow; the end card. fframes keys embedded
//! media by bare file name, so every file under media/ has a unique one.
use fframes::{
    AudioMap, AudioTimestamp::*, AudioTrack, Color, Duration, FFramesContext, Frame, Svgr, Transform, Video,
    animation::Easing, include_media_dir,
};

include_media_dir!(pub struct ShowcaseMedia, "media");

pub mod fxtest;
mod slabs;
use slabs::SLABS;
mod phone;
use phone::PHONE;

/// X's logo, the official 24 x 24 path.
const X_LOGO: &str = "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";

/// X's logo, `size` px tall, centred on (cx, cy).
fn x_logo<'a>(cx: f32, cy: f32, size: f32, fill: &str) -> Svgr<'a> {
    let k = size / 24.;
    let tf = format!("translate({} {}) scale({k})", cx - size / 2., cy - size / 2.);
    fframes::svgr!(<path d={X_LOGO} transform={tf} fill={fill.to_string()} />)
}

pub const WIDTH: usize = 1920;
pub const HEIGHT: usize = 1080;
pub const LENGTH: f32 = 64.5;

const DISPLAY: &str = "Dela Gothic One";
const FONT: &str = "DM Sans";
const MONO: &str = "JetBrains Mono";
const BG: &str = "#15131f";
const INK: &str = "#f1e9ff";
const MUTED: &str = "#8e86b3";
const GOLD: &str = "#f1be58";
const OUTLINE: &str = "#230438";
const WINDOW: &str = "#101020";
const WINDOW_EDGE: &str = "#2c2550";
const PROMPT_EDGE: &str = "#5a47a3";
const CLIP_FPS: f32 = 12.0;
const W: f32 = WIDTH as f32;
const H: f32 = HEIGHT as f32;

/// The seven exercises, in the mod's order: id, name, frames per cycle.
const EXERCISES: [(&str, &str, usize); 7] = [
    ("neck-roll", "neck rolls", 36),
    ("arm-circles", "arm circles", 14),
    ("jumping-jacks", "jumping jacks", 10),
    ("sit-ups", "sit-ups", 20),
    ("squats", "squats", 22),
    ("push-ups", "push-ups", 18),
    ("burpees", "burpees", 30),
];
const INTRO_FRAMES: usize = 18;
const OUTRO_FRAMES: usize = 36;
const ACT1: usize = 96;
const ACT2: usize = 36;
const ACT3: usize = 48;
const ACT4: usize = 84;

const PROMPT: &str = "refactor the auth module across three services";

// --- the cut, in seconds (the score in tools/music.mjs follows these) ---------------
const STORY_FPS: f32 = 10.0; // the room's acts play a little under the clips' 12, to be followed
const T_STILL: f32 = 0.2; // the night-time Pixi
const T_FREEZE: f32 = 1.0; // the record scratch: THIS IS PIXI.
const T_REWIND: f32 = 2.7;
const T_DAY: f32 = 3.2;
const T_ZOOM: f32 = 13.5; // the snap zoom on the belly
const T_DAY_END: f32 = 15.0;
const T_IDEA: f32 = 16.8; // the bulb
const T_IDEA_END: f32 = 18.6;
const T_BUILD_SPLIT_END: f32 = 21.0;
const T_BUILD_END: f32 = 23.4;
const T_TITLE_END: f32 = 26.0;
const T_TYPING: f32 = 26.4;
const T_TYPED: f32 = 27.9;
const T_SET: f32 = 28.2; // Enter: the band appears, READY? bobs, System One reads the prompt
const T_PICK: f32 = T_SET + 3.4; // the top probability wins: the band's title pops
const T_CHART: f32 = T_SET + 6.6; // the panel becomes the hillclimb
const T_TERMINAL_END: f32 = 43.0;
const T_LEVELS_END: f32 = 49.0;
const T_REAL_END: f32 = 56.0; // the payoff: Pixi exercising for real
const T_BOW_END: f32 = 59.5;

/// The seven levels as the model sees them (hooks/config.js), with the exercise each one gets.
const LEVELS: [&str; 7] = ["trivial", "small", "routine", "moderate", "substantial", "large", "huge"];

pub struct ShowcaseVideo<'a> {
    pub media: &'a ShowcaseMedia,
    /// `--title fxtest` renders the renderer check (src/fxtest.rs) instead of the video.
    fxtest: bool,
}

impl<'a> ShowcaseVideo<'a> {
    pub fn new(media: &'a ShowcaseMedia, title: &str) -> Self {
        Self { media, fxtest: title == "fxtest" }
    }
}

impl std::fmt::Debug for ShowcaseVideo<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ShowcaseVideo").finish()
    }
}

// --- small helpers ------------------------------------------------------------------

/// Frame `i` of a clip that started at `t0`, at the mod's 12 fps; looping, or held on its last frame.
fn clip_at(t: f32, t0: f32, frames: usize, loops: bool) -> Option<usize> {
    clip_at_fps(t, t0, frames, loops, CLIP_FPS)
}
fn clip_at_fps(t: f32, t0: f32, frames: usize, loops: bool, fps: f32) -> Option<usize> {
    if t < t0 {
        return None;
    }
    let i = ((t - t0) * fps).floor() as usize;
    Some(if loops { i % frames } else { i.min(frames - 1) })
}

/// What the band shows: READY? bobbing from `t0` until the verdict at `t_pick`, then the intro, then the exercise cycling.
fn set_at(t: f32, t0: f32, t_pick: f32, ex: &str, ex_frames: usize) -> Option<(String, usize)> {
    if t < t0 {
        return None;
    }
    if t < t_pick {
        return Some(("ready".to_string(), clip_at(t, t0, 12, true)?));
    }
    let i = clip_at(t, t_pick, usize::MAX, false)?;
    Some(if i < INTRO_FRAMES { (format!("{ex}-intro"), i) } else { (ex.to_string(), (i - INTRO_FRAMES) % ex_frames) })
}

/// An embedded picture as true pixels.
fn pic<'a>(ctx: &FFramesContext<'a, '_>, name: &str, x: f32, y: f32, w: f32, h: f32) -> Svgr<'a> {
    match ctx.get_image(name) {
        Some(img) => fframes::svgr!(<image href={img.href()} x={x} y={y} width={w} height={h} image-rendering="optimizeSpeed" />),
        None => fframes::svgr!(<g />),
    }
}
/// A sprite frame, `size` px square.
fn sprite<'a>(ctx: &FFramesContext<'a, '_>, clip: &str, i: usize, x: f32, y: f32, size: f32) -> Svgr<'a> {
    pic(ctx, &format!("{clip}-f{i}.png"), x, y, size, size)
}

fn clock(t: f32, t0: f32) -> String {
    let s = (t - t0).max(0.) as usize;
    format!("{}:{:02}", s / 60, s % 60)
}
const fn smoothstep(u: f32) -> f32 {
    let u = if u < 0. { 0. } else if u > 1. { 1. } else { u };
    u * u * (3. - 2. * u)
}
fn seg(t: f32, a: f32, b: f32) -> f32 {
    ((t - a) / (b - a)).clamp(0., 1.)
}
/// The transform origin that puts scene point `target` at `center` once the scene is scaled by `z` about it.
fn focus_for(target: (f32, f32), center: (f32, f32), z: f32) -> (f32, f32) {
    ((target.0 * z - center.0) / (z - 1.), (target.1 * z - center.1) / (z - 1.))
}
/// A seeded pseudo-random in [0, 1).
fn hash(n: u32) -> f32 {
    let mut x = n.wrapping_mul(747796405).wrapping_add(2891336453);
    x = ((x >> ((x >> 28) + 4)) ^ x).wrapping_mul(277803737);
    ((x >> 22) ^ x) as f32 / u32::MAX as f32
}

// --- the look: defs, light, bloom, grain, type ---------------------------------------

fn defs<'a>() -> Svgr<'a> {
    fframes::svgr!(
        <defs>
            <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22" /></filter>
            <filter id="bloomsmall" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8" /></filter>
            <filter id="smear" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16 0" /></filter>
            <filter id="smearv" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0 14" /></filter>
            <filter id="tilt" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="3" /></filter>
            <filter id="freeze"><feColorMatrix type="saturate" values="0.35" /></filter>
            <radialGradient id="warmglow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffb347" stop-opacity="1" /><stop offset="1" stop-color="#ffb347" stop-opacity="0" /></radialGradient>
            <radialGradient id="coolglow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#9ad5f5" stop-opacity="1" /><stop offset="1" stop-color="#9ad5f5" stop-opacity="0" /></radialGradient>
            <radialGradient id="blueglow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#6fa8ff" stop-opacity="1" /><stop offset="1" stop-color="#6fa8ff" stop-opacity="0" /></radialGradient>
            <radialGradient id="vig" cx="0.5" cy="0.5" r="0.72"><stop offset="0.55" stop-color="#000" stop-opacity="0" /><stop offset="1" stop-color="#000" stop-opacity="0.7" /></radialGradient>
            <linearGradient id="goldgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2b0" /><stop offset="0.45" stop-color="#f1be58" /><stop offset="1" stop-color="#b8842a" /></linearGradient>
            <linearGradient id="creamgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" /><stop offset="1" stop-color="#d9cff0" /></linearGradient>
            <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000" fill-opacity="0.16" /></pattern>
            <clipPath id="floor"><rect x="0" y="830" width="1920" height="250" /></clipPath>
            <clipPath id="panelA"><rect x="0" y="0" width="960" height="1080" /></clipPath>
            <clipPath id="panelB"><rect x="960" y="0" width="960" height="540" /></clipPath>
            <clipPath id="panelC"><rect x="960" y="540" width="480" height="540" /></clipPath>
            <clipPath id="panelD"><rect x="1440" y="540" width="480" height="540" /></clipPath>
        </defs>
    )
}

/// A light: a radial glow screened over the scene.
fn light<'a>(grad: &str, cx: f32, cy: f32, r: f32, opacity: f32) -> Svgr<'a> {
    let fill = format!("url(#{grad})");
    fframes::svgr!(<circle cx={cx} cy={cy} r={r} fill={fill} opacity={opacity} style="mix-blend-mode:screen" />)
}
fn vignette<'a>(opacity: f32) -> Svgr<'a> {
    fframes::svgr!(<rect width={W} height={H} fill="url(#vig)" opacity={opacity} />)
}
fn scanlines<'a>(opacity: f32) -> Svgr<'a> {
    fframes::svgr!(<rect width={W} height={H} fill="url(#scan)" opacity={opacity} />)
}
/// Dust in the air, drifting up through the light.
fn motes<'a>(t: f32, opacity: f32) -> Svgr<'a> {
    let dots: Vec<Svgr<'a>> = (0..14u32)
        .map(|k| {
            let x = hash(k * 7) * W + 60. * (t * 0.25 + k as f32).sin();
            let y = (hash(k * 13 + 1) * H - t * (12. + 10. * hash(k * 3)) * 1.0).rem_euclid(H);
            let r = 2.5 + 3. * hash(k * 5 + 2);
            fframes::svgr!(<circle cx={x} cy={y} r={r} fill="#fff6d6" opacity={opacity * (0.4 + 0.6 * hash(k * 11))} />)
        })
        .collect();
    fframes::svgr!(<g filter="url(#bloomsmall)">{dots}</g>)
}

/// 集中線: wedges from a centre, boiling (a new set every other frame), in `color`.
fn sunburst<'a>(cx: f32, cy: f32, seed: u32, color: &str, opacity: f32, inner: f32) -> Svgr<'a> {
    let n = 56u32;
    let wedges: Vec<Svgr<'a>> = (0..n)
        .map(|k| {
            let a = (k as f32 / n as f32) * std::f32::consts::TAU + 0.02 * hash(seed * 31 + k);
            let len = 1500.;
            let r0 = inner + 220. * hash(seed * 17 + k * 3);
            let wdt = 0.006 + 0.014 * hash(seed * 23 + k * 5);
            let p = |ang: f32, r: f32| (cx + r * ang.cos(), cy + r * ang.sin());
            let (x0, y0) = p(a, r0);
            let (x1, y1) = p(a - wdt, len);
            let (x2, y2) = p(a + wdt, len);
            fframes::svgr!(<polygon points={format!("{x0},{y0} {x1},{y1} {x2},{y2}")} fill={color.to_string()} />)
        })
        .collect();
    fframes::svgr!(<g opacity={opacity}>{wedges}</g>)
}

/// Display type: Dela Gothic, gradient fill, a thick outline under the fill, a slight skew.
fn display<'a>(text: &str, x: f32, y: f32, size: f32, fill: &str, stroke_w: f32, skew: f32, scale: f32, opacity: f32) -> Svgr<'a> {
    let origin = format!("{x} {y}");
    let tf = format!("scale({scale}) skewX({skew})");
    fframes::svgr!(
        <g opacity={opacity} transform={tf} transform-origin={origin}>
            <text x={x} y={y} font-family={DISPLAY} font-size={size} fill={fill.to_string()} stroke={OUTLINE} stroke-width={stroke_w} stroke-linejoin="round" paint-order="stroke" text-anchor="middle">{text.to_string()}</text>
        </g>
    )
}

/// A caption slab (media/title-<name>.png, the mod's own arcade lettering) at `p` screen px per art px, centred on (cx, cy).
fn slab_size(name: &str) -> (f32, f32) {
    SLABS.iter().find(|(n, _, _)| *n == name).map(|(_, w, h)| (*w, *h)).unwrap_or((400., 120.))
}
/// `pal`: gold, cream, blue or pink. `rot` in degrees about the centre.
fn slab<'a>(ctx: &FFramesContext<'a, '_>, name: &str, pal: &str, cx: f32, cy: f32, p: f32, scale: f32, rot: f32, opacity: f32) -> Svgr<'a> {
    let (pw, ph) = slab_size(name);
    let (w, h) = (pw / 4. * p, ph / 4. * p);
    let origin = format!("{cx} {cy}");
    let tf = format!("scale({scale}) rotate({rot})");
    fframes::svgr!(
        <g opacity={opacity} transform={tf} transform-origin={origin}>
            {pic(ctx, &format!("title-{name}-{pal}.png"), cx - w / 2., cy - h / 2., w, h)}
        </g>
    )
}

/// A ring of 8 px pixels (the midpoint circle), `r` px in radius, centred on (cx, cy).
fn pixel_ring<'a>(cx: f32, cy: f32, r: f32, col: &str, opacity: f32) -> Svgr<'a> {
    let rb = (r / 8.).round() as i32;
    let (mut x, mut y, mut err) = (rb, 0i32, 1 - rb);
    let mut cells: Vec<(i32, i32)> = Vec::new();
    while x >= y {
        for (px, py) in [(x, y), (y, x), (-y, x), (-x, y), (-x, -y), (-y, -x), (y, -x), (x, -y)] {
            cells.push((px, py));
        }
        y += 1;
        if err < 0 { err += 2 * y + 1; } else { x -= 1; err += 2 * (y - x) + 1; }
    }
    let rects: Vec<Svgr<'a>> = cells.into_iter().map(|(px, py)| {
        fframes::svgr!(<rect x={cx + px as f32 * 8. - 4.} y={cy + py as f32 * 8. - 4.} width="8" height="8" fill={col.to_string()} />)
    }).collect();
    fframes::svgr!(<g opacity={opacity}>{rects}</g>)
}

/// A pixel arrow pointing down, its tip at (tx, ty), outlined.
fn pixel_arrow<'a>(tx: f32, ty: f32, col: &str) -> Svgr<'a> {
    const ROWS: [&str; 8] = ["..###..", "..###..", "..###..", "..###..", "#######", ".#####.", "..###..", "...#..."];
    let c = 10.;
    let x0 = tx - 3.5 * c;
    let y0 = ty - 8. * c;
    let on = |r: i32, k: i32| r >= 0 && r < 8 && k >= 0 && k < 7 && ROWS[r as usize].as_bytes()[k as usize] == b'#';
    let mut outline: Vec<Svgr<'a>> = Vec::new();
    let mut fill: Vec<Svgr<'a>> = Vec::new();
    for r in -1..9 {
        for k in -1..8 {
            if on(r, k) {
                fill.push(fframes::svgr!(<rect x={x0 + k as f32 * c} y={y0 + r as f32 * c} width={c} height={c} fill={col.to_string()} />));
            } else if on(r - 1, k) || on(r + 1, k) || on(r, k - 1) || on(r, k + 1) {
                outline.push(fframes::svgr!(<rect x={x0 + k as f32 * c} y={y0 + r as f32 * c} width={c} height={c} fill={OUTLINE} />));
            }
        }
    }
    fframes::svgr!(<g>{outline}{fill}</g>)
}

/// A pixel frame: a rectangle outlined in `c` px cells.
fn pixel_frame<'a>(x: f32, y: f32, w: f32, h: f32, c: f32, col: &str, opacity: f32) -> Svgr<'a> {
    let cols = (w / c).round() as i32;
    let rows = (h / c).round() as i32;
    let mut cells: Vec<Svgr<'a>> = Vec::new();
    for k in 0..=cols {
        for r in [0, rows] {
            cells.push(fframes::svgr!(<rect x={x + k as f32 * c} y={y + r as f32 * c} width={c} height={c} fill={col.to_string()} />));
        }
    }
    for r in 1..rows {
        for k in [0, cols] {
            cells.push(fframes::svgr!(<rect x={x + k as f32 * c} y={y + r as f32 * c} width={c} height={c} fill={col.to_string()} />));
        }
    }
    fframes::svgr!(<g opacity={opacity}>{cells}</g>)
}

/// A pixel line of `c` px cells from (x0, y0) to (x1, y1), two cells thick so a diagonal joins edge to edge.
fn pixel_line<'a>(x0: f32, y0: f32, x1: f32, y1: f32, c: f32, col: &str) -> Svgr<'a> {
    let (mut cx, mut cy) = ((x0 / c).round() as i32, (y0 / c).round() as i32);
    let (ex, ey) = ((x1 / c).round() as i32, (y1 / c).round() as i32);
    let (dx, dy) = ((ex - cx).abs(), -(ey - cy).abs());
    let (sx, sy) = (if cx < ex { 1 } else { -1 }, if cy < ey { 1 } else { -1 });
    let mut err = dx + dy;
    let mut cells: Vec<Svgr<'a>> = Vec::new();
    loop {
        cells.push(fframes::svgr!(<rect x={cx as f32 * c} y={cy as f32 * c} width={c} height={c} fill={col.to_string()} />));
        cells.push(fframes::svgr!(<rect x={cx as f32 * c} y={(cy - 1) as f32 * c} width={c} height={c} fill={col.to_string()} />));
        if cx == ex && cy == ey {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy { err += dy; cx += sx; }
        if e2 <= dx { err += dx; cy += sy; }
    }
    fframes::svgr!(<g>{cells}</g>)
}

/// A pixel arrow pointing right on the `c` cell grid, outlined: its shaft (two cells tall) starts at cell column `sx`, rows `sy - 1` and `sy`.
fn pixel_arrow_right<'a>(sx: i32, sy: i32, c: f32, col: &str) -> Svgr<'a> {
    const ROWS: [&str; 8] = ["....#...", "....##..", "....###.", "########", "########", "....###.", "....##..", "....#..."];
    let x0 = sx as f32 * c;
    let y0 = (sy - 4) as f32 * c;
    let on = |r: i32, k: i32| r >= 0 && r < 8 && k >= 0 && k < 8 && ROWS[r as usize].as_bytes()[k as usize] == b'#';
    let mut outline: Vec<Svgr<'a>> = Vec::new();
    let mut fill: Vec<Svgr<'a>> = Vec::new();
    for r in -1..9 {
        for k in -1..9 {
            if on(r, k) {
                fill.push(fframes::svgr!(<rect x={x0 + k as f32 * c} y={y0 + r as f32 * c} width={c} height={c} fill={col.to_string()} />));
            } else if on(r - 1, k) || on(r + 1, k) || on(r, k - 1) || on(r, k + 1) {
                outline.push(fframes::svgr!(<rect x={x0 + k as f32 * c} y={y0 + r as f32 * c} width={c} height={c} fill={OUTLINE} />));
            }
        }
    }
    fframes::svgr!(<g>{outline}{fill}</g>)
}

/// The offset of a camera shake: `amp` px for `frames` frames from `t0`, settling.
fn shake(frame: usize, t: f32, t0: f32, amp: f32, frames: usize) -> (f32, f32) {
    if t < t0 || t >= t0 + frames as f32 / 30. {
        return (0., 0.);
    }
    let k = ((t - t0) * 30.) as usize;
    let fall = 1. - k as f32 / frames as f32;
    let a = amp * fall;
    (a * (hash(frame as u32 * 2) * 2. - 1.), a * (hash(frame as u32 * 2 + 1) * 2. - 1.))
}

impl Video for ShowcaseVideo<'_> {
    const FPS: usize = 30;
    const WIDTH: usize = WIDTH;
    const HEIGHT: usize = HEIGHT;
    const BACKGROUND_COLOR: Color = Color::BLACK;

    fn duration(&self) -> Duration<'_> {
        Duration::Seconds(LENGTH)
    }

    fn audio(&self) -> AudioMap<'_> {
        AudioMap::from([AudioTrack::new("music.wav", Second(0.)..Eof).gain_db(1.5)])
    }

    fn render_frame<'a>(&'a self, frame: Frame, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
        if self.fxtest {
            return crate::fxtest::render(frame, ctx);
        }
        let t = frame.seconds() as f32;
        let fi = frame.index;
        let spring = Easing::Spring { mass: 1.0, stiffness: 190.0, damping: 15.0 };
        let soft = Easing::Spring { mass: 1.0, stiffness: 120.0, damping: 18.0 };
        let (cx, cy) = (W / 2., H / 2.);

        // The text behaviours. `p` is screen px per art px.
        // slam: a gold slab crashing in from large with a spring, for titles and emphasis.
        let slam = |name: &str, t0: f32, t1: f32, p: f32, y: f32| -> Svgr<'a> {
            if t < t0 || t >= t1 {
                return fframes::svgr!(<g />);
            }
            let s = frame.animate(&fframes::timeline!(at t0, animate 2.4_f32 => 1.0, spring));
            slab(ctx, name, "gold", cx, y, p, s.max(0.2), 0., 1.0)
        };
        // rise: cream narration lifting in from below on a dark band, dropping away at the end.
        let rise = |name: &str, t0: f32, t1: f32, p: f32, y: f32| -> Svgr<'a> {
            if t < t0 || t >= t1 {
                return fframes::svgr!(<g />);
            }
            let up = frame.animate(&fframes::timeline!(at t0 => t0 + 0.28, animate 70.0_f32 => 0.0, Easing::EaseOut));
            let fade = frame.animate(&fframes::timeline!(at t0 => t0 + 0.2, animate 0.0_f32 => 1.0, Easing::EaseOut));
            let out = frame.animate(&fframes::timeline!(at t1 - 0.2 => t1, animate 0.0_f32 => 50.0, Easing::EaseIn));
            let gone = frame.animate(&fframes::timeline!(at t1 - 0.2 => t1, animate 1.0_f32 => 0.0, Easing::EaseIn));
            let (pw, ph) = slab_size(name);
            let (w, h) = (pw / 4. * p + 80., ph / 4. * p + 24.);
            fframes::svgr!(
                <g opacity={fade * gone} transform={Transform::translate(0., up + out)}>
                    <rect x={cx - w / 2.} y={y - h / 2.} width={w} height={h} rx="10" fill="#0b0a14" opacity="0.72" />
                    {slab(ctx, name, "cream", cx, y, p, 1., 0., 1.)}
                </g>
            )
        };
        // stamp: a tilted slab slapped down with a flash, for the punchlines.
        let stamp = |name: &str, pal: &str, t0: f32, t1: f32, p: f32, x: f32, y: f32, rot: f32| -> Svgr<'a> {
            if t < t0 || t >= t1 {
                return fframes::svgr!(<g />);
            }
            let s = frame.animate(&fframes::timeline!(at t0 => t0 + 0.12, animate 1.9_f32 => 1.0, Easing::EaseIn));
            let r = frame.animate(&fframes::timeline!(at t0 => t0 + 0.12, animate rot - 14.0 => rot, Easing::EaseIn));
            let flash = if (t0 + 0.1..t0 + 0.17).contains(&t) { 0.9 } else { 0.0 };
            let (pw, ph) = slab_size(name);
            let (w, h) = (pw / 4. * p + 48., ph / 4. * p + 30.);
            let origin = format!("{x} {y}");
            fframes::svgr!(
                <g>
                    <g transform={format!("rotate({r})")} transform-origin={origin.clone()}>
                        <rect x={x - w / 2.} y={y - h / 2.} width={w} height={h} rx="6" fill="#0b0a14" stroke={if pal == "pink" { "#e86a8a" } else { GOLD }} stroke-width="6" opacity={flash + 0.85} />
                    </g>
                    {slab(ctx, name, pal, x, y, p, s, r, 1.)}
                </g>
            )
        };
        // pointer: how a game points at a thing: pixel rings pulsing out of it, a pixel arrow bobbing over it, the label right there.
        let pointer = |name: &str, pal: &str, t0: f32, t1: f32, p: f32, tx: f32, ty: f32| -> Svgr<'a> {
            if t < t0 || t >= t1 {
                return fframes::svgr!(<g />);
            }
            let s = frame.animate(&fframes::timeline!(at t0, animate 0.0_f32 => 1.0, spring));
            let col = if pal == "pink" { "#e86a8a" } else if pal == "blue" { "#9ad5f5" } else { GOLD };
            let (tx, ty) = ((tx / 8.).round() * 8., (ty / 8.).round() * 8.); // on the room's pixel grid
            let rings: Vec<Svgr<'a>> = (0..3u32).map(|k| {
                let u = ((t - t0) * 1.4 + k as f32 / 3.).rem_euclid(1.);
                pixel_ring(tx, ty, 32. + 110. * u, col, (1. - u) * 0.9)
            }).collect();
            let bob = (2. * ((t - t0) * 9.).sin()).round() * 8.;
            let ay = ty - 80. + bob;
            let (pw, ph) = slab_size(name);
            let (w, h) = (pw / 4. * p, ph / 4. * p);
            let ly = ay - 60. - h / 2.;
            fframes::svgr!(
                <g>
                    {rings}
                    <g transform={Transform::scale(s.max(0.01))} transform-origin={format!("{tx} {ty}")}>
                        {pixel_arrow(tx, ay, col)}
                        {pic(ctx, &format!("title-{name}-{pal}.png"), tx - w / 2., ly - h / 2., w, h)}
                    </g>
                </g>
            )
        };
        // rich: a caption of rows of parts, each a slab (name, palette, scale), laid out centred; the keyword parts
        // are bigger and cyan. Returns the drawing and its size.
        let rich = |rows: &[&[(&str, &str, f32)]], x: f32, y: f32, p: f32| -> (Svgr<'a>, f32, f32) {
            let gap = -3. * p; // the slabs' own padding overlaps: 8 art px a side
            let row_gap = -5. * p;
            let sizes: Vec<Vec<(f32, f32)>> = rows.iter().map(|row| row.iter().map(|(n, _, sc)| { let (w, h) = slab_size(n); (w / 4. * p * sc, h / 4. * p * sc) }).collect()).collect();
            let row_h: Vec<f32> = sizes.iter().map(|r| r.iter().map(|s| s.1).fold(0., f32::max)).collect();
            let total_h: f32 = row_h.iter().sum::<f32>() + row_gap * (rows.len() as f32 - 1.);
            let total_w: f32 = sizes.iter().map(|r| r.iter().map(|s| s.0).sum::<f32>() + gap * (r.len() as f32 - 1.)).fold(0., f32::max);
            let mut parts: Vec<Svgr<'a>> = Vec::new();
            let mut yy = y - total_h / 2.;
            for (ri, row) in rows.iter().enumerate() {
                let w: f32 = sizes[ri].iter().map(|s| s.0).sum::<f32>() + gap * (row.len() as f32 - 1.);
                let mut xx = x - w / 2.;
                let cy_row = yy + row_h[ri] / 2.;
                for (pi, (n, pal, sc)) in row.iter().enumerate() {
                    let (pw, ph) = sizes[ri][pi];
                    parts.push(pic(ctx, &format!("title-{n}-{pal}.png"), xx, cy_row - ph / 2., pw, ph));
                    let _ = sc;
                    xx += pw + gap;
                }
                yy += row_h[ri] + row_gap;
            }
            (fframes::svgr!(<g>{parts}</g>), total_w, total_h)
        };
        let rise_rich = |rows: &[&[(&str, &str, f32)]], t0: f32, t1: f32, p: f32, y: f32| -> Svgr<'a> {
            if t < t0 || t >= t1 {
                return fframes::svgr!(<g />);
            }
            let up = frame.animate(&fframes::timeline!(at t0 => t0 + 0.28, animate 70.0_f32 => 0.0, Easing::EaseOut));
            let fade = frame.animate(&fframes::timeline!(at t0 => t0 + 0.2, animate 0.0_f32 => 1.0, Easing::EaseOut));
            let out = frame.animate(&fframes::timeline!(at t1 - 0.2 => t1, animate 0.0_f32 => 50.0, Easing::EaseIn));
            let gone = frame.animate(&fframes::timeline!(at t1 - 0.2 => t1, animate 1.0_f32 => 0.0, Easing::EaseIn));
            let (g, w, h) = rich(rows, cx, y, p);
            let (w, h) = (w + 40., h - 16.);
            fframes::svgr!(
                <g opacity={fade * gone} transform={Transform::translate(0., up + out)}>
                    <rect x={cx - w / 2.} y={y - h / 2.} width={w} height={h} rx="10" fill="#0b0a14" opacity="0.72" />
                    {g}
                </g>
            )
        };
        let slam_rich = |rows: &[&[(&str, &str, f32)]], t0: f32, t1: f32, p: f32, y: f32| -> Svgr<'a> {
            if t < t0 || t >= t1 {
                return fframes::svgr!(<g />);
            }
            let s = frame.animate(&fframes::timeline!(at t0, animate 2.4_f32 => 1.0, spring)).max(0.2);
            let (g, _, _) = rich(rows, cx, y, p);
            fframes::svgr!(<g transform={Transform::scale(s)} transform-origin={format!("{cx} {y}")}>{g}</g>)
        };
        let stamp_rich = |rows: &[&[(&str, &str, f32)]], t0: f32, t1: f32, p: f32, x: f32, y: f32, rot: f32| -> Svgr<'a> {
            if t < t0 || t >= t1 {
                return fframes::svgr!(<g />);
            }
            let s = frame.animate(&fframes::timeline!(at t0 => t0 + 0.12, animate 1.9_f32 => 1.0, Easing::EaseIn));
            let r = frame.animate(&fframes::timeline!(at t0 => t0 + 0.12, animate rot - 14.0 => rot, Easing::EaseIn));
            let flash = if (t0 + 0.1..t0 + 0.17).contains(&t) { 0.9 } else { 0.0 };
            let (g, w, h) = rich(rows, x, y, p);
            let (w, h) = (w + 20., h - 10.);
            let origin = format!("{x} {y}");
            fframes::svgr!(
                <g>
                    <g transform={format!("rotate({r})")} transform-origin={origin.clone()}>
                        <rect x={x - w / 2.} y={y - h / 2.} width={w} height={h} rx="6" fill="#0b0a14" stroke={GOLD} stroke-width="6" opacity={flash + 0.85} />
                    </g>
                    <g transform={format!("scale({s}) rotate({r})")} transform-origin={origin}>{g}</g>
                </g>
            )
        };
        // callout: a small slab with a pointer to something on screen, popping in.
        let callout = |name: &str, pal: &str, t0: f32, t1: f32, p: f32, x: f32, y: f32, tx: f32, ty: f32| -> Svgr<'a> {
            if t < t0 || t >= t1 {
                return fframes::svgr!(<g />);
            }
            let s = frame.animate(&fframes::timeline!(at t0, animate 0.0_f32 => 1.0, spring));
            let col = if pal == "pink" { "#e86a8a" } else if pal == "blue" { "#9ad5f5" } else { GOLD };
            fframes::svgr!(
                <g>
                    <line x1={x} y1={y} x2={tx} y2={ty} stroke={col} stroke-width="4" stroke-dasharray="10 8" opacity={s.min(1.)} />
                    <circle cx={tx} cy={ty} r="9" fill="none" stroke={col} stroke-width="4" opacity={s.min(1.)} />
                    {slab(ctx, name, pal, x, y, p, s.max(0.01), -4., 1.)}
                </g>
            )
        };

        // ---- the story: the room in two layers under a camera, with the light passes ----
        let story = |i: usize, focus: (f32, f32), zoom: f32, day: f32, phone: bool, smear: bool| -> Svgr<'a> {
            let night = seg(day, 0.55, 0.95);
            let g = 1. / zoom.max(1.); // the glows at a zoomed panel, or they wash it out
            let origin = format!("{} {}", focus.0, focus.1);
            let bg_zoom = 1. + (zoom - 1.) * 0.7; // the room moves less than Pixi: depth
            let bg = pic(ctx, &format!("bg-f{i}.png"), 0., 0., W, H);
            let fg = pic(ctx, &format!("fg-f{i}.png"), 0., 0., W, H);
            let smear_url = if smear { "url(#smear)" } else { "none" };
            fframes::svgr!(
                <g>
                    <g transform={Transform::scale(bg_zoom)} transform-origin={origin.clone()}>{bg}</g>
                    <g transform={Transform::scale(zoom)} transform-origin={origin.clone()} filter={smear_url}>
                        {fg}
                        {match PHONE.iter().find(|(f, _, _)| *f == i) {
                            Some((_, px, py)) => x_logo(px * 8., py * 8., 30., "#f1e9ff"),
                            None => fframes::svgr!(<g />),
                        }}
                    </g>
                    // the day's light through the window, the monitor's glow on Pixi, the phone at night
                    <g transform={Transform::scale(zoom)} transform-origin={origin.clone()}>
                        <rect width={W} height={H} fill="#1a1a44" opacity={0.38 * night} style="mix-blend-mode:multiply" />
                        {light("warmglow", 330., 300., 520., 0.7 * (1. - night) * (0.5 + 0.5 * (1. - (day - 0.3).abs() * 2.).max(0.)))}
                        {light("coolglow", 1504., 430., 300., (0.35 + 0.35 * night) * g)}
                        {light("coolglow", 980., 500., 520., 0.22 * night)}
                        {if phone { light("blueglow", 985., 470., 300., 0.3 + 0.55 * night) } else { fframes::svgr!(<g />) }}
                        <g filter="url(#bloom)"><rect x="1328" y="320" width="352" height="208" fill="#9ad5f5" opacity={(0.25 + 0.3 * night) * g} /></g>
                    </g>
                    <g clip-path="url(#floor)" filter="url(#tilt)" opacity="0.9">
                        <g transform={Transform::scale(zoom)} transform-origin={origin.clone()}>{pic(ctx, &format!("fg-f{i}.png"), 0., 0., W, H)}</g>
                    </g>
                    {motes(t, 0.5)}
                    {scanlines(1.0)}
                    {vignette(0.65 + 0.1 * night)}
                </g>
            )
        };

        // ================= 1. the cold open =================
        let cold = if t < T_DAY {
            if t < T_STILL {
                fframes::svgr!(<rect width={W} height={H} fill="#000" />)
            } else if t < T_REWIND {
                // the night-time still, pushed in on; frozen and washed out at the scratch, with the title
                let zoom = 1.25 + 0.14 * seg(t, T_STILL, T_REWIND);
                let frozen = t >= T_FREEZE;
                let (sx, sy) = shake(fi, t, T_FREEZE, 18., 5);
                let flash = if (T_FREEZE..T_FREEZE + 0.07).contains(&t) { 1.0 } else { 0.0 };
                let filt = if frozen { "url(#freeze)" } else { "none" };
                fframes::svgr!(
                    <g transform={Transform::translate(sx, sy)}>
                        <g filter={filt}>{story(ACT1 - 1, (900., 560.), zoom, 0.9, true, false)}</g>
                        {if frozen { sunburst(cx, 330., fi as u32 / 2, "#f1e9ff", 0.4, 520.) } else { fframes::svgr!(<g />) }}
                        {slam("this-is-pixi", T_FREEZE, T_REWIND, 10., 300.)}
                        {display("ピクシー", cx, 440., 54., "url(#creamgrad)", 6., -6., 1., if t > T_FREEZE + 0.25 { 1. } else { 0. })}
                        <rect width={W} height={H} fill="#fff" opacity={flash} />
                    </g>
                )
            } else {
                // the rewind: the day runs backwards fast under tape noise
                let u = seg(t, T_REWIND, T_DAY);
                let i = ((1. - u) * (ACT1 - 1) as f32) as usize;
                let bars: Vec<Svgr<'a>> = (0..3u32).map(|k| {
                    let y = ((t * 900. + k as f32 * 400.) % H).floor();
                    fframes::svgr!(<rect x="0" y={y} width={W} height="14" fill="#fff" opacity="0.18" />)
                }).collect();
                fframes::svgr!(
                    <g>
                        <g filter="url(#smear)">{story(i, (960., 540.), 1.05, 1. - u, false, false)}</g>
                        <rect width={W} height={H} fill="#3a5fcd" opacity="0.18" style="mix-blend-mode:screen" />
                        {bars}
                        <text x="60" y="90" font-family={MONO} font-size="44" fill={INK} opacity="0.9">"◀◀ REW"</text>
                    </g>
                )
            }
        } else {
            fframes::svgr!(<g />)
        };

        // ================= 2. the day =================
        let day = if (T_DAY..T_DAY_END).contains(&t) {
            let u = seg(t, T_DAY, T_DAY_END);
            let i = ((u * ACT1 as f32) as usize).min(ACT1 - 1);
            let phone = (18..50).contains(&i) || i >= 62;
            let zooming = t >= T_ZOOM;
            let zoom = if zooming { 2.4 } else { 1.0 + 0.1 * u };
            let focus = if zooming { (900., 620.) } else { (980., 560.) };
            let (sx, sy) = {
                let z = shake(fi, t, T_ZOOM, 16., 6);
                let hits = [10.0, 12.0, 12.5, 13.0].iter().map(|&h| shake(fi, t, h, 9., 3)).fold((0., 0.), |a, b| (a.0 + b.0, a.1 + b.1));
                (z.0 + hits.0, z.1 + hits.1)
            };
            let flash = if (T_ZOOM..T_ZOOM + 0.05).contains(&t) { 1.0 } else { 0.0 };
            let smear = (T_ZOOM..T_ZOOM + 0.1).contains(&t);
            // the staccato: each word its own colour, tilt and size, bigger each time
            let stacc = |word: &str, pal: &str, rot: f32, p: f32, t0: f32, t1: f32| -> Svgr<'a> {
                if t < t0 || t >= t1 {
                    return fframes::svgr!(<g />);
                }
                let sc = frame.animate(&fframes::timeline!(at t0, animate 2.4_f32 => 1.0, spring));
                slab(ctx, word, pal, cx, 540., p, sc.max(0.2), rot, 1.)
            };
            fframes::svgr!(
                <g transform={Transform::translate(sx, sy)}>
                    {story(i, focus, zoom, u, phone, smear)}
                    {rise("prompts", 3.7, 6.3, 5., 975.)}
                    {rise("takes", 6.5, 8.2, 6., 975.)}
                    {slam("waits", 8.3, 9.9, 7., 975.)}
                    {if (10.0..12.0).contains(&t) {
                        let sc = frame.animate(&fframes::timeline!(at 10.0, animate 2.4_f32 => 1.0, spring)).max(0.2);
                        fframes::svgr!(
                            <g transform={format!("scale({sc}) rotate(-5)")} transform-origin={format!("{cx} 540")}>
                                {slab(ctx, "on", "cream", cx - 340., 540., 10., 1., 0., 1.)}
                                {x_logo(cx + 30., 540., 300., "#f1e9ff")}
                                {slab(ctx, "bang", "cream", cx + 260., 540., 10., 1., 0., 1.)}
                            </g>
                        )
                    } else { fframes::svgr!(<g />) }}
                    {stacc("every", "gold", 4., 11., 12.0, 12.5)}
                    {stacc("single", "blue", -3., 12., 12.5, 13.0)}
                    {stacc("prompt", "pink", 6., 13., 13.0, T_ZOOM)}
                    {pointer("thats-new", "pink", T_ZOOM + 0.2, T_DAY_END, 5., 860., 530.)}
                    <rect width={W} height={H} fill="#fff" opacity={flash} />
                </g>
            )
        } else {
            fframes::svgr!(<g />)
        };

        // ================= 3. the realization =================
        let idea = if (T_DAY_END..T_IDEA_END).contains(&t) {
            let i = clip_at_fps(t, T_DAY_END, ACT2, false, STORY_FPS).unwrap_or(0);
            let t_idea = T_IDEA;
            let (sx, sy) = shake(fi, t, t_idea, 12., 4);
            let flash = if (t_idea..t_idea + 0.07).contains(&t) { 1.0 } else { 0.0 };
            let burst = if t >= t_idea { (1. - seg(t, t_idea, t_idea + 0.7)) * 0.8 } else { 0. };
            fframes::svgr!(
                <g transform={Transform::translate(sx, sy)}>
                    {story(ACT1 + i, (900., 520.), 1.18, 1., i < 6, false)}
                    {if burst > 0. { sunburst(1180., 330., fi as u32 / 2, "#fff6d6", burst * 0.6, 320.) } else { fframes::svgr!(<g />) }}
                    {rise("hmm", T_DAY_END + 0.6, T_DAY_END + 1.6, 7., 985.)}
                    {slam("waiting", t_idea, t_idea + 0.9, 8., 150.)}
                    {stamp("workout", "pink", t_idea + 0.9, T_IDEA_END, 6., cx, 170., -5.)}
                    <rect width={W} height={H} fill="#fff" opacity={flash} />
                </g>
            )
        } else {
            fframes::svgr!(<g />)
        };

        // ================= 4. the build: a split-screen montage, then the whole room =================
        let build = if (T_IDEA_END..T_BUILD_END).contains(&t) {
            let i = clip_at_fps(t, T_IDEA_END, ACT3, false, STORY_FPS).unwrap_or(0);
            let fi_story = ACT1 + ACT2 + i;
            let riser = seg(t, T_BUILD_END - 0.8, T_BUILD_END);
            let (sx, sy) = {
                let r = if riser > 0. { (riser * 10., 0.) } else { (0., 0.) };
                let j = shake(fi, t, T_BUILD_END - 0.8, r.0, 25);
                let a = shake(fi, t, T_IDEA_END + 0.6, 10., 4);
                (j.0 + a.0, j.1 + a.1)
            };
            if t < T_BUILD_SPLIT_END {
                // four panels snapping in: the room, the hands, the face, the monitor
                let slide = |t0: f32| frame.animate(&fframes::timeline!(at t0 => t0 + 0.16, animate 1.0_f32 => 0.0, Easing::EaseOut));
                let a = slide(T_IDEA_END);
                let b = slide(T_IDEA_END + 0.18);
                let c = slide(T_IDEA_END + 0.36);
                let d = slide(T_IDEA_END + 0.54);
                fframes::svgr!(
                    <g transform={Transform::translate(sx, sy)}>
                        <rect width={W} height={H} fill="#000" />
                        <g clip-path="url(#panelA)" transform={Transform::translate(-960. * a, 0.)}>{story(fi_story, focus_for((880., 560.), (480., 540.), 1.35), 1.35, 1., false, false)}</g>
                        <g clip-path="url(#panelB)" transform={Transform::translate(960. * b, 0.)}>{story(fi_story, focus_for((992., 585.), (1440., 270.), 3.2), 3.2, 1., false, false)}</g>
                        <g clip-path="url(#panelC)" transform={Transform::translate(0., 540. * c)}>{story(fi_story, focus_for((860., 340.), (1200., 810.), 3.0), 3.0, 1., false, false)}</g>
                        <g clip-path="url(#panelD)" transform={Transform::translate(0., 540. * d)}>{story(fi_story, focus_for((1504., 424.), (1680., 810.), 3.4), 3.4, 1., false, false)}</g>
                        <rect x="952" y="0" width="16" height={H} fill="#000" />
                        <rect x="960" y="532" width="960" height="16" fill="#000" />
                        <rect x="1432" y="540" width="16" height="540" fill="#000" />
                        {slam("built", T_IDEA_END + 0.6, T_BUILD_SPLIT_END, 8., 540.)}
                    </g>
                )
            } else {
                let zoom = 1.0 + 0.35 * smoothstep(riser);
                fframes::svgr!(
                    <g transform={Transform::translate(sx, sy)}>
                        {story(fi_story, (900., 520.), zoom, 1., false, false)}
                        {stamp("inside", "gold", T_BUILD_SPLIT_END + 0.6, T_BUILD_END, 6., cx, 180., -4.)}
                        <rect width={W} height={H} fill="#fff" opacity={0.9 * riser * riser} />
                    </g>
                )
            }
        } else {
            fframes::svgr!(<g />)
        };

        // ================= 5. the title crash =================
        let title = if (T_BUILD_END..T_TITLE_END).contains(&t) {
            let head_pop = frame.animate(&fframes::timeline!(at T_BUILD_END + 0.05, animate 0.0_f32 => 1.0, spring));
            let kana = frame.animate(&fframes::timeline!(at T_BUILD_END + 0.5, animate 0.0_f32 => 1.0, spring));
            let tag = frame.animate(&fframes::timeline!(at T_BUILD_END + 1.2 => T_BUILD_END + 1.5, animate 0.0_f32 => 1.0, Easing::EaseOut));
            let (sx, sy) = shake(fi, t, T_BUILD_END + 0.2, 14., 5);
            let flash = if (T_BUILD_END..T_BUILD_END + 0.07).contains(&t) { 1.0 } else { 0.0 };
            fframes::svgr!(
                <g transform={Transform::translate(sx, sy)}>
                    <rect width={W} height={H} fill={BG} />
                    {sunburst(cx, 420., fi as u32 / 2, "#f1be58", 0.22, 140.)}
                    <g transform={Transform::scale(head_pop.max(0.01))} transform-origin={format!("{cx} 330")}>
                        <g filter="url(#bloom)">{pic(ctx, "pixi-head.png", cx - 150., 198., 300., 264.)}</g>
                        {pic(ctx, "pixi-head.png", cx - 150., 198., 300., 264.)}
                    </g>
                    {slam("pumpt", T_BUILD_END + 0.2, T_TITLE_END, 15., 630.)}
                    {display("パンプト！", cx, 840., 60., "url(#creamgrad)", 7., -6., kana.max(0.01), if t > T_BUILD_END + 0.5 { 1. } else { 0. })}
                    <text x={cx} y="950" font-family={FONT} font-size="48" font-weight="500" fill={INK} text-anchor="middle" opacity={tag}>"Pixi works out while Claude works."</text>
                    {vignette(0.6)}
                    <rect width={W} height={H} fill="#fff" opacity={flash} />
                </g>
            )
        } else {
            fframes::svgr!(<g />)
        };

        // ================= 6. the terminal =================
        let terminal = if (T_TITLE_END..T_TERMINAL_END).contains(&t) {
            let win_rise = frame.animate(&fframes::timeline!(at T_TITLE_END, animate 260.0_f32 => 0.0, soft));
            let win_fade = frame.animate(&fframes::timeline!(at T_TITLE_END => T_TITLE_END + 0.3, animate 0.0_f32 => 1.0, Easing::EaseOut));
            let (wx, wy, ww, wh) = (160., 60., 1600., 820.);
            let typed = if t < T_TYPING { 0 } else { (((t - T_TYPING) / (T_TYPED - T_TYPING)) * PROMPT.len() as f32).floor().min(PROMPT.len() as f32) as usize };
            let caret_on = ((t * 2.5).floor() as i32) % 2 == 0;
            let submitted = t >= T_SET;
            let t_pop = T_PICK + 10. / CLIP_FPS; // the title pops
            let (sx, sy) = shake(fi, t, t_pop, 12., 5);
            let lines: [(f32, &str, &str); 5] = [
                (T_CHART + 4.5, "> refactor the auth module across three services", INK),
                (T_CHART + 4.6, "\u{25CF} Read src/auth/session.ts, token.ts, middleware.ts", MUTED),
                (T_CHART + 5.0, "\u{25CF} Update(src/auth/session.ts)", MUTED),
                (T_CHART + 5.4, "\u{25CF} Update(src/services/billing/auth-client.ts)", MUTED),
                (T_CHART + 5.8, "\u{25CF} Bash(npm test)   42 passed", MUTED),
            ];
            // System One deciding: the panel slides in, a probability per level grows, the top three light, the winner is picked
            let panel_in = frame.animate(&fframes::timeline!(at T_SET + 0.1 => T_SET + 0.35, animate 1.0_f32 => 0.0, Easing::EaseOut));
            let grow = frame.animate(&fframes::timeline!(at T_SET + 1.9 => T_SET + 2.6, animate 0.0_f32 => 1.0, Easing::EaseOut));
            let pick = frame.animate(&fframes::timeline!(at T_PICK, animate 0.0_f32 => 1.0, spring));
            let panel_out = frame.animate(&fframes::timeline!(at T_CHART + 4.2 => T_CHART + 4.5, animate 1.0_f32 => 0.0, Easing::EaseIn));
            let to_chart = frame.animate(&fframes::timeline!(at T_CHART => T_CHART + 0.4, animate 0.0_f32 => 1.0, Easing::EaseInOut));
            let probs: [f32; 7] = [1., 3., 8., 12., 72., 3., 1.];
            let (px, py) = (wx + 40., wy + 150.);
            let rows: Vec<Svgr<'a>> = EXERCISES
                .iter()
                .enumerate()
                .map(|(k, (_, name, _))| {
                    let y = py + 70. + k as f32 * 44.;
                    let pr = probs[k];
                    let top3 = k == 4 || k == 3 || k == 2;
                    let win = k == 4;
                    let fill = if win { GOLD } else if top3 { "#8a74d6" } else { "#3b2d7a" };
                    let bar_w = (380. * pr / 100. * grow).max(4.);
                    let txt = if win { INK } else { MUTED };
                    // the difficulty the model rates, and the exercise that level gets
                    fframes::svgr!(
                        <g>
                            {if win && t >= T_PICK { pixel_frame(px - 12., y - 33., 1062., 48., 6., GOLD, pick.min(1.)) } else { fframes::svgr!(<g />) }}
                            <text x={px} y={y} font-family={MONO} font-size="24" fill={txt}>{format!("{}  {:<12}", k + 1, LEVELS[k])}</text>
                            <rect x={px + 290.} y={y - 20.} width={bar_w} height="24" fill={fill} />
                            <text x={px + 290. + bar_w + 14.} y={y} font-family={MONO} font-size="24" fill={txt} opacity={grow}>{format!("{:.0}%", pr)}</text>
                            <text x={px + 800.} y={y} font-family={MONO} font-size="24" fill={if win { GOLD } else { MUTED }} opacity={grow}>{format!("\u{2192} {}", name)}</text>
                        </g>
                    )
                })
                .collect();
            // the hillclimb: the estimator's accuracy over the turns it has logged, a stepped line
            // climbing to a plateau, a little Pixi at its end climbing with it, a flag at the top
            let chart = |o: f32| -> Svgr<'a> {
                let (gx, gy, gw, gh) = (px + 70., py + 30., 760., 250.);
                let climb = frame.animate(&fframes::timeline!(at T_CHART + 0.5 => T_CHART + 3.1, animate 0.0_f32 => 1.0, Easing::EaseInOut));
                let n = 24usize;
                let acc = |k: usize| -> f32 { 0.62 + 0.19 * (1. - (-(k as f32) / 7.).exp()) * (1. + 0.12 * (hash(k as u32 * 9) - 0.5)) };
                let shown = (climb * n as f32).floor() as usize;
                let pt = |k: usize| (gx + gw * k as f32 / n as f32, gy + gh - gh * (acc(k) - 0.5) / 0.4);
                let mut d = String::new();
                for k in 0..=shown.min(n) {
                    let (x, y) = pt(k);
                    if k == 0 { d.push_str(&format!("M{x},{y}")); } else { let (px0, _) = pt(k - 1); d.push_str(&format!(" L{px0},{y} L{x},{y}")); }
                }
                let (hx, hy) = pt(shown.min(n));
                let top = shown >= n;
                let bob = if top { 0. } else { 6. * ((t * 12.).sin()) };
                let pixi_i = if top { 35 } else { ((t - T_CHART) * CLIP_FPS) as usize % 10 };
                let pixi_clip = if top { "outro" } else { "jumping-jacks" };
                let grid: Vec<Svgr<'a>> = (0..5u32).map(|g| {
                    let y = gy + gh * g as f32 / 4.;
                    let label = format!("{}%", 90 - g * 10);
                    fframes::svgr!(<g><line x1={gx} y1={y} x2={gx + gw} y2={y} stroke="#2c2550" stroke-width="2" stroke-dasharray="6 8" /><text x={gx - 12.} y={y + 8.} font-family={MONO} font-size="20" fill={MUTED} text-anchor="end">{label}</text></g>)
                }).collect();
                fframes::svgr!(
                    <g opacity={o}>
                        {grid}
                        <line x1={gx} y1={gy + gh} x2={gx + gw} y2={gy + gh} stroke={MUTED} stroke-width="2" />
                        {slab(ctx, "accuracy", "cream", gx + 100., gy + 40., 2., 1., 0., 1.)}
                        {slab(ctx, "turns", "cream", gx + gw - 140., gy + gh + 34., 2., 1., 0., 1.)}
                        <path d={d} fill="none" stroke={GOLD} stroke-width="6" stroke-linejoin="round" />
                        {sprite(ctx, pixi_clip, pixi_i, hx - 36., hy - 78. + bob, 72.)}
                        {if top { callout("plateau", "gold", T_CHART + 3.2, T_CHART + 4.5, 5., hx - 170., hy + 110., hx, hy) } else { fframes::svgr!(<g />) }}
                    </g>
                )
            };
            let panel_show = t >= T_SET + 0.1 && t < T_CHART + 4.5;
            let panel = if panel_show {
                fframes::svgr!(
                    <g opacity={panel_out} transform={Transform::translate(-1100. * panel_in, 0.)}>
                        <rect x={px - 24.} y={py - 50.} width="1100" height="400" rx="14" fill="#0c0c18" stroke={PROMPT_EDGE} stroke-width="2" opacity="0.92" />
                        {slab(ctx, "system-one", "gold", px + 130., py - 6., 3., 1., 0., 1.)}
                        <text x={px + 360.} y={py} font-family={MONO} font-size="22" fill={MUTED}>"torchcast-decision-12b · one forward pass · how hard is this job?"</text>
                        <g opacity={1. - to_chart}>
                            {rows}
                            {if t >= T_PICK + 0.2 {
                            // the arrow's tip stops short of Pixi; the line runs on the same 12 px cells into the shaft
                            let c = 12.;
                            let (ax, ay) = (wx + ww - 48. - 300. + 50., wy + wh - 120. - 46. - 150.);
                            let (tcx, tcy) = ((ax / c).round() as i32, (ay / c).round() as i32);
                            fframes::svgr!(<g>{pixel_line(px + 1062., py + 246., (tcx - 9) as f32 * c, tcy as f32 * c, c, GOLD)}{pixel_arrow_right(tcx - 8, tcy, c, GOLD)}</g>)
                        } else { fframes::svgr!(<g />) }}
                        </g>
                        {if to_chart > 0. { chart(to_chart) } else { fframes::svgr!(<g />) }}
                    </g>
                )
            } else {
                fframes::svgr!(<g />)
            };
            let transcript: Vec<Svgr<'a>> = lines
                .iter()
                .enumerate()
                .filter(|(_, (at, _, _))| t >= *at)
                .map(|(k, (at, text, color))| {
                    let o = ((t - at) / 0.3).min(1.0);
                    let y = wy + 120. + k as f32 * 52.;
                    fframes::svgr!(<text x={wx + 48.} y={y} font-family={MONO} font-size="28" fill={*color} opacity={o}>{text.to_string()}</text>)
                })
                .collect();
            let ss = 300.;
            let (sx2, sy2) = (wx + ww - 48. - ss, wy + wh - 120. - 46. - ss);
            let band = match set_at(t, T_SET, T_PICK, "squats", 22) {
                Some((clip, i)) => {
                    let verdict_in = t >= T_PICK;
                    let work = (t - T_PICK - INTRO_FRAMES as f32 / CLIP_FPS).max(0.);
                    let reps = (work / (22. / CLIP_FPS)).floor() as usize;
                    let status = format!("Pixi · squats · {} · {}/25 reps · {}", if verdict_in { "difficulty 5/7 (72%) · ~12 min" } else { "sizing up the task…" }, reps, clock(t, T_SET));
                    fframes::svgr!(
                        <g>
                            <g filter="url(#bloomsmall)" opacity="0.45">{sprite(ctx, &clip, i, sx2, sy2, ss)}</g>
                            {sprite(ctx, &clip, i, sx2, sy2, ss)}
                            <text x={wx + ww - 48.} y={sy2 + ss + 28.} font-family={MONO} font-size="24" fill={MUTED} text-anchor="end">{status}</text>
                        </g>
                    )
                }
                None => fframes::svgr!(<g />),
            };
            let prompt_text = if submitted { String::new() } else { PROMPT[..typed].to_string() };
            fframes::svgr!(
                <g transform={Transform::translate(sx, sy)}>
                    <rect width={W} height={H} fill={BG} />
                    {light("coolglow", cx, cy, 900., 0.18)}
                    <g opacity={win_fade} transform={Transform::translate(0., win_rise)}>
                        <g filter="url(#bloom)"><rect x={wx} y={wy} width={ww} height={wh} rx="18" fill="#5a47a3" opacity="0.35" /></g>
                        <rect x={wx} y={wy} width={ww} height={wh} rx="18" fill={WINDOW} stroke={WINDOW_EDGE} stroke-width="2" />
                        <rect x={wx} y={wy} width={ww} height="56" rx="18" fill="#17172b" />
                        <rect x={wx} y={wy + 30.} width={ww} height="26" fill="#17172b" />
                        <circle cx={wx + 32.} cy={wy + 28.} r="8" fill="#ff5f57" />
                        <circle cx={wx + 58.} cy={wy + 28.} r="8" fill="#febc2e" />
                        <circle cx={wx + 84.} cy={wy + 28.} r="8" fill="#28c840" />
                        <text x={wx + ww / 2.} y={wy + 37.} font-family={MONO} font-size="22" fill={MUTED} text-anchor="middle">"claude — ~/dev/my-app"</text>
                        <text x={wx + ww - 28.} y={wy + 37.} font-family={MONO} font-size="20" fill="#7bd389" text-anchor="end">"\u{25CF} local · mlx · torchcast-decision-12b"</text>
                        {transcript}
                        {band}
                        {panel}
                        <rect x={wx + 40.} y={wy + wh - 120.} width={ww - 80.} height="72" rx="12" fill="#14142a" stroke={PROMPT_EDGE} stroke-width="2" />
                        <text x={wx + 64.} y={wy + wh - 72.} font-family={MONO} font-size="30" fill={INK}>
                            {format!("> {}{}", prompt_text, if caret_on && !submitted { "▌" } else { " " })}
                        </text>
                        {scanlines(0.5)}
                    </g>
                    {rise("you-prompt", T_TYPING + 0.2, T_SET - 0.2, 5., 985.)}
                    {rise_rich(&[&[("a", "cream", 1.), ("system-one", "cyan", 1.25), ("model", "cream", 1.)], &[("reads2", "cream", 1.)]], T_SET + 0.2, T_SET + 1.8, 4., 940.)}
                    {rise("estimates", T_SET + 1.8, T_PICK, 5., 985.)}
                    {stamp_rich(&[&[("top-probability", "gold", 1.)], &[("level5", "gold", 1.), ("pct72", "cyan", 1.25)]], T_PICK + 0.05, T_PICK + 1.6, 4., cx, 930., -4.)}
                    {rise_rich(&[&[("so-pixi-does", "cream", 1.), ("squats-kw", "cyan", 1.25)]], T_PICK + 1.6, T_CHART, 5., 975.)}
                    {rise("learns", T_CHART + 0.2, T_CHART + 1.8, 5., 985.)}
                    {slam_rich(&[&[("it", "gold", 1.), ("hillclimbs", "cyan", 1.25)], &[("sharper", "gold", 1.)]], T_CHART + 1.8, T_CHART + 4.4, 4.5, 935.)}
                    {stamp_rich(&[&[("all-of-it", "gold", 1.), ("local-kw", "cyan", 1.25)], &[("mac", "gold", 1.)]], T_CHART + 4.5, T_CHART + 6.7, 4., cx, 930., -3.)}
                    {rise("above", T_CHART + 6.8, T_TERMINAL_END, 5., 985.)}
                    {vignette(0.5)}
                </g>
            )
        } else {
            fframes::svgr!(<g />)
        };

        // ================= 7. the seven levels =================
        let levels = if (T_TERMINAL_END..T_LEVELS_END).contains(&t) {
            let cards: Vec<Svgr<'a>> = EXERCISES
                .iter()
                .enumerate()
                .map(|(k, (id, name, frames))| {
                    let t0 = T_TERMINAL_END + 0.1 + k as f32 * 0.09;
                    let wipe = frame.animate(&fframes::timeline!(at t0 => t0 + 0.28, animate 1.0_f32 => 0.0, Easing::EaseOut));
                    let x = cx + (k as f32 - 3.) * 255.;
                    let size = 220.;
                    let i = clip_at(t, t0, *frames, true).unwrap_or(0);
                    let digit = format!("{}", k + 1);
                    fframes::svgr!(
                        <g transform={Transform::translate(1920. * wipe, 0.)}>
                            {slab(ctx, &format!("level-{digit}"), "gold", x, cy - 160., 7., 1., 0., 1.)}
                            <g filter="url(#bloomsmall)" opacity="0.4">{sprite(ctx, id, i, x - size / 2., cy - size / 2. - 10., size)}</g>
                            {sprite(ctx, id, i, x - size / 2., cy - size / 2. - 10., size)}
                            <text x={x} y={cy + 160.} font-family={FONT} font-size="30" font-weight="500" fill={INK} text-anchor="middle">{name.to_string()}</text>
                        </g>
                    )
                })
                .collect();
            fframes::svgr!(
                <g>
                    <rect width={W} height={H} fill={BG} />
                    {sunburst(cx, cy, 3, "#2a2342", 1.0, 0.)}
                    {cards}
                    {rise("easy", T_TERMINAL_END + 0.5, T_TERMINAL_END + 3.0, 6., 990.)}
                    {stamp("big", "pink", T_TERMINAL_END + 3.0, T_LEVELS_END, 6., cx, 955., -3.)}
                    {vignette(0.6)}
                </g>
            )
        } else {
            fframes::svgr!(<g />)
        };

        // ================= 7b. the payoff: a new morning, Pumpt! on the monitor, Pixi up and at it =================
        let real = if (T_LEVELS_END..T_REAL_END).contains(&t) {
            let i = clip_at(t, T_LEVELS_END, ACT4, false).unwrap_or(0);
            let fi_story = ACT1 + ACT2 + ACT3 + i;
            // a push in on the workout, a cut back out for the flex
            let zoom = if i < 14 { 1.05 } else if i < 72 { 1.25 } else { 1.0 };
            let focus = if i < 14 { (900., 520.) } else { (600., 560.) };
            let flash = if (T_LEVELS_END..T_LEVELS_END + 0.05).contains(&t) { 1.0 } else { 0.0 };
            let (sx, sy) = {
                let a = shake(fi, t, T_LEVELS_END + 14. / CLIP_FPS, 10., 4);
                let b = shake(fi, t, T_LEVELS_END + 72. / CLIP_FPS, 12., 5);
                (a.0 + b.0, a.1 + b.1)
            };
            let flex = i >= 72;
            fframes::svgr!(
                <g transform={Transform::translate(sx, sy)}>
                    {story(fi_story, focus, zoom, 0.2, false, false)}
                    {if flex { sunburst(576., 420., fi as u32 / 2, "#fff6d6", 0.5 * (1. - seg(t, T_REAL_END - 0.9, T_REAL_END - 0.2)), 360.) } else { fframes::svgr!(<g />) }}
                    {rise("now", T_LEVELS_END + 0.2, T_LEVELS_END + 2.0, 6., 980.)}
                    {slam("pixi-works", T_LEVELS_END + 2.0, T_LEVELS_END + 4.3, 8., 980.)}
                    {stamp("bye", "pink", T_LEVELS_END + 4.4, T_LEVELS_END + 6.0, 7., cx, 930., -6.)}
                    {rise("excuses", T_LEVELS_END + 6.0, T_REAL_END, 7., 965.)}
                    <rect width={W} height={H} fill="#fff" opacity={flash} />
                </g>
            )
        } else {
            fframes::svgr!(<g />)
        };

        // ================= 8. the bow =================
        let bow = if (T_REAL_END..T_BOW_END).contains(&t) {
            let size = 820.;
            let i = clip_at(t, T_REAL_END + 0.1, OUTRO_FRAMES, false).unwrap_or(0);
            let burst = (1. - seg(t, T_REAL_END + 1.1, T_REAL_END + 1.9)) * seg(t, T_REAL_END + 1.0, T_REAL_END + 1.1);
            let (sx, sy) = shake(fi, t, T_REAL_END + 1.0, 10., 4);
            fframes::svgr!(
                <g transform={Transform::translate(sx, sy)}>
                    <rect width={W} height={H} fill={BG} />
                    {light("warmglow", cx, cy - 60., 700., 0.25)}
                    {sunburst(cx, cy - 60., fi as u32 / 2, "#fff6d6", burst * 0.7, 300.)}
                    <g filter="url(#bloomsmall)" opacity="0.45">{sprite(ctx, "outro", i, cx - size / 2., cy - size / 2. - 40., size)}</g>
                    {sprite(ctx, "outro", i, cx - size / 2., cy - size / 2. - 40., size)}
                    {rise("finish", T_REAL_END + 2.0, T_BOW_END, 6., 980.)}
                    {vignette(0.5)}
                </g>
            )
        } else {
            fframes::svgr!(<g />)
        };

        // ================= 9. the end card =================
        let end = if t >= T_BOW_END {
            let head_pop = frame.animate(&fframes::timeline!(at T_BOW_END + 0.05, animate 0.0_f32 => 1.0, spring));
            let (sx, sy) = shake(fi, t, T_BOW_END + 0.25, 10., 4);
            fframes::svgr!(
                <g transform={Transform::translate(sx, sy)}>
                    <rect width={W} height={H} fill={BG} />
                    {sunburst(cx, 360., fi as u32 / 3, "#f1be58", 0.16, 120.)}
                    <g transform={Transform::scale(head_pop.max(0.01))} transform-origin={format!("{cx} 280")}>
                        <g filter="url(#bloom)">{pic(ctx, "pixi-head.png", cx - 125., 170., 250., 220.)}</g>
                        {pic(ctx, "pixi-head.png", cx - 125., 170., 250., 220.)}
                    </g>
                    {slam("pumpt", T_BOW_END + 0.25, LENGTH + 1., 11., 520.)}
                    {display("パンプト！", cx, 655., 50., "url(#creamgrad)", 6., -6., 1., if t > T_BOW_END + 0.5 { 1. } else { 0. })}
                    // the two phrases drop onto the screen from above (z, not y): big and clear, then final size and solid
                    {{
                        let drop = |name: &str, t0: f32, x: f32| -> Svgr<'a> {
                            if t < t0 { return fframes::svgr!(<g />); }
                            let u = seg(t, t0, t0 + 0.35);
                            let sc = 3.2 - 2.2 * (1. - (1. - u) * (1. - u)); // ease out: 3.2 → 1.0
                            slab(ctx, name, "cream", x, 820., 4., sc, 0., u * u)
                        };
                        fframes::svgr!(<g>{drop("pct-local", T_BOW_END + 1.0, cx - 300.)}{drop("open-source", T_BOW_END + 1.45, cx + 300.)}</g>)
                    }}
                    // then the URL, typed into a prompt box like the mod's own
                    {if t >= T_BOW_END + 2.0 {
                        let (pw, _) = slab_size("url");
                        let p = 4.;
                        let full_w = pw / 4. * p;
                        let typed = seg(t, T_BOW_END + 2.1, T_BOW_END + 3.0); // 26 letters in 0.9 s, then a 1.6 s hold before the fade
                        // whole letters: the slab is drawn at font scale 2, so 12 art px a letter, 8 of padding at its left, 4 px per art px
                        let chars = 25.;
                        let n = (typed * chars).floor();
                        let clip_w = if n <= 0. { 1. } else { (8. + n * 12.) * p }; // never 0: the renderer refuses a zero-width rect
                        let (bx, by, bw, bh) = (cx - full_w / 2. - 70., 880., full_w + 140., 110.);
                        let caret_on = ((t * 2.5).floor() as i32) % 2 == 0;
                        let box_in = seg(t, T_BOW_END + 2.0, T_BOW_END + 2.15);
                        fframes::svgr!(
                            <g opacity={box_in}>
                                <rect x={bx} y={by} width={bw} height={bh} rx="12" fill="#14142a" stroke={PROMPT_EDGE} stroke-width="3" />
                                <text x={bx + 24.} y={by + 72.} font-family={MONO} font-size="40" fill={INK}>">"</text>
                                <clipPath id="urlclip"><rect x={bx + 60.} y={by} width={clip_w} height={bh} /></clipPath>
                                <g clip-path="url(#urlclip)">{pic(ctx, "title-url-blue.png", bx + 60., by + bh / 2. - 68., full_w, 136.)}</g>
                                {if caret_on { fframes::svgr!(<rect x={bx + 60. + clip_w + 6.} y={by + 28.} width="16" height="54" fill={INK} />) } else { fframes::svgr!(<g />) }}
                            </g>
                        )
                    } else { fframes::svgr!(<g />) }}
                    {vignette(0.6)}
                </g>
            )
        } else {
            fframes::svgr!(<g />)
        };

        fframes::svgr!(
            <svg xmlns="http://www.w3.org/2000/svg" viewBox={format!("0 0 {WIDTH} {HEIGHT}")} width={WIDTH} height={HEIGHT}>
                {defs()}
                <rect width={W} height={H} fill={BG} />
                {cold}
                {day}
                {idea}
                {build}
                {title}
                {terminal}
                {levels}
                {real}
                {bow}
                {end}
            </svg>
        )
    }
}
