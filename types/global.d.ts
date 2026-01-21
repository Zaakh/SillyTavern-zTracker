// Ensure SillyTavern global typings are available project-wide.
// The sillytavern-utils-lib package declares the global `SillyTavern` in its d.ts; this import makes
// those declarations visible even in files that don’t import the lib directly.
export {};
import 'sillytavern-utils-lib';
