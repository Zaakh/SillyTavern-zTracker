/** Keeps zTracker's portaled menu colors aligned with the active SillyTavern theme. */
type Rgb = { r: number; g: number; b: number; a: number };

/** Clamps a numeric color channel into the CSS byte range. */
function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Parses computed rgb()/rgba() values into a channel object. */
function parseCssColorToRgb(color: string): Rgb | null {
  const normalizedColor = (color || '').trim().toLowerCase();
  if (!normalizedColor) {
    return null;
  }
  if (normalizedColor === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const match = normalizedColor.match(/^rgba?\(([^)]+)\)$/);
  if (!match) {
    return null;
  }

  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length < 3) {
    return null;
  }

  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  const a = parts.length >= 4 ? Number(parts[3]) : 1;
  if ([r, g, b, a].some((value) => Number.isNaN(value))) {
    return null;
  }

  return {
    r: clampByte(r),
    g: clampByte(g),
    b: clampByte(b),
    a: Math.max(0, Math.min(1, a)),
  };
}

/** Approximates relative luminance so menu surfaces can flip between light and dark accents. */
function rgbToLuma(rgb: Rgb): number {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/** Walks up the DOM until it finds a non-transparent background that can anchor the menu theme. */
function findNearestNonTransparentBackground(start: Element | null): Rgb | null {
  let element: Element | null = start;
  while (element) {
    const background = parseCssColorToRgb(getComputedStyle(element).backgroundColor);
    if (background && background.a > 0.05) {
      return background;
    }
    element = element.parentElement;
  }

  const bodyBackground = parseCssColorToRgb(getComputedStyle(document.body).backgroundColor);
  if (bodyBackground && bodyBackground.a > 0.05) {
    return bodyBackground;
  }

  const htmlBackground = parseCssColorToRgb(getComputedStyle(document.documentElement).backgroundColor);
  if (htmlBackground && htmlBackground.a > 0.05) {
    return htmlBackground;
  }

  return { r: 0, g: 0, b: 0, a: 1 };
}

/** Samples the current chat surface and updates the CSS variables used by the portaled parts menu. */
function setZTrackerMenuThemeVars(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const sampleTarget =
    (document.querySelector('#chat') as Element | null) ??
    (document.querySelector('#chatLog') as Element | null) ??
    (document.querySelector('.chat') as Element | null) ??
    (document.querySelector('.mes') as Element | null) ??
    document.body;

  const background = findNearestNonTransparentBackground(sampleTarget);
  if (!background) {
    return;
  }

  const isLight = rgbToLuma(background) > 0.6;
  const menuAlpha = isLight ? 0.96 : 0.92;
  const root = document.documentElement;

  root.style.setProperty('--ztracker-menu-bg', `rgba(${background.r}, ${background.g}, ${background.b}, ${menuAlpha})`);
  root.style.setProperty('--ztracker-menu-border', isLight ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.12)');
  root.style.setProperty('--ztracker-menu-part-bg', isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)');
  root.style.setProperty('--ztracker-menu-item-bg', isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)');
  root.style.setProperty('--ztracker-menu-hover-bg', isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.10)');
}

/** Watches theme-affecting DOM attributes and refreshes the zTracker menu variables on change. */
export function installZTrackerThemeObserver(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return;
  }

  let timer: number | undefined;
  const schedule = () => {
    if (timer) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = undefined;
      setZTrackerMenuThemeVars();
    }, 50);
  };

  const observer = new MutationObserver(() => schedule());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

  setZTrackerMenuThemeVars();
}