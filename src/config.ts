// Every number worth tuning on a real phone lives here. Open the site with ?tune
// to get sliders for them.

export const config = {
  // Camera
  fov: 32,
  tiltDeg: 8,
  startElevationDeg: 24, // how far above the island the camera starts, as a viewing angle
  startBottom: 0.05, // gap below the island on the first screen, as a share of screen height
  startFill: 0.82, // share of screen width the island takes on the first screen
  startFillHeight: 0.5, // most of the screen height it takes, on wide screens
  shelfFill: 0.94, // share of screen the shelf section takes at the end
  descendEnd: 0.5, // scroll progress where the descent ends
  zoomEnd: 0.92, // scroll progress where the zoom into the shelf ends

  // Books' look (see shelfLook in scene/books.ts)
  bookExposure: 0.55, // matches the books' Neutral tone mapping to the island's AgX
  shelfShade: 0.7, // studio light that reaches a spine at the front of the shelf

  // Shelf interaction
  // Phone magnifier (see Input.layOut): a sideways slide on a row lays the row across the screen, one slot per book.
  slotMarginPx: 32, // the slots stop this far in from each edge; the margin belongs to the first and last book, so a thumb reaches them
  slopPx: 8, // finger travel that tells a slide from a press
  shelfGlide: 1.5, // m/s, the fastest the shelf moves to meet the finger
  touchReachPx: 20, // a press this close to a spine takes it, so thin spines are easy to press; further away it is empty shelf
  closeSwipePx: 90, // a swipe down this long closes an open view (a flick closes it sooner)
  pullOut: 0.3, // metres a selected book slides toward the viewer (mouse)
  pullOutTouch: 0.16, // the phone camera is closer, so less travel reads the same
  coverTurnDeg: 76,
  lidOpenDeg: 18, // how far a pulled-out box set's lid tilts open
  flatTiltDeg: 88, // a flat book, turned head-up, tips its cover this far toward the viewer
  coverMargin: 0.03, // share of screen width kept clear at each side of a stood-up flat book (it moves inward to keep it)
  thumbLift: 0.1, // extra lift on touch so the book shows above the thumb
  hoverLift: 0.05, // lift with the mouse, so a pulled-out book does not drop below the shelf
  neighbourSigma: 1.3, // width of the bulge around the selected book, in books
  neighbourPull: 0.35,
  // Dock-style spread (see Shelf.spread): the row opens a gap for the turned cover so it hides no spines.
  dockGap: 1, // share of the turned cover's width the gap opens (0 = off)
  dockSigma: 3, // books this close to the gap keep most of their thickness; those further away get thinner
  dockMinScale: 0.5, // the thinnest a spine gets
  dockMargin: 0.008, // metres of air on each side of the cover
  flickVelocity: 0.6, // px/ms upward that opens the book at the end of a slide (also how fast a swipe down closes an open view)
  flickLiftPx: 24, // or this far up after a slide opens it
  labelTop: 1 / 6, // where the selected book's title sits, as a share of screen height from the top (its centre)
};

export type Config = typeof config;
