# School wayfinding

A phone web app that gives walking directions between rooms of the school,
drawn from the hand sketch of the ground floor. Scan a QR placard on a wall,
type where you want to go, and the app walks you there one step at a time
with a small map of each step.

## How it fits together

| File | What it is |
|---|---|
| `index.html` | The app: search box, step-by-step directions, floor plan |
| `engine.js` | The route finder (shortest walk, turned into sentences) |
| `map.js` | The school as a graph: rooms, corridor junctions, edges |
| `plans/school-ground.svg` | The drawn floor plan the app shows |
| `scanpoints.js` | The QR placards: two-letter code, room, where to mount it |
| `site.json` | The public address of the app - baked into every QR code |
| `tools/build-school-map.js` | Generates `map.js`, the SVG, `scanpoints.js` and `maps/school-ground.json` from one room list |
| `tools/make-placards.js` | Generates the QR codes (`qr-png/`) and a print sheet (`placards.html`) |
| `tools/placard-sheet.py` | Puts every QR code on one labelled poster, `qr-png/all-placards.png` |
| `plans/school-map-transcription.md` | The sketch, read into text |

## Change the map

Edit the room list in `tools/build-school-map.js` (rooms are rectangles in
plan pixels; 10 px is about 1 metre), then:

```bash
node tools/build-school-map.js
```

It validates the map with the app's own engine and refuses to write one where
any room is unreachable from a placard.

The grades on the sketch were left blank, so classrooms are numbered 1 to 6.
The big rounded shape with steps is unlabelled on the sketch; the app calls it
the Amphitheatre. The Cafeteria sits about 150 m along the corridor from
Reception, further than the sketch suggests.

## Put it on GitHub Pages

1. Create a repository on GitHub and push this whole folder to it.
2. In the repository settings, open **Pages** and set the source to the `main`
   branch, root folder. GitHub gives you an address like
   `https://<your-user>.github.io/<repo>`.
3. Put that address in `site.json`.
4. Make the placards (see below) and push again.

Nothing else is needed: the app is static files and never talks to a server.
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

There are 15 placards: Main Entrance, Reception 2, Cafeteria, Library
Entrance, Amphitheatre, PLC, Staffroom, Meeting Room, Kanvas Studio, Kukoos
Studio, Maker's Hive-1, Conference Room, Teacher's Cubicle, the stairs opposite
Reception and the lobby stairs. Add or remove them in the builder.

## Run it on your computer

```bash
python -m http.server 8139
```

Then open `http://localhost:8139/?s=ME`. The `s=` code is the placard that
was scanned. `?to=lib` pre-fills a destination for a shared link. The gear
button at the top right has a test panel where you can pretend to scan any
placard.
