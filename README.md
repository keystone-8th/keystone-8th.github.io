# School wayfinding

A phone web app that gives walking directions between rooms of the school,
drawn from three hand sketches: the ground floor (gate, Reception, Infirmary,
Football Field, EYP Atelier), the Atelier's own classrooms, and the first floor
(classrooms, studios, the Library, Reception 2, the Cafeteria). Routes change
floor by the stairs or the lift.
Scan a QR placard on a wall,
type where you want to go, and the app walks you there one step at a time
with a small map of each step.

## How it fits together

| File | What it is |
|---|---|
| `index.html` | The app: search box, step-by-step directions, floor plan |
| `engine.js` | The route finder (shortest walk, turned into sentences) |
| `map.js` | The school as a graph: rooms, corridor junctions, edges |
| `plans/school-ground.svg` | The drawn ground-floor plan |
| `plans/school-first.svg` | The drawn first-floor plan |
| `scanpoints.js` | The QR placards: two-letter code, room, where to mount it |
| `site.json` | The public address of the app - baked into every QR code |
| `tools/build-school-map.js` | Generates `map.js`, both SVG plans, `scanpoints.js` and `maps/school-ground.json` from one room list per floor |
| `tools/make-placards.js` | Generates the QR codes (`qr-png/`) and a print sheet (`placards.html`) |
| `tools/placard-sheet.py` | Puts every QR code on one labelled poster, `qr-png/all-placards.png` |
| `tools/stamp-sw.js` | Gives the offline copy a new version stamp so phones pick up changes |
| `plans/ground-trace.json` | The ground floor traced off the photos: every wall, room, door and circle in photo pixels |
| `plans/school-map-transcription.md` | The sketches, read into text |

## Change the map

Edit the room list in `tools/build-school-map.js` (rooms are rectangles in
plan pixels; 10 px is about 1 metre), then:

```bash
node tools/build-school-map.js
```

It validates the map with the app's own engine and refuses to write one where
any room is unreachable from a placard.

The grades on the first-floor sketch were left blank, so classrooms are
numbered 1 to 6. The big rounded shape with steps is unlabelled; the app calls
it the Amphitheatre. The Cafeteria sits about 150 m along the corridor from
Reception 2, further than the sketch suggests, with the Gallery Area (a rock
garden) along the way. The doorway drawn beside Classroom 3 is not an entrance.

The ground floor is traced from the photos of the sketch, then extended where
the school described more than the sketch shows. `plans/ground-trace.json` holds
the traced parts, measured by detecting the pencil lines: the reception
corridor and its stairs, Reception and the Lift, the hall with its stairs and
planters, the Atelier and its rooms (mapped in from the second photo), and the
Main Gate. The builder draws the ground floor larger than the first trace, but
walking distances stay in true metres.

Laid out west to east: the Infirmary is at the very end of the corridor, then
four rooms along it, then the reception corridor with double doors at each end
and the Cafeteria Stairs beside it, then Reception with the Lift and the main
entrance, then a hall with three round planters and the First Floor Stairs,
with two sets of doors into the EYP Atelier. The Atelier has Classes 1 to 4
along its straight wall, Classes 5 to 8 and the washrooms along its angled
wall, and a planted courtyard between them. The four rooms past the reception
corridor are not named yet, so they are drawn but not searchable.

The football field is a fenced, marked pitch right against the corridor wall.
**The only way to it is the door in the reception corridor.**

The floors are joined by two staircases and a lift:

- The **Cafeteria Stairs** by the reception corridor come out in the
  **Gallery Area** on the first floor.
- The **First Floor Stairs** in the hall come out **in front of the Cafeteria**.
- The **Lift** in Reception comes out in the corridor by Reception 2.
- **The stairs opposite Reception 2 are never used.** They are drawn on the
  first floor marked "not in use", with no link to the ground floor.

The lift counts as a longer walk than it is, so the stairs stay the default.
The bus bay on the sketch is left off on purpose.

## Put it on GitHub Pages

1. Create a repository on GitHub and push this whole folder to it.
2. In the repository settings, open **Pages** and set the source to the `main`
   branch, root folder. GitHub gives you an address like
   `https://<your-user>.github.io/<repo>`.
3. Put that address in `site.json`.
4. Make the placards (see below) and push again.

Nothing else is needed: the app is static files and never talks to a server.

After editing `index.html`, `engine.js` or `sw.js` by hand, run
`node tools/stamp-sw.js` before pushing (the map builder does it for you).
Phones keep a saved copy of the app for use without signal, and only replace
it when this stamp changes. A phone that already has the app open may need
one reload to pick up a new version.
`tools/deploy.sh` is an optional script that builds a minimal bundle in `dist/`
and pushes it; the plain push above works just as well.

## Print the QR placards

The QR codes contain the site address, so set `site.json` first, then:

```bash
node tools/make-placards.js
```

This writes one PNG per placard into `qr-png/` and a print sheet,
`placards.html`. `python tools/placard-sheet.py` then puts them all on one
poster, `qr-png/all-placards.png`. Open the sheet in a browser, print at 100%, cut out the
cards and stick each one where its mount note says. Every card also says
which room it is, so a visitor without a camera can still type it in.

There are 23 placards. Ground floor: Main Gate, Reception, Infirmary,
Football Field, EYP Atelier, First Floor Stairs, Cafeteria Stairs, Lift.
First floor: Reception 2, Cafeteria, Library Entrance, Amphitheatre, Gallery
Area, PLC, Staffroom, Meeting Room, Kanvas Studio, Kukoos Studio, Maker's
Hive-1, Conference Room, Teacher's Cubicle, the stairs opposite Reception 2 (not
in use) and the Cafeteria Stairs in the Gallery Area.

## Run it on your computer

```bash
python -m http.server 8139
```

Then open `http://localhost:8139/?s=MG`. The `s=` code is the placard that
was scanned. `?to=lib` pre-fills a destination for a shared link. The gear
button at the top right has a test panel where you can pretend to scan any
placard.
