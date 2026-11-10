// Checks the AeroVision reader, auto-trim and stats. Usage: node scripts/test-gps.ts [file.kml]
import { readFileSync } from 'node:fs';
import { autoTrim, flightStats, parseKml, trimTrack, type TrackPoint } from '../src/gps.ts';

let fails = 0;
const check = (name: string, ok: boolean, extra: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, ok ? '' : JSON.stringify(extra));
  if (!ok) fails++;
};

// A made-up flight: 60 s sitting still, 120 s flying at 20 mph, 90 s still again
const pm = (t: number, lat: number, lon: number, spd: number) =>
  `<Placemark><name>00:${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</name><description>Longitude: ${lon} &lt;br&gt;Latitude: ${lat} &lt;br&gt;Altitude: 900 ft &lt;br&gt;Speed: ${spd} mph &lt;br&gt;Distance(meters): ${Math.round(spd * 5)} &lt;br&gt;</description></Placemark>`;
let body = '';
let lat = 53.81;
for (let t = 0; t < 270; t++) {
  const flying = t >= 60 && t < 180;
  if (flying) lat += 0.00008; // ~9 m/s
  body += pm(t, lat, -1.97, flying ? 20 : 0);
}
const kml = `<kml><Document><name>Flight 17 Oct, 16:31_GPS</name><Folder><name>Transmitter</name>${body}</Folder><Folder><name>My track</name></Folder></Document></kml>`;
const f = parseKml(kml);
check('one point per second', f.bird.length === 270, f.bird.length);
check('start clock from name', f.startClock === '16:31', f.startClock);
const trim = autoTrim(f.bird);
check('trims still start', trim.start >= 50 && trim.start <= 60, trim);
check('trims still end', trim.end >= 175 && trim.end <= 190, trim);
const st = flightStats(trimTrack(f.bird, trim.start, trim.end) as TrackPoint[]);
check('duration about 2 min', st.duration_s >= 115 && st.duration_s <= 140, st);
check('top speed 20', st.max_speed_mph === 20, st);
check('distance about 1 km', st.distance_m > 950 && st.distance_m < 1150, st);

// A stoop: 10 fixes a second, one of them at 82 mph, not the last in its second
let fast = '';
for (let t = 0; t < 40; t++) for (let k = 0; k < 10; k++) {
  const spd = t === 20 && k === 4 ? 82 : t >= 10 && t < 30 ? 30 : 0;
  fast += pm(t, 53.81 + t * 0.0001, -1.97, spd);
}
const stoop = parseKml(`<kml><Document><name>Flight</name><description> Max Speed: 82 mph </description><Folder><name>Transmitter</name>${fast}</Folder></Document></kml>`);
check('keeps the fastest fix in each second', stoop.bird.find((p) => p[0] === 20)?.[3] === 82, stoop.bird.find((p) => p[0] === 20));
check('reads Marshall max speed', stoop.fileMaxSpeed === 82, stoop.fileMaxSpeed);
const st2 = flightStats(stoop.bird);
check('stats top speed 82', st2.max_speed_mph === 82, st2);
const quick = parseKml(kml.replace('900 ft &lt;br&gt;Speed: 20', '900 ft &lt;br&gt;Speed: 120'));
check('fast stoop over 90 mph kept', quick.bird.some((p) => p[3] === 120));

const file = process.argv[2];
if (file) {
  const real = parseKml(readFileSync(file, 'utf8'));
  const t = autoTrim(real.bird);
  const s = flightStats(trimTrack(real.bird, t.start, t.end) as TrackPoint[]);
  console.log('real file: Marshall max', real.fileMaxSpeed, 'ours (whole file)', flightStats(real.bird).max_speed_mph, '|', real.bird.length, 'secs, me', real.me.length, 'trim', t, s, 'json KB', Math.round(JSON.stringify(trimTrack(real.bird, t.start, t.end)).length / 1024));
}
console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
