# Isabel & Linda's Library — plan

A public mini site showing the children's books Linda put together for her granddaughter Isabel, sitting on a photorealistic 3D recreation of the blue kitchen island where they live.

URL: `library.raulalgo.es` (static site on Hostinger, `noindex` until launch).

## Page flow

- **Header**: the logo as set in Figma (node 1:34): "Isabel & Linda" in Times New Roman Italic with a Ballet ampersand, over "Library" / "Biblioteca" in tracked caps (the word follows the language); a headline about Linda's life as a children's librarian; count ("87 books · 2 languages", from `books.json`). Nothing else for now. The whole island sits at the bottom of the first screen.
- **Scroll**: the camera never turns sideways. It has a fixed slight downward tilt (~8°) plus lens shift (`camera.setViewOffset`), so verticals stay close to parallel in a one-point, Wes Anderson composition. Two moves, one ease each: (1) descend from above the island; (2) move closer while sliding sideways to centre the shelves.
- **Countertop**: two small piles of three polaroids (the island, Isabel & Linda), photos and ES/EN captions from Raúl. The island pile's title shows above its open prints, set like 'Library' in the page title; every print carries its date. They lift on hover (the pile fans out) and open on click: the prints fly up off the worktop, turning to face the viewer, into a row (swiped through on a phone), and fly back down on close. The flight is a CSS 3D transform in the scene camera's perspective, so it starts exactly on the 3D print. Hover uses a fixed hit area around each spot, so a lifting print never slips out from under the pointer.
- **Footer**: very minimal. One line ("Made by Raúl for Isabel, from Linda's books"), "View all books", affiliate disclosure. ES/EN toggle also top-right.

## 3D: photorealistic

The goal is that a still from the site could pass for a studio photo of the real island. Same scene as before: the whole island and the two oak stools, no kitchen or room, on a seamless off-white studio backdrop.

### Approach

Real-time three.js, with the island's lighting computed in Blender Cycles and baked into textures. Books and polaroids stay live 3D objects because they move.

Alternatives considered and rejected:
- **Pre-rendered Cycles frames for the scroll**: best image quality, but books could not slide out, turn or fly to the detail view.
- **Gaussian splat scan of the real island**: photoreal for free, but books cannot move individually, the lighting cannot be changed, and the kitchen comes with it.

### Island and stools (Blender)

- Modelled in Blender from Daniel Bruce's drawing (`references/island-measurements.md`), using the Blender MCP connection.
- Every edge bevelled (1–2 mm on panels, slightly more on the oak), drawer and door gaps cut as real 3 mm gaps, handles/push points as built. Sharp CG edges are the most common thing that makes a render look fake.
- Materials, each matched to the real finish:
  - **Blue**: Little Greene Mazarine 256, PU spray, 25% sheen. Colour taken from Little Greene's published values, checked against Raúl's photos with a grey card in frame. Low-gloss clearcoat.
  - **Oak**: oak veneer with whitened oil. A scanned oak veneer texture set (albedo, roughness, normal; CC0 from Poly Haven or ambientCG), tinted to the whitened finish. Grain runs the right way on each part (vertical on legs, along the length on rails and shelves).
  - **Worktop**: Hi-Macs Urban Concrete, matte. Texture from a straight-on photo of the real worktop or the manufacturer's swatch.
- Stools modelled from photos once their measurements are in.
- Lighting: one large softbox key from front-left, a fill, and a studio HDRI for reflections. The same lighting is used for the bake and for the live objects.
- Baked in Cycles: a lightmap of all diffuse light (direct and indirect, without surface colour) and an ambient occlusion map on a second UV set, and a shadow on the floor under the island and stools. The site multiplies each material's colour by the lightmap and adds only live reflections from a studio HDRI rendered in the same scene, so a colour change needs no new bake. Exported as `.glb` with meshopt compression; KTX2 textures in the performance pass.

### Books (generated in code)

- Still generated from `books.json`, not modelled, but built to look like real books:
  - Hardbacks: boards slightly larger than the page block, rounded spine, hinge groove. Board books: thick rounded boards. Paperbacks: flat spine, thin cover.
  - Page block with a paper texture and a slight inset.
  - Size and thickness per book from publisher data, checked against the photos.
- **Spines are photographed, not drawn.** Raúl photographs each shelf straight-on in even light (several overlapping shots per shelf). Claude rectifies the photos and crops one spine image per book. Covers come from straight-on photos or publisher images.
- Lit by the same HDRI as the island. Inside the shelf they are darkened by a baked occlusion gradient (darker toward the back and under the shelf above), which fades out as a book slides forward.
- Books stand upright and tidy, in photo order, at their real sizes. The two oversized books (*Atlas del mundo*, *Juan Rex*) lie flat on the top shelf, as in real life.
- **Top shelf: Spanish. Bottom shelf: English.** Decided by the language of the copy owned. Translations go by their copy's language; bilingual books go on the Spanish shelf with a tag.

### Polaroids

Real photo prints: matte white frame with a slight curl, glossy photo surface that reflects the studio light, soft contact shadow on the worktop.

### Rendering

- AgX tone mapping in three.js, matching Blender's view transform, so the bake and the live objects agree.
- Screen-space ambient occlusion (N8AO) for contact shadows between books and between books and shelves.
- Soft shadows from the key light on books only; the island's shadows are baked.
- Depth of field only in the detail view, to separate the open book from the shelf. The scroll path stays in focus throughout.
- Dark mode: the backdrop turns near-black and the baked backdrop shadow is dropped. The island and its lighting stay the same.
- Loading: the first screen shows a Cycles render from the exact start camera, which crossfades to the live scene once it has loaded. The same render is the site-wide share image.
- Budget: 60 fps on an iPhone 12 or newer; under ~8 MB before the first interaction. Higher-resolution textures load after that.

## Books and data

- Children's literature only. No magazines, activity kits or keepsake boxes. Box sets are one shelf object whose detail lists the books inside.
- The Libib collection decides which books are in the library: a book appears only if it is in Libib. The scan order is the shelf order (left to right, top shelf first). `data/books.photo.json` (titles read from the reference photos) is kept only as an old cross-check.
- Metadata per book: title, original title (first-class), author, illustrator, publisher, year, language, binding (hardback, paperback, board book), dimensions, short description in ES and EN (written by Claude from publisher blurbs, reviewed by Raúl), shown in the visitor's browser language.
- Other-language edition: a small flag with its title and cover thumbnail, "Original: English, 1969" when the copy is a translation.
- Buy links: Bookshop.org (Spain for ES editions, UK for EN editions), Amazon (.es / .co.uk) as fallback. Affiliate disclosure in the footer.
- Spine and cover images live next to `books.json`, named by slug.
- All data in one `books.json`. New books are added by asking Claude, with a spine photo and a cover photo.

## Interaction

- **Vertical scroll** always drives the page and the camera story. Never hijacked.
- **Panning the shelf**: horizontal swipe on touch that starts off the rows (the worktop, the base), trackpad horizontal swipe, Shift + wheel on a mouse. Momentum.
- **Magnifier, phone**: a sideways slide that starts on a row, over books or empty shelf. Sliding on a row never pans the shelf. The row is laid across the screen in slots, one per book, between margins of `slotMarginPx` (32 px) at each edge that belong to the first and last books, so a thumb can reach them. Each book gets an equal share of that width (10 books on a 500 px screen: 50 px each; on a 375 px iPhone the bottom row's 66 books get ~4–5 px each), except a book that looks narrower on screen than its share: it keeps its own width, and the shelf stands still over it. The slot under the finger picks the book, whatever is drawn under it, and the shelf moves continuously to keep that book under the finger, so one slide reaches every book in the row, and the shelf only ever moves against the thumb. On the top row the 17 standing books keep their own widths and the stretch of empty shelf before the two flat books takes the rest. A row that fits between the margins (a phone held sideways) keeps every book where it is and the shelf does not move. The shelf follows where the books stand, not their covers, whose places jump from book to book. Nothing scrolls by holding at an edge. A slide that starts away from where the shelf was left glides it to the finger (no faster than `shelfGlide`). The picked book slides out and turns its cover to the viewer. Haptic tick per book. Flick up while sliding opens that book's detail view, the cover flying up off the shelf: once the finger turns upward, the book it was on stays picked and the shelf stops, so the thumb's sideways drift during the flick does not pick a neighbour; a move up of `flickLiftPx` (24 px) or a flick faster than `flickVelocity` opens it, and coming back down or sliding sideways again resumes the slide (a thumb arcs upward as it slides). On a phone the slide claims the touch from its first sideways move, and the canvas has no `touch-action`: otherwise iOS Safari scrolls the page under the flick. Otherwise it slides back on release. A press without sliding, short or long, takes the spine under the finger, like a tap (within ~20 px of a spine; further away is empty shelf); tapping the book that is out opens the detail. The ‹ › buttons hide while sliding. No onboarding animation.
- **Magnifier, desktop**: always on with the mouse pointer, Dock-style. The pointer's place along the row picks the book, measured on the books at rest, so the pulled-out cover never blocks the pointer from its neighbours. Click opens the detail. The book stays out when the pointer leaves the rows. On a row too long for the screen between the `slotMarginPx` margins (a narrow window, where the shelf fits by height), the pointer works the phone slide's slots instead: its slot picks the book and the shelf moves against the pointer to bring that book under it, so every book is in reach without panning. A row that fits keeps the Dock-style hover, and the shelf does not move.
- **Zooming in from afar**: before the camera has reached the shelf, a tap or click on its rows scrolls the page to its end (smooth), where the magnifier works. With the mouse, the books around the pointer fan out a little meanwhile, a hint that they respond: they slide out (`hintPull`) and lean away from the pointer on their bottom edge (up to `hintLeanDeg`, most at `hintSigma` books away), and the pointer turns into a hand. On a phone the press shows the same fan while the page scrolls in.
- **Spread (phone and desktop)**: the selected book's neighbours slide apart to open a gap as wide as its turned cover looks from the camera, so the cover hides no spines. The room comes from free space at the end of the row first, then from thinner spines, least so next to the gap. At the ends of a row the cover moves inward to stay inside the shelf. Tunable with `dock*` in `?tune`.
- **Arrows**: ← → keys and ‹ › buttons at the sides of the shelf step through all the books in shelf order, across both rows. On a phone the shelf pans to the book. Enter opens the detail; Esc puts the book back.
- **Haptics**: `navigator.vibrate` on Android; hidden `<input type="checkbox" switch>` toggle on iOS 18+ Safari. No web API exists for Mac trackpad haptics.
- **Detail view**: the cover flies off the pulled-out book, turning to face the viewer, into its place in the view, and back onto the book on close. Same CSS 3D flight as the polaroids (`src/flight.ts`); the book is hidden on the shelf while its cover is up, and the metadata fades in behind the cover. Covers are drawn at their real size, at one scale for every book, so a big book takes more of the screen; the biggest book sets the scale. Desktop: cover left, metadata right. Phone: cover on top, metadata below, swipe down to close: the card follows the finger and the scrim fades; past `closeSwipePx` (or flicked) the cover flies back from where it is, otherwise the card springs back up. The details scroll first when they are not at their top. The photo prints close the same way. Arrow keys or a sideways swipe go to the neighbouring book in shelf order, across rows (the sideways swipe is still to build). Esc closes. A swipe on an open view never scrolls the page behind it.
- **Back button**: an open book or the photo prints get their own history entry (`#slug` for a book), so Back closes the view instead of leaving the site. Closing it any other way goes back past that entry too. Stepping to another book in the open view replaces the entry. A shared `#slug` link opens on the book with the bare page under it in history, so Back shows the shelf before leaving.
- **Easter egg, free orbit**: Space + drag on desktop (Space's page-scroll is suppressed only while the pointer is over the 3D view). Two-finger drag on phone; pinch zooms the 3D camera only inside orbit mode. Any vertical scroll or the "↺" button eases the camera back onto its path. The kitchen side (drawers and cupboards) has to hold up to the same standard, since orbit shows it.
- **View all** (footer link): every cover flies off the shelf, turning from where it stands to face the viewer, onto a wall of covers over the open views' scrim, and back onto the shelf on close. The covers keep their real sizes at one scale (the screen's shorter side sets it: three or four across on a phone) and stand on the baseline of their row, in shelf order. The wall is bigger than the screen both ways, in proportion to it, and opens on its middle; it pans both ways: drag with momentum and a rubber band at the edges, trackpad or wheel, arrow keys. No wrap-around: every book appears once. A cover opens its book, whose cover flies off the wall and back onto it; arrow keys in the open book step through shelf order and bring the next cover onto the wall's screen. Its own history entry, so Back closes the book first, then the wall. Small copies of the covers (`public/covers/small/`, ~13 KB each, made by `npm run thumbs`) show while the wall flies in; the full covers load once a cover is near the screen. Real links (`#slug`) for accessibility and search engines. Still to build: ES/EN filter that animates the re-sort.
- **Deep links**: `#slug` per book opens the site zoomed in with that book open.

## Tech

Vite + TypeScript + three.js + GSAP ScrollTrigger. Blender (Cycles) for modelling, baking and the poster render. `postprocessing` + N8AO for the render passes; KTX2 textures and meshopt-compressed `.glb`. Static build uploaded to Hostinger. Loading: the page first shows a still of the opening frame (`public/poster/`, placed by `src/poster.css`) while the scene loads, decodes its images, compiles its shaders and uploads its textures in short steps (`src/warmup.ts`); the 3D canvas then fades in over it. After a change to the island, the books, the polaroids or the opening camera, open the dev site with `?poster` to render a new still. Cookieless analytics (Hostinger stats or GoatCounter), no cookie banner.

## Order of work

1. **Done**: island dimensions from the construction drawing; whitebox island with placeholder books in `src/`, for tuning the camera path and the magnifier on a real phone.
2. **Raúl**: Libib scan done (4 Oct 2026: 85 books, exports in `references/library_*.csv`). Isabel & Linda polaroid photos in (`public/polaroids/`, square crops, metadata stripped). Still to come: the other two polaroid photos, captions, stool measurements, and the photos listed below.
3. **Done, first pass**: Blender model of the island with materials from published values and a CC0 oak scan (`blender/build_island.py`); first Cycles renders in `blender/renders/`. Still to check against Raúl's material photos and stool measurements; any change is a re-run of `npm run bake`.
4. **In progress**: bake and export done (`blender/bake_export.py`, run with `npm run bake`, writes `public/island/`); whitebox swapped for the `.glb`, which matches the Cycles render from the same camera to within a few percent. Textures are JPG/PNG for now; KTX2 needs `toktx` (KTX-Software) installed and waits for the performance pass. Real data done: `data/books.json` holds the 85 books in the Libib collection in shelf order, plus *Los medios de transporte* (added 5 Oct 2026 from Raúl's photos `references/IMG_8573`–`8574`; first on the Spanish shelf, not yet in the Libib export) and the *Bluey y sus amigos* box of four little books (one ISBN, from `references/IMG_8575`–`8577`; after *Buenas noches, Luna*, not in the Libib export; it stands like a book, showing the four spines, and turns to show the box's front), with sizes from Amazon listings; books too tall for the shelf are scaled down to fit. Each entry's `verify` lists what still needs checking. Spines done: all 87 cut from Raúl's shelf photos (`references/spines/`, corners in `references/spines/quads.json`), straightened, and loaded as `public/spines/{slug}.jpg` (1.2 MB in all). Each book's thickness is measured from its spine photo, and its height too where the Amazon listing disagreed. Covers done for 86 books (`public/covers/{slug}.jpg`, ~110 KB each, ~9 MB in all): Amazon listing images checked against the spines, Open Library where Amazon's was wrong, two flattened from angled product shots, four (Fox in a Box, Whiskers & Rhymes, the La Fontaine fables, Peter Rabbit: A Christmas Wish) flattened from Raúl's photos (`references/IMG_8557`–`8561`). A cover loads when its book is first pulled out, and shows in the detail view. Each book's cover width comes from its cover's proportions; books too tall or too deep for the shelf are scaled down evenly. Still missing: The World of Peter Rabbit box set (shows only its spine). Detail view filled in: one-sentence ES/EN summary per book (`about` in `books.json`, written by Claude from publisher blurbs, waiting for Raúl's review), illustrator and translator credits, original title, first publication, series, box-set contents and the edition (publisher, year, pages); publisher names tidied from Libib's raw strings. Next: photoreal book geometry; other-language editions and buy links.
5. **Then**: detail view, View all grid, polish, performance pass on a real phone.

## Later, not now

Notes from Linda, per-book share previews, header iterations.

## Still needed from Raúl

Island measurements are in `references/island-measurements.md`.

Stools
1. Seat length × width, seat thickness
2. Leg thickness and splay (straight or angled)
3. Footrest height
4. Photos: front, side, three-quarter, and the underside of the seat

Photos for materials (daylight, no direct sun, phone at 1×, a sheet of white paper or a grey card in frame)
5. Blue panel, straight-on, filling the frame
6. Oak: a leg, a shelf edge and a shelf surface, close enough to see the grain
7. Worktop, straight-on, filling the frame
8. A drawer front and a cupboard door, to check gaps and handles

Photos for spines (books on the shelf, as they stand)
9. Each shelf straight-on, phone level with the shelf and parallel to it, 4–5 overlapping shots per shelf moving sideways. No flash.
10. Any book whose spine is hidden or unreadable: a separate photo of its spine.
