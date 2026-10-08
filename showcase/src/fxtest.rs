//! A throwaway frame to check what the renderer honours: filters (bloom, a motion
//! smear), blend modes (a light pass), patterns (scanlines), stroked skewed type.
use fframes::{FFramesContext, Frame, Svgr};

pub fn render<'a>(_frame: Frame, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
    let img = ctx.get_image("story-f95.png");
    fframes::svgr!(
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
            <defs>
                <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18" /></filter>
                <filter id="smear" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14 0" /></filter>
                <radialGradient id="warm" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffb347" stop-opacity="0.9" /><stop offset="1" stop-color="#ffb347" stop-opacity="0" /></radialGradient>
                <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000" fill-opacity="0.18" /></pattern>
                <linearGradient id="goldgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2b0" /><stop offset="0.5" stop-color="#f1be58" /><stop offset="1" stop-color="#b8842a" /></linearGradient>
            </defs>
            <rect width="1920" height="1080" fill="#1b1b2a" />
            {match img { Some(i) => fframes::svgr!(<image href={i.href()} x="0" y="0" width="1920" height="1080" image-rendering="optimizeSpeed" />), None => fframes::svgr!(<g />) }}
            // a light pass: screen-blended warm radial over the window
            <circle cx="330" cy="290" r="420" fill="url(#warm)" style="mix-blend-mode:screen" />
            // bloom: a bright shape blurred under itself
            <g filter="url(#bloom)"><rect x="1330" y="330" width="360" height="200" fill="#9ad5f5" opacity="0.8" /></g>
            <rect x="1330" y="330" width="360" height="200" fill="#9ad5f5" />
            // a smeared sprite
            <g filter="url(#smear)">{match ctx.get_image("squats-f0.png") { Some(i) => fframes::svgr!(<image href={i.href()} x="700" y="500" width="300" height="300" image-rendering="optimizeSpeed" />), None => fframes::svgr!(<g />) }}</g>
            // scanlines over everything
            <rect width="1920" height="1080" fill="url(#scan)" />
            // display type: gradient fill, thick stroke under the fill, a skew
            <g transform="skewX(-8)">
                <text x="960" y="200" font-family="Dela Gothic One" font-size="140" fill="url(#goldgrad)" stroke="#230438" stroke-width="14" paint-order="stroke" text-anchor="middle">"THIS IS PIXI"</text>
                <text x="960" y="300" font-family="Dela Gothic One" font-size="60" fill="#f1e9ff" stroke="#230438" stroke-width="8" paint-order="stroke" text-anchor="middle">"ワーカサイズ"</text>
            </g>
        </svg>
    )
}
