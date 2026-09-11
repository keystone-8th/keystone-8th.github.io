/* ============================================================
   School map builder.

   ONE room list per floor, drawn from the two hand sketches (see
   plans/school-map-transcription.md), produces the things that must
   never disagree:

     plans/school-first.svg    the first-floor plan the app shows
     plans/school-ground.svg   the ground-floor plan
     map.js                    the route graph the app walks
     maps/school-ground.json   the same map as an editor bundle
     scanpoints.js             the QR placards

   Run:  node tools/build-school-map.js
   Coordinates are plan pixels; 10 px is about 1 metre.
   ============================================================ */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const W = 2850, H = 650;
/* The cafeteria is about 150 m along the corridor from Reception - the sketch
   drew it next door, but the paper was short, not the corridor. */
const CAF_X = 2650;
/* The Gallery Area: the open stretch between the lobby and the cafeteria,
   laid out as a rock garden on the SOUTH side of the corridor, open to the
   corridor along its top edge. */
const GAL = { x: 1500, y: 460, w: 1050, h: 169 };
const M_PER_PX = 0.1;

/* ---------- rooms: rectangles [x, y, w, h] ---------- */
/* cat: entry | common | class | studio | office | food | wash | stairs | none
   door: which wall the door is on - n s e w - always the corridor side. */
const ROOMS = [
  // west wall
  { id: "kanvas",  name: "Kanvas Studio",      cat: "studio", box: [ 22, 400,  88, 105], door: "e" },
  { id: "kukoos",  name: "Kukoos Studio",      cat: "studio", box: [ 22, 296,  88, 104], door: "e" },

  // bottom row (south wall)
  { id: "plc",     name: "PLC",                cat: "common", box: [110, 460, 105,  70], door: "n" },
  { id: "cls1",    name: "Classroom 1",        cat: "class",  box: [215, 460, 105,  70], door: "n", sub: "Grade not filled in" },
  { id: "conf",    name: "Conference Room",    cat: "office", box: [320, 460,  55,  70], door: "n" },
  { id: "store",   name: "",                   cat: "none",   box: [375, 460,  30,  70], hatch: true },
  { id: "staff",   name: "Staffroom",          cat: "office", box: [405, 460,  40,  70], door: "n" },
  { id: "boys-s",  name: "Boys Washroom (south)",  cat: "wash", box: [445, 460,  25,  70], door: "n", short: "BOYS" },
  { id: "wash-s",  name: "",                   cat: "none",   box: [470, 460,  65,  70], short: "Washrooms", wash: true },
  { id: "girls-s", name: "Girls Washroom (south)", cat: "wash", box: [535, 460,  25,  70], door: "n", short: "GIRLS" },
  { id: "cls2",    name: "Classroom 2",        cat: "class",  box: [560, 460, 145,  70], door: "n", sub: "Grade not filled in" },
  { id: "cls3",    name: "Classroom 3",        cat: "class",  box: [705, 460, 145,  70], door: "n", sub: "Grade not filled in" },
  { id: "cls4",    name: "Classroom 4",        cat: "class",  box: [895, 460, 125,  70], door: "n" },
  { id: "stairs-s",name: "Stairs (opposite Reception)",cat: "stairs", box: [1166, 462, 40, 26], short: "stairs", dir: "h" },
  { id: "stairs-se",name:"Stairs (cafeteria corner)", cat: "stairs", box: [CAF_X + 50, 462, 107, 32], short: "stairs", dir: "hl" },

  // middle row (north of the corridor)
  { id: "meet",    name: "Meeting Room",       cat: "office", box: [430, 274,  72,  62], door: "s" },
  { id: "stairs-m",name: "Stairs (by Meeting Room)", cat: "stairs", box: [502, 274, 33, 62], short: "stairs", dir: "v" },
  { id: "cls5",    name: "Classroom 5",        cat: "class",  box: [545, 274, 150,  62], door: "s", sub: "Grade not filled in" },
  { id: "cls6",    name: "Classroom 6",        cat: "class",  box: [695, 274, 132,  62], door: "s", sub: "Grade not filled in" },

  // north block by the wing
  { id: "lr",      name: "LR",                 cat: "common", box: [262,  95,  40,  40], door: "w" },
  { id: "stairs-n",name: "Stairs (by LR)",     cat: "stairs", box: [262, 135,  40,  30], short: "stairs", dir: "h" },

  // library and lobby
  { id: "lib-door",name: "Library Entrance",   cat: "entry",  box: [1087, 322,  48,  26], short: "Library Entrance", door: "e" },
  { id: "teach",   name: "Teacher's Cubicle",  cat: "office", box: [1053, 348,  75,  40], door: "e" },
  { id: "recep",   name: "Reception 2",        cat: "entry",  box: [1157, 305,  62,  56], door: "w" },
  { id: "stairs-ne",name:"Cafeteria Stairs", cat: "stairs", box: [1320, 145, 57, 26], short: "stairs", dir: "h" },
  { id: "caf",     name: "Cafeteria",          cat: "food",   box: [CAF_X, 165, 157, 261], door: "s" }
];

/* The bent wing: a strip of rooms along an axis from A up and to the right. */
const WING = { A: [40, 290], angle: -56,
  rooms: [
    { id: "ramp",   name: "",              cat: "none",   t: [0, 25],    hatch: true },
    { id: "hive2",  name: "Maker's Hive-2", cat: "studio", t: [25, 95] },
    { id: "hive1",  name: "Maker's Hive-1", cat: "studio", t: [95, 165] },
    { id: "boys-n", name: "Boys Washroom (north)",  cat: "wash", t: [165, 195], short: "BOYS" },
    { id: "wash-n", name: "",              cat: "none",   t: [195, 245], short: "Washrooms", wash: true },
    { id: "girls-n",name: "Girls Washroom (north)", cat: "wash", t: [245, 280], short: "GIRLS" }
  ] };
const rad = WING.angle * Math.PI / 180;
const D = [Math.cos(rad), Math.sin(rad)];           // along the wing
const N = [-Math.sin(rad), Math.cos(rad)];          // across, towards the inside
function wingPt(t, s) { return [WING.A[0] + D[0]*t + N[0]*s, WING.A[1] + D[1]*t + N[1]*s]; }

/* ---------- walk graph ---------- */
const NODES = [];
/* Which floor the nodes being declared belong to. The first sketch was the
   FIRST floor (it has Reception 2 and the Cafeteria); the second is the ground. */
let CUR = "F1";
function node(id, xy, extra) { NODES.push(Object.assign({ id, level: CUR, xy: xy.map(v => Math.round(v)) }, extra || {})); }
function centre(b) { return [b[0] + b[2]/2, b[1] + b[3]/2]; }

/* corridor spine, y = 420 */
const SPINE = [
  ["j-w", 128], ["j-plc", 161], ["j-cls1", 265], ["j-conf", 344], ["j-staff", 411],
  ["j-mid", 466], ["j-stm", 519], ["j-cls2", 615], ["j-cls3", 760],
  ["j-cls4", 957], ["j-teach", 1090], ["j-lobby", 1150], ["j-e1", 1700], ["j-gal", GAL.x + GAL.w / 2], ["j-e2", 2250], ["j-caf", CAF_X + 78], ["j-se", CAF_X + 142]
];
SPINE.forEach(([id, x]) => node(id, [x, 420]));

/* passage up the west side and along the wing */
node("j-kuk",   [128, 348]);
node("j-wing",  [122, 285]);
node("p-hive1", wingPt(130, 50));
node("p-boys",  wingPt(180, 50));
node("p-wash",  wingPt(220, 50));
node("p-girls", wingPt(262, 50));
node("p-north", [245, 125]);
node("a-top",   [330, 165]);
node("a-door",  [405, 225]);
node("a-side",  [412, 380]);
node("l-gap",   [1145, 372]);
node("lobby",   [1290, 290], { name: "Reception lobby" });

/* destinations */
ROOMS.filter(r => r.cat !== "none").forEach(r => {
  node(r.id, centre(r.box), { dest: true, cat: r.cat, name: r.name, sub: r.sub });
});
WING.rooms.filter(r => r.cat !== "none").forEach(r => {
  node(r.id, wingPt((r.t[0] + r.t[1]) / 2, 0), { dest: true, cat: r.cat, name: r.name });
});
node("prints",   [262, 186],  { dest: true, cat: "office", name: "Prints Room" });
node("amph",     [283, 290],  { dest: true, cat: "common", name: "Amphitheatre", sub: "Open steps - not labelled on the sketch" });
node("lib",      [930, 250],  { dest: true, cat: "common", name: "Library" });
node("gallery",  [GAL.x + GAL.w / 2, GAL.y + GAL.h / 2 + 10], { dest: true, cat: "common", name: "Gallery Area", sub: "Rock garden on the way to the Cafeteria" });
NODES.find(n => n.id === "recep").anchor = true;

/* ============================================================
   GROUND FLOOR - from the second and third sketches. One long block with a
   corridor down the middle: the Infirmary at the west end, Reception and the
   Lift in the middle, a staircase at each end. The Atelier is a wedge
   attached to the north side, with classrooms along its straight west wall
   and its angled east wall, and a planted courtyard between them. The
   Football Field sits to the north-west and the Main Gate to the south-east.
   The bus bay on the sketch is left out on purpose.
   ============================================================ */
const GW = 2500, GH = 1500;
const B = { x: 200, y: 620, w: 1500, h: 360 };       // the main block
const COR = { top: 770, bot: 860, y: 815 };          // its corridor band and centre line
const GF = {
  inf:   { x: 210,  y: 860, w: 310, h: 110 },        // Infirmary, south side
  recep: { x: 950,  y: 860, w: 290, h: 110 },        // Reception, south side
  ffs:   { x: 1400, y: 862, w: 250, h: 106 },        // First Floor Stairs, climbed right to left
  cs:    { x: 620,  y: 636, w: 180, h: 134 },        // Cafeteria Stairs, north side
  lift:  { x: 1300, y: 650, w: 80,  h: 120 },        // the lift, beside Reception
  field: { x: 230,  y: 140, w: 470, h: 360 },
  gate:  { x: 2070, y: 1230, w: 220, h: 90 },
  fieldX: 465, doorX: 1200, eypX: 1650, gateX: 2180, foreY: 1060, roadY: 1350
};

/* ---- the Atelier wedge: straight west wall, angled east wall ---- */
const AT = {
  sw: [1180, 620], nw: [1180, 140], n: [1640, 140], se: [2200, 620],
  wx: 1185, ww: 155,          // the west classroom strip
  ang: 0,                     // filled in below
  rooms: [                    // along the angled wall: distance along, and its length
    { id: "cls-a5", name: "Atelier Class 5", cat: "class", t: [20, 130] },
    { id: "cls-a6", name: "Atelier Class 6", cat: "class", t: [130, 240] },
    { id: "cls-a7", name: "Atelier Class 7", cat: "class", t: [240, 350] },
    { id: "cls-a8", name: "Atelier Class 8", cat: "class", t: [350, 460] },
    { id: "girls-a",name: "Girls Washroom (Atelier)", cat: "wash", short: "Girls", t: [460, 512] },
    { id: "boys-a", name: "Boys Washroom (Atelier)",  cat: "wash", short: "Boys",  t: [512, 564] }
  ],
  depth: 120,                 // how far the angled rooms reach into the wedge
  west: [                     // along the straight west wall, top to bottom
    { id: "cls-a1", name: "Atelier Class 1", y: 160 },
    { id: "cls-a2", name: "Atelier Class 2", y: 270 },
    { id: "cls-a3", name: "Atelier Class 3", y: 380 },
    { id: "cls-a4", name: "Atelier Class 4", y: 490 }
  ],
  wh: 105, corX: 1385,
  court: [[1430, 300], [1620, 300], [1900, 555], [1430, 555]]
};
AT.ang = Math.atan2(AT.se[1] - AT.n[1], AT.se[0] - AT.n[0]);
const AD = [Math.cos(AT.ang), Math.sin(AT.ang)];      // along the angled wall
const AN = [-Math.sin(AT.ang), Math.cos(AT.ang)];     // into the wedge
function atPt(d, depth) { return [AT.n[0] + AD[0]*d + AN[0]*depth, AT.n[1] + AD[1]*d + AN[1]*depth]; }

CUR = "G";
/* the corridor, west to east */
const GSPINE = [
  ["gc-w", 300], ["gc-inf", 365], ["gc-fld", GF.fieldX], ["gc-cs", 710], ["gc-rec", 1095],
  ["gc-door", GF.doorX], ["gc-lift", 1340], ["gc-ffs", 1525], ["gc-eyp", GF.eypX]
];
GSPINE.forEach(([id, x]) => node(id, [x, COR.y]));

node("infirmary", [GF.inf.x + GF.inf.w / 2, GF.inf.y + GF.inf.h / 2], { dest: true, cat: "office", name: "Infirmary", sub: "First aid and the nurse" });
node("g-recep",   [GF.recep.x + GF.recep.w / 2, GF.recep.y + GF.recep.h / 2], { dest: true, cat: "entry", name: "Reception", anchor: true });
node("ffs",       [GF.ffs.x + GF.ffs.w / 2, GF.ffs.y + GF.ffs.h / 2], { dest: true, cat: "stairs", name: "First Floor Stairs", sub: "Up to the first floor, beside Reception" });
node("cs",        [GF.cs.x + GF.cs.w / 2, GF.cs.y + GF.cs.h / 2], { dest: true, cat: "stairs", name: "Cafeteria Stairs (ground floor)", sub: "Up to the first floor" });
node("lift",      [GF.lift.x + GF.lift.w / 2, GF.lift.y + GF.lift.h / 2], { dest: true, cat: "stairs", name: "Lift", sub: "Step-free way up to the first floor" });

/* out to the field, the forecourt and the gate */
node("g-fld-door",[GF.fieldX, B.y]);
node("field-s",   [GF.fieldX, GF.field.y + GF.field.h]);
node("field",     [GF.field.x + GF.field.w / 2, GF.field.y + GF.field.h / 2], { dest: true, cat: "sport", name: "Football Field" });
node("g-out",     [GF.doorX, GF.foreY]);
node("g-fore",    [GF.gateX, GF.foreY]);
node("g-gate",    [GF.gateX, GF.gate.y + GF.gate.h], { dest: true, cat: "entry", name: "Main Gate", anchor: true, gate: true });

/* ---- inside the Atelier: a ring of corridor around the courtyard ---- */
node("a-door",    [GF.eypX, B.y]);
node("eyp",       [1650, 580], { dest: true, cat: "studio", name: "EYP Atelier", sub: "Early years wing" });
AT.west.forEach(function (r, i) {
  node("aw-" + i,  [AT.corX, r.y + AT.wh / 2]);
  node(r.id,       [AT.wx + AT.ww / 2, r.y + AT.wh / 2], { dest: true, cat: "class", name: r.name, sub: "EYP Atelier" });
});
node("a-n",       [AT.corX + 40, 240]);
AT.rooms.forEach(function (r, i) {
  const mid = (r.t[0] + r.t[1]) / 2;
  if (r.cat === "class") node("ad-" + i, atPt(mid, AT.depth + 45));
  node(r.id, atPt(mid, AT.depth / 2), { dest: true, cat: r.cat, name: r.name, sub: "EYP Atelier" });
});
CUR = "F1";

const BY = {}; NODES.forEach(n => BY[n.id] = n);

const EDGES = [];
function edge(a, b, text, rev, extra) {
  const p = BY[a], q = BY[b];
  if (!p || !q) throw new Error("edge to missing node " + a + " " + b);
  const len = Math.max(2, Math.round(Math.hypot(p.xy[0]-q.xy[0], p.xy[1]-q.xy[1]) * M_PER_PX));
  const e = Object.assign({ id: "e-" + a + "-" + b, from: a, to: b, mode: ["foot"], len, instruction: text || null }, extra || {});
  if (rev) e.instructionRev = rev;
  EDGES.push(e);
}

for (let i = 1; i < SPINE.length; i++) {
  if (SPINE[i-1][0] === "j-lobby")
    edge("j-lobby", "j-e1", "Follow the long corridor towards the Cafeteria. The Gallery Area opens off it on the way.",
                            "Follow the long corridor back towards Reception 2.");
  else edge(SPINE[i-1][0], SPINE[i][0]);
}

/* rooms hang off the nearest spine junction */
[["j-plc","plc"],["j-cls1","cls1"],["j-conf","conf"],["j-staff","staff"],["j-mid","boys-s"],
 ["j-stm","girls-s"],["j-cls2","cls2"],["j-cls3","cls3"],["j-cls4","cls4"],["j-lobby","stairs-s"],
 ["j-se","stairs-se"],["j-mid","meet"],["j-stm","stairs-m"],["j-cls2","cls5"],["j-cls3","cls6"],
 ["j-teach","teach"],["j-caf","caf"]].forEach(([j, r]) => edge(j, r));

edge("j-w", "j-kuk",
  "Take the narrow passage between the studios and the amphitheatre.",
  "Come down the passage to the main corridor.");
edge("j-w", "kanvas");
edge("j-kuk", "kukoos");
edge("j-kuk", "j-wing");
edge("j-wing", "hive2");
edge("j-wing", "p-hive1", "Follow the bent wing, keeping the Maker's Hives beside you.",
                          "Follow the bent wing back down towards the studios.");
edge("p-hive1", "hive1");
edge("p-hive1", "p-boys");
edge("p-boys", "boys-n");
edge("p-boys", "p-wash");
edge("p-wash", "p-girls");
edge("p-girls", "girls-n");
edge("p-girls", "p-north");
edge("p-north", "lr");
edge("p-north", "stairs-n");
edge("p-north", "prints");
edge("p-north", "a-top", "Walk along the top of the amphitheatre.", "Walk back along the top of the amphitheatre.");
edge("a-top", "a-door");
edge("a-door", "amph", "Go down the steps into the amphitheatre.", "Climb the steps out of the amphitheatre.");
edge("a-door", "a-side");
edge("a-side", "j-mid");

edge("j-lobby", "l-gap", "Go up through the gap between the Teacher's Cubicle and Reception 2.",
                          "Come back down past Reception 2 to the corridor.");
edge("l-gap", "lobby");
edge("lobby", "recep");
edge("recep", "l-gap");
edge("lobby", "stairs-ne");
edge("l-gap", "lib-door", "Go through the Library Entrance, beside the Teacher's Cubicle.",
                          "Leave the library through the Library Entrance.");
edge("lib-door", "lib");
edge("j-gal", "gallery");

/* ground floor */
for (let i = 1; i < GSPINE.length; i++) {
  if (GSPINE[i - 1][0] === "gc-fld")
    edge("gc-fld", "gc-cs", "Follow the corridor towards Reception.", "Follow the corridor towards the Infirmary end.");
  else edge(GSPINE[i - 1][0], GSPINE[i][0]);
}
edge("gc-inf", "infirmary", "The Infirmary is at the end of the corridor.", "Come out of the Infirmary into the corridor.");
edge("gc-rec", "g-recep");
edge("gc-ffs", "ffs");
edge("gc-cs", "cs");
edge("gc-lift", "lift");

edge("gc-fld", "g-fld-door", "Go out through the north door.", "Go in through the north door of the main block.");
edge("g-fld-door", "field-s", "Take the path across to the Football Field.", "Take the path back to the main block.");
edge("field-s", "field");

edge("gc-door", "g-out", "Go out through the main doors onto the forecourt.", "Go in through the main doors of the block.");
edge("g-out", "g-fore", "Cross the forecourt, past the planters.", "Cross the forecourt towards the main doors.");
edge("g-fore", "g-gate", "Walk down to the Main Gate.", "Come in from the Main Gate and walk up to the forecourt.");

/* the Atelier: in at the south, then a ring of corridor round the courtyard */
edge("gc-eyp", "a-door", "Go through the doors into the Atelier wing.", "Come out of the Atelier wing into the main corridor.");
edge("a-door", "eyp");
/* the corridor rings the courtyard: along the bottom, up the west side,
   round the top and back down beside the angled wall */
edge("eyp", "aw-3", "Follow the corridor along the bottom of the courtyard.",
                    "Follow the corridor back towards the Atelier doors.");
for (let i = 3; i > 0; i--) edge("aw-" + i, "aw-" + (i - 1));
AT.west.forEach((r, i) => edge("aw-" + i, r.id));
edge("aw-0", "a-n", "Go round the top of the courtyard.", "Go round the top of the courtyard.");
edge("a-n", "ad-0");
for (let i = 0; i < 3; i++) edge("ad-" + i, "ad-" + (i + 1));
edge("eyp", "ad-3", "Follow the corridor up the far side of the courtyard, past the washrooms.",
                    "Follow the corridor back down towards the Atelier doors.");
AT.rooms.forEach(function (r, i) { edge(r.cat === "class" ? "ad-" + i : "ad-3", r.id); });

/* the staircases and the lift that join the two floors. Their length is a
   flight of stairs, not the distance between two drawings. */
edge("ffs", "stairs-s", "Climb the First Floor Stairs. You come out on the first floor opposite Reception 2.",
                         "Take the stairs down to the ground floor. You come out beside Reception.", { len: 8 });
edge("cs", "stairs-ne", "Climb the Cafeteria Stairs to the first floor. You come out in the lobby behind Reception 2.",
                         "Take the Cafeteria Stairs down to the ground floor. You come out at the Infirmary end of the corridor.", { len: 8 });
// Counted as a good walk longer than it is, because waiting for a lift takes
// time a staircase does not. Without that the lift is the shortest path for
// everyone, and the app tells a whole school to queue for it.
edge("lift", "j-lobby", "Take the lift up to the first floor. You come out in the corridor by Reception 2.",
                         "Take the lift down to the ground floor. You come out beside Reception.", { len: 60 });

const MAP = {
  community: "School",
  view: { w: W, h: H },
  levels: [
    { id: "G",  name: "Ground Floor", underground: false, image: "plans/school-ground.svg", imageBox: [0, 0, GW, GH] },
    { id: "F1", name: "First Floor",  underground: false, image: "plans/school-first.svg",  imageBox: [0, 0, W, H] }
  ],
  blocks: [], slotRuns: [], allotments: [], slots: [],
  areas: ROOMS.filter(r => r.cat !== "none").map(r => ({
    id: "a-" + r.id, level: "F1", node: r.id, name: r.name,
    points: [[r.box[0], r.box[1]], [r.box[0]+r.box[2], r.box[1]], [r.box[0]+r.box[2], r.box[1]+r.box[3]], [r.box[0], r.box[1]+r.box[3]]]
  })),
  nodes: NODES,
  edges: EDGES
};

/* One placard at every place people arrive at or wait in. Two letters keep
   the URL short, which keeps the QR code coarse enough to scan from a metre
   away. */
const SCANPOINTS = [
  { id: "RC", node: "recep",    label: "Reception 2",       mount: "On the reception counter." },
  { id: "CF", node: "caf",      label: "Cafeteria",         mount: "Beside the cafeteria door." },
  { id: "LB", node: "lib-door", label: "Library Entrance",  mount: "On the library door frame." },
  { id: "AM", node: "amph",     label: "Amphitheatre",      mount: "On the post at the top of the steps." },
  { id: "PL", node: "plc",      label: "PLC",               mount: "Beside the PLC door." },
  { id: "SR", node: "staff",    label: "Staffroom",         mount: "Beside the staffroom door." },
  { id: "MR", node: "meet",     label: "Meeting Room",      mount: "Beside the meeting room door." },
  { id: "KV", node: "kanvas",   label: "Kanvas Studio",     mount: "Beside the studio door." },
  { id: "KK", node: "kukoos",   label: "Kukoos Studio",     mount: "Beside the studio door." },
  { id: "MH", node: "hive1",    label: "Maker's Hive-1",    mount: "Beside the Maker's Hive-1 door." },
  { id: "CR", node: "conf",     label: "Conference Room",   mount: "Beside the conference room door." },
  { id: "TC", node: "teach",    label: "Teacher's Cubicle", mount: "On the cubicle partition." },
  { id: "SS", node: "stairs-s", label: "Stairs opposite Reception", mount: "At the foot of the stairs." },
  { id: "SN", node: "stairs-ne",label: "Cafeteria Stairs", mount: "At the foot of the stairs, in the lobby behind Reception 2." },
  { id: "GA", node: "gallery",  label: "Gallery Area",      mount: "On the wall at the corridor end of the rock garden." },
  // ground floor
  { id: "MG", node: "g-gate",   level: "G", label: "Main Gate",         mount: "On the gatepost, inside the gate." },
  { id: "R1", node: "g-recep",  level: "G", label: "Reception",         mount: "On the reception counter." },
  { id: "IN", node: "infirmary",level: "G", label: "Infirmary",         mount: "Beside the infirmary door." },
  { id: "FF", node: "field",    level: "G", label: "Football Field",    mount: "On the post at the field entrance." },
  { id: "EY", node: "eyp",      level: "G", label: "EYP Atelier",       mount: "Beside the atelier door." },
  { id: "FS", node: "ffs",      level: "G", label: "First Floor Stairs",mount: "At the foot of the stairs." },
  { id: "LF", node: "lift",     level: "G", label: "Lift",               mount: "Beside the lift door, in the corridor." },
  { id: "CS", node: "cs",       level: "G", label: "Cafeteria Stairs (ground)", mount: "At the foot of the stairs." }
].map(p => Object.assign({ level: "F1", audience: "foot", rev: 1 }, p));

/* ============================================================
   SVG plan. Walls, doors, furniture and greenery, so the drawing reads as
   a building rather than a row of labelled boxes.
   ============================================================ */
const C = {
  grass: "#d9e4c4", walk: "#e8e2d3", floor: "#f4efe3", corridor: "#ece4d2", wall: "#3d3934",
  wood: "#c9a97a", woodDark: "#a98756", table: "#e6d9bf", chair: "#8d8a83",
  tree: "#8fb26e", treeDark: "#5f8a44", text: "#2b2a27"
};
let svg = [];
function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
function attrs(a) { return Object.keys(a).map(k => ' ' + k + '="' + a[k] + '"').join(""); }
function r1(v) { return Math.round(v * 10) / 10; }
function rect(x, y, w, h, a) { svg.push('<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '"' + attrs(a || {}) + '/>'); }
function circle(cx, cy, r, a) { svg.push('<circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="' + r + '"' + attrs(a || {}) + '/>'); }
function line(x1, y1, x2, y2, a) { svg.push('<line x1="' + r1(x1) + '" y1="' + r1(y1) + '" x2="' + r1(x2) + '" y2="' + r1(y2) + '"' + attrs(a || {}) + '/>'); }
function pathd(d, a) { svg.push('<path d="' + d + '"' + attrs(a || {}) + '/>'); }
function label(cx, cy, text, opts) {
  opts = opts || {};
  const lines = String(text).split("\n");
  const size = opts.size || 12;
  const rot = opts.rot ? ' transform="rotate(' + opts.rot + ' ' + r1(cx) + ' ' + r1(cy) + ')"' : "";
  const y0 = cy - (lines.length - 1) * size * 0.6;
  svg.push('<text x="' + r1(cx) + '" y="' + r1(y0) + '" font-size="' + size + '" font-weight="' + (opts.weight || 600) +
    '" text-anchor="middle" dominant-baseline="middle" fill="' + (opts.fill || C.text) + '"' + rot +
    ' paint-order="stroke" stroke="' + (opts.halo || C.floor) + '" stroke-width="3" stroke-linejoin="round">' +
    lines.map((l, i) => '<tspan x="' + r1(cx) + '"' + (i ? ' dy="' + (size * 1.15) + '"' : "") + '>' + esc(l) + '</tspan>').join("") + "</text>");
}

/* ---- furniture, drawn inside a box in whatever coordinate frame is current ---- */
function boardAndDesk(x, y, w, h, side) {
  // side = the wall opposite the door: whiteboard on it, teacher's desk under it
  if (side === "s") { line(x + w * 0.2, y + h - 3, x + w * 0.8, y + h - 3, { stroke: "#5b7d9a", "stroke-width": 2.5 });
                      rect(x + w / 2 - 9, y + h - 15, 18, 7, { fill: C.wood, stroke: C.woodDark, "stroke-width": 0.6 }); }
  else { line(x + w * 0.2, y + 3, x + w * 0.8, y + 3, { stroke: "#5b7d9a", "stroke-width": 2.5 });
         rect(x + w / 2 - 9, y + 8, 18, 7, { fill: C.wood, stroke: C.woodDark, "stroke-width": 0.6 }); }
}
function classroom(x, y, w, h, door) {
  const boardSide = door === "n" ? "s" : "n";
  boardAndDesk(x, y, w, h, boardSide);
  const rows = Math.max(1, Math.floor((h - 30) / 14)), cols = Math.max(1, Math.floor((w - 16) / 15));
  const ox = x + (w - cols * 15) / 2 + 3, oy = boardSide === "s" ? y + 8 : y + 20;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    rect(ox + c * 15, oy + r * 14, 9, 6, { fill: C.wood, stroke: C.woodDark, "stroke-width": 0.6 });
    circle(ox + c * 15 + 4.5, oy + r * 14 + (boardSide === "s" ? -3 : 9.5), 1.8, { fill: C.chair });
  }
}
function meetingTable(x, y, w, h) {
  const tw = Math.min(w - 22, 60), th = Math.min(h - 22, 24);
  const cx = x + w / 2, cy = y + h / 2;
  rect(cx - tw / 2, cy - th / 2, tw, th, { rx: th / 2, fill: C.table, stroke: C.woodDark, "stroke-width": 0.8 });
  const n = Math.max(2, Math.floor(tw / 12));
  for (let i = 0; i < n; i++) {
    const px = cx - tw / 2 + tw * (i + 0.5) / n;
    circle(px, cy - th / 2 - 5, 2.3, { fill: C.chair });
    circle(px, cy + th / 2 + 5, 2.3, { fill: C.chair });
  }
}
function workbenches(x, y, w, h) {
  const cols = Math.max(1, Math.floor((w - 14) / 30)), rows = Math.max(1, Math.floor((h - 18) / 24));
  const ox = x + (w - cols * 30) / 2 + 4, oy = y + 12 + (h - 12 - rows * 24) / 2;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    rect(ox + c * 30, oy + r * 24, 22, 12, { fill: "#d8c7a4", stroke: C.woodDark, "stroke-width": 0.7 });
    for (let k = 0; k < 3; k++) circle(ox + c * 30 + 4 + k * 7, oy + r * 24 + 16, 1.8, { fill: C.chair });
  }
  rect(x + 3, y + 3, w - 6, 5, { fill: "#b9c4c9" });   // sink and tool wall
}
function cafeteria(x, y, w, h) {
  rect(x + 6, y + 6, w - 12, 16, { fill: "#cfd7dc", stroke: "#8e9aa3", "stroke-width": 0.8 });   // serving counter
  for (let i = 0; i < 6; i++) rect(x + 12 + i * 22, y + 9, 12, 8, { fill: "#f0e4c8", stroke: "#b7a67f", "stroke-width": 0.5 });
  const cols = 3, rows = Math.floor((h - 40) / 40);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cx = x + w * (c + 0.5) / cols, cy = y + 40 + r * 40 + 14;
    circle(cx, cy, 9, { fill: C.table, stroke: C.woodDark, "stroke-width": 0.8 });
    [[0, -14], [0, 14], [-14, 0], [14, 0]].forEach(d => circle(cx + d[0], cy + d[1], 3, { fill: C.chair }));
  }
}
function washroom(x, y, w, h, vertical) {
  if (vertical) {
    const n = Math.max(2, Math.floor((h - 8) / 12));
    for (let i = 0; i < n; i++) rect(x + 3, y + 4 + i * 12, 8, 9, { fill: "#e8edf0", stroke: "#8e9aa3", "stroke-width": 0.6 });
    for (let i = 0; i < Math.max(1, n - 1); i++) circle(x + w - 5, y + 10 + i * 12, 2.6, { fill: "#fff", stroke: "#8e9aa3", "stroke-width": 0.7 });
  } else {
    const n = Math.max(2, Math.floor((w - 8) / 12));
    for (let i = 0; i < n; i++) rect(x + 4 + i * 12, y + 3, 9, 8, { fill: "#e8edf0", stroke: "#8e9aa3", "stroke-width": 0.6 });
    for (let i = 0; i < Math.max(1, n - 1); i++) circle(x + 10 + i * 12, y + h - 5, 2.6, { fill: "#fff", stroke: "#8e9aa3", "stroke-width": 0.7 });
  }
}
function stairs(x, y, w, h, dir) {
  const n = 6;
  const across = dir === "h" || dir === "hl";
  if (across) for (let i = 1; i < n; i++) line(x + w * i / n, y + 2, x + w * i / n, y + h - 2, { stroke: C.wall, "stroke-width": 1 });
  else for (let i = 1; i < n; i++) line(x + 2, y + h * i / n, x + w - 2, y + h * i / n, { stroke: C.wall, "stroke-width": 1 });
  // The arrow points the way UP, so it says which way the flight is climbed.
  if (dir === "h")       pathd("M" + r1(x + 5) + " " + r1(y + h / 2) + " H" + r1(x + w - 7) + " m-4 -3 l4 3 l-4 3", { fill: "none", stroke: "#7a5a2a", "stroke-width": 1.4 });
  else if (dir === "hl") pathd("M" + r1(x + w - 5) + " " + r1(y + h / 2) + " H" + r1(x + 7) + " m4 -3 l-4 3 l4 3", { fill: "none", stroke: "#7a5a2a", "stroke-width": 1.4 });
  else pathd("M" + r1(x + w / 2) + " " + r1(y + h - 5) + " V" + r1(y + 7) + " m-3 4 l3 -4 l3 4", { fill: "none", stroke: "#7a5a2a", "stroke-width": 1.4 });
}
function shelves(x, y, w, h, vertical) {
  if (vertical) { const n = Math.floor((w - 4) / 10); for (let i = 0; i < n; i++) rect(x + 3 + i * 10, y + 3, 4, h - 6, { fill: C.woodDark }); }
  else { const n = Math.floor((h - 4) / 10); for (let i = 0; i < n; i++) rect(x + 3, y + 3 + i * 10, w - 6, 4, { fill: C.woodDark }); }
}
function tree(cx, cy, r) {
  circle(cx + 1.5, cy + 1.5, r, { fill: "rgba(0,0,0,.12)" });
  circle(cx, cy, r, { fill: C.tree });
  circle(cx - r * 0.3, cy - r * 0.3, r * 0.55, { fill: C.treeDark, opacity: 0.55 });
}
/* Small deterministic generator so the rocks land in the same places every build. */
let seed = 7;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function rock(cx, cy, r) {
  const n = 6 + Math.floor(rnd() * 3), pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * (0.7 + rnd() * 0.5);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8]);
  }
  const d = pts.map(p => p.map(v => r1(v)).join(",")).join(" ");
  svg.push('<polygon points="' + d + '" transform="translate(2 2)" fill="rgba(0,0,0,.14)"/>');
  svg.push('<polygon points="' + d + '" fill="#a8a196" stroke="#6e685f" stroke-width="1"/>');
  // a lighter face so it reads as a lump, not a blot
  svg.push('<polygon points="' + pts.slice(0, Math.ceil(n / 2) + 1).map(p => r1(p[0] - r * 0.15) + "," + r1(p[1] - r * 0.15)).join(" ") + '" fill="#c4bdb1" opacity="0.7"/>');
}
function gallery(g) {
  rect(g.x, g.y, g.w, g.h, { fill: "url(#gravel)" });
  line(g.x, g.y + g.h, g.x + g.w, g.y + g.h, { stroke: C.wall, "stroke-width": 3 });
  line(g.x, g.y, g.x, g.y + g.h, { stroke: C.wall, "stroke-width": 3 });
  line(g.x + g.w, g.y, g.x + g.w, g.y + g.h, { stroke: C.wall, "stroke-width": 3 });
  // a winding stepping-stone path through the middle
  for (let x = g.x + 40; x < g.x + g.w - 30; x += 34) {
    const y = g.y + g.h / 2 + Math.sin((x - g.x) / 90) * 28;
    svg.push('<ellipse cx="' + r1(x) + '" cy="' + r1(y) + '" rx="12" ry="8" fill="#d8d2c6" stroke="#9a9388" stroke-width="1"/>');
  }
  // boulders of three sizes, kept off the stepping stones
  for (let i = 0; i < 26; i++) {
    const x = g.x + 25 + rnd() * (g.w - 50), y = g.y + 22 + rnd() * (g.h - 44);
    const mid = g.y + g.h / 2 + Math.sin((x - g.x) / 90) * 28;
    if (Math.abs(y - mid) < 22) continue;
    rock(x, y, 7 + rnd() * 13);
  }
  for (let i = 0; i < 60; i++) rock(g.x + 12 + rnd() * (g.w - 24), g.y + 12 + rnd() * (g.h - 24), 2 + rnd() * 2.5);
  // a few shrubs and benches along the edges
  [0.15, 0.4, 0.65, 0.9].forEach(f => { tree(g.x + g.w * f, g.y + g.h - 26, 9); });
  [0.28, 0.55, 0.8].forEach(f => bench(g.x + g.w * f - 20, g.y + 10, 40));
}
function plant(cx, cy) { circle(cx, cy, 4, { fill: "#8e7b5c" }); circle(cx, cy, 3, { fill: C.treeDark }); }
function bench(x, y, w) { rect(x, y, w, 4, { fill: C.wood, stroke: C.woodDark, "stroke-width": 0.5 }); }

/* A door: a gap in the wall and the swing of the leaf. */
function door(x, y, w, h, side, at) {
  at = at == null ? 0.5 : at;
  const d = 14;
  const gap = { stroke: C.corridor, "stroke-width": 4 };
  const leaf = { fill: "none", stroke: C.wall, "stroke-width": 1 };
  if (side === "n") { const px = x + w * at - d / 2; line(px, y, px + d, y, gap);
    pathd("M" + r1(px) + " " + r1(y) + " v" + d + " a" + d + " " + d + " 0 0 0 " + d + " -" + d, leaf); }
  if (side === "s") { const px = x + w * at - d / 2; line(px, y + h, px + d, y + h, gap);
    pathd("M" + r1(px) + " " + r1(y + h) + " v-" + d + " a" + d + " " + d + " 0 0 1 " + d + " " + d, leaf); }
  if (side === "e") { const py = y + h * at - d / 2; line(x + w, py, x + w, py + d, gap);
    pathd("M" + r1(x + w) + " " + r1(py) + " h-" + d + " a" + d + " " + d + " 0 0 0 " + d + " " + d, leaf); }
  if (side === "w") { const py = y + h * at - d / 2; line(x, py, x, py + d, gap);
    pathd("M" + r1(x) + " " + r1(py) + " h" + d + " a" + d + " " + d + " 0 0 1 -" + d + " " + d, leaf); }
}

function furnish(r, x, y, w, h) {
  if (r.hatch) return;
  if (r.wash) { washroom(x, y, w, h, h > w); return; }
  switch (r.cat) {
    case "class":  classroom(x, y, w, h, r.door); break;
    case "office": if (w < 50 && h > w) shelves(x, y, w, h, false); else meetingTable(x, y, w, h); break;
    case "studio": workbenches(x, y, w, h); break;
    case "food":   cafeteria(x, y, w, h); break;
    case "wash":   washroom(x, y, w, h, h > w); break;
    case "stairs": stairs(x, y, w, h, r.dir || (h > w ? "v" : "h")); break;
    case "common":
      if (r.id === "plc") classroom(x, y, w, h, "n");
      else shelves(x, y, w, h, true);
      break;
    case "entry":
      if (r.id === "recep") { rect(x + 8, y + h - 20, w - 16, 9, { rx: 3, fill: "#cfd7dc", stroke: "#8e9aa3", "stroke-width": 0.8 });
                              circle(x + w / 2, y + h - 26, 2.5, { fill: C.chair }); plant(x + 8, y + 8); plant(x + w - 8, y + 8); }
      break;
  }
}

function fitLabel(r, x, y, w, h, rot) {
  const t = r.short || r.name;
  if (!t) return;
  const cx = x + w / 2, cy = y + h / 2;
  if (rot != null) { label(cx, cy, t.length > 12 ? t.replace(" ", "\n") : t, { size: w < 35 ? 8 : w < 60 ? 9.5 : 11, rot: rot }); return; }
  if (w < 45 && h > w) { label(cx, cy, t, { size: 10, rot: -90 }); return; }
  if (w < 80 && t.length > 10) { label(cx, cy, t.replace(/ /g, "\n"), { size: 10.5 }); return; }
  label(cx, cy, t, { size: w < 60 ? 10.5 : 12.5 });
}

/* ---------- draw ---------- */
svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif">');
svg.push('<defs>' +
  '<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#8a7f6a" stroke-width="2"/></pattern>' +
  '<pattern id="tiles" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="' + C.corridor + '"/><path d="M24 0 V24 M0 24 H24" stroke="#e0d6c0" stroke-width="1"/></pattern>' +
  '<pattern id="lawn" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="' + C.grass + '"/><circle cx="4" cy="5" r="1" fill="#c8d6ae"/><circle cx="10" cy="11" r="1" fill="#c8d6ae"/></pattern>' +
  '<clipPath id="amc"><ellipse cx="283" cy="290" rx="120" ry="112"/></clipPath>' +
  '<clipPath id="amr"><rect x="300" y="150" width="130" height="290"/></clipPath>' +
  '<pattern id="gravel" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#e3ddd0"/><circle cx="3" cy="3" r="0.9" fill="#c9c2b4"/><circle cx="7.5" cy="7" r="0.7" fill="#c9c2b4"/></pattern>' +
  '</defs>');

// grounds
rect(0, 0, W, H, { fill: "url(#lawn)" });
rect(CAF_X - 60, 548, 300, 32, { fill: C.walk });          // and a path to the cafeteria door
[[700, 555], [780, 556], [1000, 556], [1080, 555]].forEach(p => tree(p[0], p[1], 9));
[[60, 200], [130, 60], [560, 120], [700, 100], [1220, 60], [1330, 70], [1560, 80], [1700, 200], [1900, 120], [2100, 240], [2300, 90], [2500, 200], [2780, 100], [2790, 520], [1800, 615], [2200, 625]].forEach(p => tree(p[0], p[1], 12));
[[610, 60], [1520, 500]].forEach(p => tree(p[0], p[1], 8));

// corridors and open floors
rect(110, 336, CAF_X + 47, 124, { fill: "url(#tiles)" });
rect(110, 150, 20, 186, { fill: "url(#tiles)" });
rect(1135, 139, 248, 270, { fill: "url(#tiles)" });
rect(830, 150, 200, 200, { fill: C.floor });               // library floor
rect(200, 60, 120, 110, { fill: C.floor });                // floor around LR and the prints room

// the amphitheatre: a sunken bowl with stepped seating on the far side and a stage
svg.push('<g transform="rotate(-35 283 290)">');
svg.push('<ellipse cx="283" cy="290" rx="120" ry="112" fill="#e2d9c3" stroke="' + C.wall + '" stroke-width="2.5"/>');
svg.push('<g clip-path="url(#amc)"><g clip-path="url(#amr)">');
for (let k = 0; k < 7; k++) {
  const rx = 118 - k * 13, ry = 110 - k * 12;
  svg.push('<ellipse cx="283" cy="290" rx="' + rx + '" ry="' + ry + '" fill="' + (k % 2 ? "#d6cbb0" : "#e9e0cb") + '" stroke="' + C.wall + '" stroke-width="1"/>');
}
svg.push('</g></g>');
pathd("M223 240 a55 55 0 0 0 0 100 z", { fill: "#cbbfa4", stroke: C.wall, "stroke-width": 1.2 });   // stage
svg.push('</g>');

// walls that are not rooms
[[110, 460, GAL.x, 460], [GAL.x + GAL.w, 460, CAF_X + 157, 460], [1219, 409, 1383, 409], [1383, 409, 1383, 139], [1135, 139, 1383, 139], [1383, 409, CAF_X, 409], [1383, 336, 1383, 409], [CAF_X + 157, 139, CAF_X + 157, 530],
 [830, 150, 1030, 150], [1030, 150, 1030, 322], [830, 150, 830, 336], [830, 336, 1053, 336]]
  .forEach(l => line(l[0], l[1], l[2], l[3], { stroke: C.wall, "stroke-width": 3 }));

// rooms
ROOMS.forEach(r => {
  const [x, y, w, h] = r.box;
  rect(x, y, w, h, { fill: r.hatch ? "url(#hatch)" : C.floor, stroke: C.wall, "stroke-width": 2.5 });
  furnish(r, x, y, w, h);
  if (r.door) door(x, y, w, h, r.door, r.id === "recep" ? 0.7 : 0.5);
});

// the wing, drawn in its own rotated frame so the furniture sits square in the rooms
svg.push('<g transform="translate(' + WING.A[0] + ' ' + WING.A[1] + ') rotate(' + WING.angle + ')">');
WING.rooms.forEach(r => {
  const x = r.t[0], w = r.t[1] - r.t[0], y = -30, h = 60;
  rect(x, y, w, h, { fill: r.hatch ? "url(#hatch)" : C.floor, stroke: C.wall, "stroke-width": 2.5 });
  furnish(Object.assign({ door: "s" }, r), x, y, w, h);
  if (r.cat !== "none") door(x, y, w, h, "s", 0.5);
  fitLabel(r, x, y, w, h, 0);
});
svg.push('</g>');

// prints room, on the slant the sketch gives it
svg.push('<g transform="rotate(-30 262 186)">');
rect(243, 172, 39, 28, { fill: C.floor, stroke: C.wall, "stroke-width": 2.5 });
rect(247, 176, 12, 9, { fill: "#cfd7dc", stroke: "#8e9aa3", "stroke-width": 0.6 });
rect(262, 176, 16, 9, { fill: "#cfd7dc", stroke: "#8e9aa3", "stroke-width": 0.6 });
label(262, 191, "Prints Room", { size: 6.5 });
svg.push('</g>');

// library: shelves, reading tables, the reading garden with its steps
[0, 1, 2, 3].forEach(i => rect(845 + i * 22, 165, 6, 60, { fill: C.woodDark }));
pathd("M865 240 h70 v22 h-48 v40 h-22 z", { fill: C.woodDark, opacity: 0.85 });
[[900, 300], [960, 300], [930, 330]].forEach(p => {
  rect(p[0] - 14, p[1] - 7, 28, 14, { rx: 2, fill: C.table, stroke: C.woodDark, "stroke-width": 0.7 });
  [[-8, -11], [8, -11], [-8, 11], [8, 11]].forEach(d => circle(p[0] + d[0], p[1] + d[1], 2.3, { fill: C.chair }));
});
pathd("M955 158 c20 -18 40 -4 55 10 c15 -14 30 -10 18 16 c8 20 -16 34 -40 26 c-18 10 -50 4 -36 -22 c-10 -8 -6 -24 3 -30 z", { fill: "#cfdcb4", stroke: "#a3b98a", "stroke-width": 1 });
tree(975, 185, 10); tree(1000, 200, 7); tree(965, 210, 6);
for (let i = 0; i < 5; i++) line(1005, 235 + i * 5, 1025, 235 + i * 5, { stroke: C.wall, "stroke-width": 1 });
line(1005, 233, 1005, 258, { stroke: C.wall, "stroke-width": 1 }); line(1025, 233, 1025, 258, { stroke: C.wall, "stroke-width": 1 });

// the gallery area
gallery(GAL);
label(GAL.x + GAL.w / 2, GAL.y + GAL.h - 60, "Gallery Area", { size: 16, weight: 700, halo: "#e3ddd0" });

// lobby and corridor: seating and plants
bench(1240, 200, 40); bench(1300, 200, 40);
plant(1150, 150); plant(1370, 150); plant(1370, 395);
bench(560, 340, 40); bench(1240, 445, 40); bench(1300, 445, 40); plant(140, 345); plant(CAF_X + 140, 345);
for (let x = 1480; x < CAF_X - 60; x += 220) { bench(x, 340, 40); plant(x + 60, 348); if (x + 150 < GAL.x || x + 110 > GAL.x + GAL.w) bench(x + 110, 445, 40); }


// labels
ROOMS.forEach(r => fitLabel(r, r.box[0], r.box[1], r.box[2], r.box[3]));
label(930, 270, "Library", { size: 14, weight: 700 });
label(283, 295, "Amphitheatre", { size: 13, weight: 700, rot: -35, halo: "#e2d9c3" });
label(1258, 300, "Lobby", { size: 12, halo: C.corridor });
label(980, 240, "Reading\ngarden", { size: 8, halo: "#cfdcb4" });
// title and scale bar
svg.push('<text x="16" y="26" font-size="16" font-weight="700" fill="' + C.text + '">School - First Floor</text>');
line(16, 44, 116, 44, { stroke: C.text, "stroke-width": 2 }); line(16, 40, 16, 48, { stroke: C.text, "stroke-width": 2 }); line(116, 40, 116, 48, { stroke: C.text, "stroke-width": 2 });
svg.push('<text x="66" y="58" font-size="10" text-anchor="middle" fill="' + C.text + '">10 m</text>');
svg.push('</svg>');

fs.writeFileSync(path.join(ROOT, "plans", "school-first.svg"), svg.join("\n") + "\n");

/* ============================================================
   GROUND FLOOR PLAN
   ============================================================ */
svg = [];
svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + GW + ' ' + GH + '" width="' + GW + '" height="' + GH + '" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif">');
svg.push('<defs>' +
  '<pattern id="lawn" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="' + C.grass + '"/><circle cx="4" cy="5" r="1" fill="#c8d6ae"/><circle cx="10" cy="11" r="1" fill="#c8d6ae"/></pattern>' +
  '<pattern id="tiles" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="' + C.corridor + '"/><path d="M24 0 V24 M0 24 H24" stroke="#e0d6c0" stroke-width="1"/></pattern>' +
  '<pattern id="paving" width="30" height="30" patternUnits="userSpaceOnUse"><rect width="30" height="30" fill="' + C.walk + '"/><path d="M30 0 V30 M0 30 H30" stroke="#d8d0be" stroke-width="1"/></pattern>' +
  '<pattern id="pitch" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="80" height="80" fill="#7fb06a"/><rect width="40" height="80" fill="#88b972"/></pattern>' +
  '<pattern id="road" width="60" height="30" patternUnits="userSpaceOnUse"><rect width="60" height="30" fill="#8d8b88"/><rect x="10" y="14" width="26" height="2" fill="#e8e3d8"/></pattern>' +
  '</defs>');

function poly(pts, a) { svg.push('<polygon points="' + pts.map(q => r1(q[0]) + "," + r1(q[1])).join(" ") + '"' + attrs(a || {}) + '/>'); }
function liftCar(x, y, w, h) {
  rect(x + 7, y + 7, w - 14, h - 14, { fill: "#e8edf0", stroke: "#8e9aa3", "stroke-width": 1.2 });
  line(x + w / 2, y + 7, x + w / 2, y + h - 7, { stroke: "#8e9aa3", "stroke-width": 1.2 });
  pathd("M" + r1(x + w / 2 - 16) + " " + r1(y + h / 2 + 3) + " l7 -11 l7 11 z", { fill: "#7a5a2a" });
  pathd("M" + r1(x + w / 2 + 2) + " " + r1(y + h / 2 - 8) + " l7 11 l7 -11 z", { fill: "#7a5a2a" });
}
/* A planter with a flower in it, as the sketch draws the courtyard. */
function flowerBed(cx, cy, r) {
  circle(cx + 2, cy + 3, r, { fill: "rgba(0,0,0,.10)" });
  circle(cx, cy, r, { fill: "#cbbfa4", stroke: "#8e7b5c", "stroke-width": 2.5 });
  circle(cx, cy, r - 10, { fill: "#b9d29a" });
  const pr = r * 0.42;
  [0, 1, 2, 3, 4].forEach(k => {
    const a = k * Math.PI * 2 / 5 - Math.PI / 2;
    circle(cx + Math.cos(a) * pr * 0.75, cy + Math.sin(a) * pr * 0.75, pr * 0.62, { fill: "#e08a9c", stroke: "#c26b7e", "stroke-width": 1 });
  });
  circle(cx, cy, pr * 0.45, { fill: "#f0d06a", stroke: "#c9a33f", "stroke-width": 1 });
}
function planter(cx, cy, rx, ry) {
  svg.push('<ellipse cx="' + r1(cx) + '" cy="' + r1(cy) + '" rx="' + rx + '" ry="' + ry + '" fill="#cbbfa4" stroke="#8e7b5c" stroke-width="2"/>');
  svg.push('<ellipse cx="' + r1(cx) + '" cy="' + r1(cy) + '" rx="' + (rx - 7) + '" ry="' + (ry - 7) + '" fill="' + C.tree + '"/>');
}

/* ---- grounds ---- */
rect(0, 0, GW, GH, { fill: "url(#lawn)" });
rect(0, GF.roadY, GW, GH - GF.roadY, { fill: "url(#road)" });
rect(560, B.y + B.h, 1800, 170, { fill: "url(#paving)" });                                            // the forecourt
rect(GF.gateX - 40, B.y + B.h + 170, 80, GF.roadY - B.y - B.h - 130, { fill: C.walk });                // path to the gate
rect(GF.fieldX - 18, GF.field.y + GF.field.h, 36, B.y - GF.field.y - GF.field.h, { fill: C.walk });    // path to the field

/* ---- football field: a running track around a marked pitch ---- */
(function () {
  const f = GF.field, r = f.w / 2;
  rect(f.x, f.y, f.w, f.h, { rx: r, fill: "#c98a62", stroke: "#8f5a3a", "stroke-width": 2 });
  [12, 24].forEach(k => rect(f.x + k, f.y + k, f.w - 2 * k, f.h - 2 * k, { rx: Math.max(2, r - k), fill: "none", stroke: "#f1e3d6", "stroke-width": 1 }));
  const p = { x: f.x + 50, y: f.y + 46, w: f.w - 100, h: f.h - 92 };
  rect(p.x, p.y, p.w, p.h, { fill: "url(#pitch)", stroke: "#ffffff", "stroke-width": 2.5 });
  line(p.x + p.w / 2, p.y, p.x + p.w / 2, p.y + p.h, { stroke: "#fff", "stroke-width": 2 });
  circle(p.x + p.w / 2, p.y + p.h / 2, 34, { fill: "none", stroke: "#fff", "stroke-width": 2 });
  circle(p.x + p.w / 2, p.y + p.h / 2, 3, { fill: "#fff" });
  [p.x, p.x + p.w - 62].forEach(x => rect(x, p.y + p.h / 2 - 62, 62, 124, { fill: "none", stroke: "#fff", "stroke-width": 2 }));
  [p.x, p.x + p.w - 24].forEach(x => rect(x, p.y + p.h / 2 - 30, 24, 60, { fill: "none", stroke: "#fff", "stroke-width": 2 }));
  [p.x - 10, p.x + p.w].forEach(x => rect(x, p.y + p.h / 2 - 22, 10, 44, { fill: "#fff", stroke: "#888", "stroke-width": 1 }));
  rect(GF.fieldX - 18, f.y + f.h - 6, 36, 12, { fill: "#c98a62" });
})();

/* ---- the Atelier wedge ---- */
poly([AT.nw, AT.n, AT.se, [AT.se[0], AT.sw[1]], AT.sw], { fill: "url(#tiles)", stroke: C.wall, "stroke-width": 3 });
poly(AT.court, { fill: "url(#lawn)", stroke: "#cfc7b6", "stroke-width": 2 });
flowerBed(1580, 415, 58);
planter(1478, 340, 32, 24);
planter(1566, 512, 30, 22);
[[1490, 530], [1672, 540], [1812, 548]].forEach(p => tree(p[0], p[1], 20));

AT.west.forEach(function (r) {
  rect(AT.wx, r.y, AT.ww, AT.wh, { fill: C.floor, stroke: C.wall, "stroke-width": 2.5 });
  classroom(AT.wx, r.y, AT.ww, AT.wh, "s");
  door(AT.wx, r.y, AT.ww, AT.wh, "e", 0.5);
  label(AT.wx + AT.ww / 2, r.y + AT.wh - 16, r.name.replace("Atelier ", ""), { size: 11, weight: 700 });
});
svg.push('<g transform="translate(' + AT.n[0] + ' ' + AT.n[1] + ') rotate(' + r1(AT.ang * 180 / Math.PI) + ')">');
AT.rooms.forEach(function (r) {
  const x = r.t[0], w = r.t[1] - r.t[0];
  rect(x, 0, w, AT.depth, { fill: C.floor, stroke: C.wall, "stroke-width": 2.5 });
  if (r.cat === "wash") washroom(x, 0, w, AT.depth, false);
  else classroom(x, 0, w, AT.depth, "s");
  door(x, 0, w, AT.depth, "s", 0.5);
  label(x + w / 2, AT.depth - 18, r.short || r.name.replace("Atelier ", ""), { size: r.cat === "wash" ? 10 : 11, weight: 700 });
});
svg.push('</g>');

/* ---- the main block ---- */
rect(B.x, B.y, B.w, B.h, { fill: "url(#tiles)", stroke: C.wall, "stroke-width": 3 });
[[B.x, COR.top, GF.cs.x, COR.top], [GF.cs.x + GF.cs.w, COR.top, GF.lift.x, COR.top], [GF.lift.x + GF.lift.w, COR.top, B.x + B.w, COR.top],
 [B.x, COR.bot, GF.inf.x, COR.bot], [GF.inf.x + GF.inf.w, COR.bot, GF.recep.x, COR.bot],
 [GF.recep.x + GF.recep.w, COR.bot, GF.ffs.x, COR.bot], [GF.ffs.x + GF.ffs.w, COR.bot, B.x + B.w, COR.bot]]
  .forEach(l => line(l[0], l[1], l[2], l[3], { stroke: C.wall, "stroke-width": 2 }));

/* Infirmary: two beds with pillows, a medicine cabinet, a cross on the door */
(function () {
  const f = GF.inf;
  rect(f.x, f.y, f.w, f.h, { fill: C.floor, stroke: C.wall, "stroke-width": 2.5 });
  [24, 168].forEach(x => {
    rect(f.x + x, f.y + 40, 110, 56, { rx: 6, fill: "#eef2f5", stroke: "#8e9aa3", "stroke-width": 1 });
    rect(f.x + x + 6, f.y + 46, 22, 44, { rx: 6, fill: "#fff", stroke: "#b8c2ca", "stroke-width": 1 });
  });
  rect(f.x + 140, f.y + 42, 22, 54, { fill: "#cfd7dc", stroke: "#8e9aa3", "stroke-width": 1 });
  rect(f.x + 10, f.y + 10, 16, 16, { fill: "#fff", stroke: "#c0392b", "stroke-width": 1 });
  rect(f.x + 16, f.y + 13, 4, 10, { fill: "#c0392b" }); rect(f.x + 13, f.y + 16, 10, 4, { fill: "#c0392b" });
  door(f.x, f.y, f.w, f.h, "n", 0.45);
})();

/* Reception: a counter facing the corridor, waiting chairs, plants */
(function () {
  const r = GF.recep;
  rect(r.x, r.y, r.w, r.h, { fill: C.floor, stroke: C.wall, "stroke-width": 2.5 });
  rect(r.x + 60, r.y + 22, 150, 26, { rx: 6, fill: "#cfd7dc", stroke: "#8e9aa3", "stroke-width": 1 });
  circle(r.x + 135, r.y + 62, 7, { fill: C.chair });
  [40, 78, 116, 154].forEach(x => circle(r.x + x, r.y + 92, 7, { fill: C.chair }));
  plant(r.x + 18, r.y + 22); plant(r.x + r.w - 18, r.y + 22);
  door(r.x, r.y, r.w, r.h, "n", 0.78);
})();

/* the two staircases and the lift */
rect(GF.ffs.x, GF.ffs.y, GF.ffs.w, GF.ffs.h, { fill: C.floor, stroke: C.wall, "stroke-width": 2.5 });
stairs(GF.ffs.x, GF.ffs.y, GF.ffs.w, GF.ffs.h, "hl");
rect(GF.cs.x, GF.cs.y, GF.cs.w, GF.cs.h, { fill: C.floor, stroke: C.wall, "stroke-width": 2.5 });
stairs(GF.cs.x, GF.cs.y, GF.cs.w, GF.cs.h, "h");
rect(GF.lift.x, GF.lift.y, GF.lift.w, GF.lift.h, { fill: C.floor, stroke: C.wall, "stroke-width": 2.5 });
liftCar(GF.lift.x, GF.lift.y, GF.lift.w, GF.lift.h);

/* doors out of the block: north to the field and into the Atelier, south to the forecourt */
[[GF.fieldX, "n"], [GF.eypX, "n"], [GF.doorX, "s"], [820, "s"]].forEach(function (d) {
  door(B.x, B.y, B.w, B.h, d[1], (d[0] - B.x) / B.w);
});

/* ---- the gate: posts, a swing gate, a guard box ---- */
(function () {
  const g = GF.gate, y = g.y + g.h;
  rect(g.x, y - 46, 54, 46, { fill: C.floor, stroke: C.wall, "stroke-width": 2 });
  circle(g.x + 62, y, 6, { fill: C.wall }); circle(g.x + g.w - 62, y, 6, { fill: C.wall });
  line(g.x + 62, y, g.x + g.w / 2 - 6, y, { stroke: C.wall, "stroke-width": 3 });
  line(g.x + g.w - 62, y, g.x + g.w / 2 + 6, y, { stroke: C.wall, "stroke-width": 3 });
  pathd("M" + r1(g.x + 62) + " " + r1(y) + " a" + r1(g.w / 2 - 68) + " " + r1(g.w / 2 - 68) + " 0 0 1 " + r1(g.w / 2 - 68) + " -" + r1(g.w / 2 - 68), { fill: "none", stroke: C.wall, "stroke-width": 1 });
  line(g.x - 60, y, g.x + 62, y, { stroke: C.wall, "stroke-width": 4 });
  line(g.x + g.w - 62, y, g.x + g.w + 60, y, { stroke: C.wall, "stroke-width": 4 });
})();

/* ---- planting and seating outside ---- */
[[760, 1075], [890, 1075], [1020, 1075]].forEach(p => {
  circle(p[0] + 2, p[1] + 2, 30, { fill: "rgba(0,0,0,.12)" });
  circle(p[0], p[1], 30, { fill: "#cbbfa4", stroke: "#8e7b5c", "stroke-width": 2 });
  circle(p[0], p[1], 20, { fill: C.tree });
  circle(p[0] - 6, p[1] - 6, 10, { fill: C.treeDark, opacity: 0.5 });
});
bench(620, 1010, 46); bench(1420, 1010, 46); bench(1900, 1100, 46);
[[120, 300], [120, 760], [860, 200], [960, 430], [1040, 130], [1090, 560], [2340, 760], [2420, 1000],
 [300, 1160], [420, 1300], [700, 1260], [980, 1240], [1300, 1260], [1700, 1230], [2420, 1280], [130, 1080]]
  .forEach(p => tree(p[0], p[1], 14));

/* ---- labels ---- */
label(GF.field.x + GF.field.w / 2, GF.field.y + GF.field.h / 2, "Football Field", { size: 16, weight: 700, halo: "#88b972" });
label(1330, 175, "EYP Atelier", { size: 17, weight: 700, halo: C.corridor });
label(1660, 610, "Courtyard", { size: 11, halo: C.grass });
label(GF.inf.x + GF.inf.w / 2, GF.inf.y + GF.inf.h - 18, "Infirmary", { size: 13, weight: 700 });
label(GF.recep.x + GF.recep.w / 2, GF.recep.y + GF.recep.h - 16, "Reception", { size: 13, weight: 700 });
label(GF.ffs.x + GF.ffs.w / 2, GF.ffs.y + GF.ffs.h - 14, "First Floor Stairs", { size: 11, weight: 700 });
label(GF.cs.x + GF.cs.w / 2, GF.cs.y + 16, "Cafeteria Stairs", { size: 11, weight: 700 });
label(GF.lift.x + GF.lift.w / 2, GF.lift.y - 14, "Lift", { size: 12, weight: 700, halo: C.corridor });
label(GF.gate.x + GF.gate.w / 2, GF.gate.y + GF.gate.h + 34, "Main Gate", { size: 14, weight: 700, halo: C.walk });
label(1000, 825, "Corridor", { size: 11, halo: C.corridor });
svg.push('<text x="16" y="26" font-size="16" font-weight="700" fill="' + C.text + '">School - Ground Floor</text>');
line(16, 44, 116, 44, { stroke: C.text, "stroke-width": 2 }); line(16, 40, 16, 48, { stroke: C.text, "stroke-width": 2 }); line(116, 40, 116, 48, { stroke: C.text, "stroke-width": 2 });
svg.push('<text x="66" y="58" font-size="10" text-anchor="middle" fill="' + C.text + '">10 m</text>');
svg.push('</svg>');
fs.writeFileSync(path.join(ROOT, "plans", "school-ground.svg"), svg.join("\n") + "\n");

const banner = "/* GENERATED by tools/build-school-map.js from the hand sketch. Do not hand-edit - re-run the builder. */\n";
fs.writeFileSync(path.join(ROOT, "map.js"), banner + "const MAP = " + JSON.stringify(MAP, null, 2) + ";\n");
fs.writeFileSync(path.join(ROOT, "maps", "school-ground.json"), JSON.stringify({ map: MAP, scanPoints: SCANPOINTS }, null, 2) + "\n");

const q = v => JSON.stringify(String(v == null ? "" : v));
const entries = SCANPOINTS.map(p => "    { id: " + q(p.id) + ", node: " + q(p.node) + ", level: " + q(p.level) +
  ", audience: " + q(p.audience) + ",\n      label: " + q(p.label) + ",\n      mount: " + q(p.mount) + ", rev: " + p.rev + " }").join(",\n\n");
fs.writeFileSync(path.join(ROOT, "scanpoints.js"), banner + [
  "var SCANPOINTS = (function () {", "  var LIST = [", entries, "  ];", "", "  var RETIRED = [];", "",
  "  var BY_ID = {};", "  LIST.forEach(function (s) { BY_ID[s.id.toUpperCase()] = s; });", "",
  "  return {", "    all: LIST,", "    retired: RETIRED,",
  "    byId: function (id) { return BY_ID[String(id || '').toUpperCase()] || null; },",
  "    byNode: function (n) {", "      for (var i = 0; i < LIST.length; i++) if (LIST[i].node === n) return LIST[i];",
  "      return null;", "    },",
  "    url: function (base, id) { return base.replace(/[/]+$/, '') + '/?s=' + id; }", "  };", "})();", "",
  "if (typeof module !== 'undefined' && module.exports) module.exports = SCANPOINTS;", ""].join("\n"));

/* validate with the app's own engine */
const { createEngine } = require(path.join(ROOT, "engine.js"));
const issues = createEngine(MAP).validate();
issues.forEach(i => console.log(" " + i.sev.padEnd(4) + " " + i.msg));
const ids = new Set();
SCANPOINTS.forEach(p => {
  if (ids.has(p.id)) { console.error("duplicate placard id " + p.id); process.exit(1); }
  ids.add(p.id);
  if (!BY[p.node]) { console.error("placard " + p.id + " points at missing node " + p.node); process.exit(1); }
});
MAP.levels.forEach(l => console.log(l.name + ": " + NODES.filter(n => n.level === l.id && n.dest).length + " destinations, " + SCANPOINTS.filter(p => p.level === l.id).length + " placards"));
console.log("nodes " + NODES.length + ", edges " + EDGES.length + ", destinations " + NODES.filter(n => n.dest).length + ", placards " + SCANPOINTS.length);
if (issues.some(i => i.sev === "err")) process.exit(1);

/* A new map means a new saved-copy name, or phones keep showing the old one. */
require("child_process").execFileSync(process.execPath, [path.join(__dirname, "stamp-sw.js")], { stdio: "inherit" });
