import type { TourDemo } from '../app';
import type { TouchAction } from '../input/touch';

/**
 * One cockpit-tour bubble. `{action}` in text becomes a keycap from the live key map
 * (`{stick}` and `{throttle}` are the arrow and W/S pairs); `[[Label]]` becomes a touch-button chip.
 */
export interface TourStep {
  id: string;
  /** CSS selector of the instrument to spotlight (several matches are framed together); null centers the bubble. */
  target: string | null;
  title: string;
  text: string[];
  /** Weapons and tricks: the situation to use it in. */
  when?: string;
  demo?: TourDemo;
  /** Touch: the spotlit control stays live and the bubble ticks when the player uses it. */
  try?: { action: TouchAction; text: string };
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome', target: null, title: 'Cockpit tour',
    text: [
      'The game is frozen. We will walk through every instrument, weapon and key.',
      'Press {next} or Enter for the next bubble, ← to go back, Esc to leave.',
    ],
  },
  {
    id: 'sight', target: '[data-testid="aim-area"]', title: 'Gun sight',
    text: [
      'The white W is your nose: bullets go where it points.',
      'The circle around it is the missile lock ring. It turns amber while locking, green when locked.',
      'Red brackets are enemy aircraft; red domes are ground sites. A small cyan circle shows where to aim the cannon.',
    ],
  },
  {
    id: 'steer', target: '[data-testid="aim-area"]', title: 'Flying',
    text: [
      '{left} {right} turn. The jet banks into turns by itself.',
      '{up} lifts the nose to climb, {down} dips it to dive.',
    ],
    when: 'Fly low and behind hills to stay off enemy radar; climb when the altimeter goes amber.',
  },
  {
    id: 'objective', target: '[data-zone="objective"]', title: 'Objective',
    text: [
      'The chip shows the mission phase: INGRESS, FIGHT, STRIKE, then EGRESS.',
      'The arrow points where to go next and the number is how far. Magenta means the target, green means the exit.',
    ],
  },
  {
    id: 'mission-bar', target: '[data-zone="mission-bar"]', title: 'Time, score, stars',
    text: [
      'Mission clock, live score, and stars earned so far.',
      'One star for destroying the target, one for staying under 35% damage, one for finishing under 6 minutes.',
    ],
  },
  {
    id: 'speed', target: '[data-zone="speed"]', title: 'Speed and throttle',
    text: [
      'Speed in knots. {throttleUp} and {throttleDown} pick a throttle notch: S slow, C cruise, F fast.',
      'Hold {boost} to boost. The small bar is boost energy; it drains in about 6 s and refills on its own.',
    ],
    when: 'Slow down to turn tighter in a dogfight. Boost to escape or to close distance, but it burns fuel fast.',
  },
  {
    id: 'fuel', target: '[data-zone="fuel"]', title: 'Fuel',
    text: [
      'Fuel left. The white home line is what you need to reach the exit from here.',
      'Amber means you are close to the line; red means you may not make it home.',
    ],
    when: 'If the bar nears the line, stop boosting and head for the exit.',
  },
  {
    id: 'altitude', target: '[data-zone="altitude"]', title: 'Altitude',
    text: [
      'Height above the ground in meters.',
      'It turns amber below 300 m and red below 150 m. Hitting the ground ends the mission.',
    ],
  },
  {
    id: 'damage', target: '[data-zone="damage"]', title: 'Damage',
    text: [
      'A picture of your jet. Nose, body, wings and tail turn amber, then red, as they take hits.',
      'At 100% you are shot down.',
    ],
  },
  {
    id: 'weather', target: '[data-zone="weather"]', title: 'Weather',
    text: [
      'The arrow shows which way the wind blows relative to your nose, and its strength.',
      'It also shows the distance to the nearest storm.',
    ],
    when: 'Storms hide you from enemy radar, but they shake the jet and lightning can hit you.',
  },
  {
    id: 'radar', target: '[data-zone="radar"]', title: 'Radar',
    text: [
      'A top-down map with you in the middle, nose up.',
      'Red marks are enemies, domes are missile sites, the magenta circle is the strike zone and the green circle is the exit.',
      'The button in the corner changes the range.',
    ],
    when: 'Check it before you fly into a dome: that is where missiles come from.',
  },
  {
    id: 'threat-ring', target: '[data-zone="threat-ring"]', title: 'Threat ring', demo: 'threat',
    text: [
      'Wedges around the sight point at whatever is after you.',
      'Amber: a radar is tracking you or a fighter is attacking. Red with a number: a missile is coming, seconds to impact.',
    ],
    when: 'Red wedge? Fire flares and turn hard, now. One is shown here as an example.',
  },
  {
    id: 'weapons', target: '[data-zone="weapons"]', title: 'Weapons panel',
    text: [
      'Four cards: what you can fire, how many are left, and the key for each.',
      'SEEK and LOCK show missile lock. A greyed card cannot be used right now.',
    ],
  },
  {
    id: 'cannon', target: '[data-help="weapon-cannon"]', title: 'Cannon',
    text: [
      'Hold {cannon} to fire. 600 rounds, about 30 seconds of shooting.',
      'Hits anything: drones, fighters, gun sites and missile sites. Best inside 2.5 km; put the W on the cyan lead circle.',
    ],
    when: 'Drones, close fighters and ground guns. It saves your missiles.',
  },
  {
    id: 'missile', target: '[data-help="weapon-missile"]', title: 'Heat-seeking missile',
    text: [
      'For aircraft only, within 6 km. Keep the enemy inside the lock ring about a second until it turns green and reads LOCK, then press {missile}.',
      'You carry 6. {nextTarget} switches to the next enemy aircraft.',
    ],
    when: 'Fighters you cannot keep in the gun sight, or that are too far for the cannon.',
  },
  {
    id: 'strike', target: '[data-help="weapon-strike"]', title: 'Strike missile',
    text: [
      'Only for the mission target, and only inside the magenta strike zone. The card stays grey until then.',
      'Point roughly at the target and press {strike} to start the lock. When the box turns green, press {strike} again to launch.',
    ],
    when: 'Once per run, in the STRIKE phase. You have 2, so a miss is not the end.',
  },
  {
    id: 'flare', target: '[data-zone="flares"]', title: 'Flares',
    text: [
      'Press {flare} to drop a pair of flares that pull missiles away. Each pip is one of 16 presses.',
      'They work best when the missile is close and you are turning hard.',
    ],
    when: 'Only when the threat ring shows a red wedge. Firing early wastes them.',
  },
  {
    id: 'console', target: '[data-zone="console"]', title: 'Crew console',
    text: [
      'Your AI crew speaks here in one short line. The icon says who, the color says how urgent: white is info, green is good, amber is caution, red is danger.',
      'The gauge a line is about glows at the same time.',
    ],
  },
  {
    id: 'crew', target: '[data-testid="crew-strip"]', title: 'Your crew',
    text: [
      'Six agents, each watching its own gauges: Radar, Weapons, Flight, Mission, Weather and Wingman.',
      'Press {explain} in flight to draw lines from each one to what it watches.',
    ],
  },
  {
    id: 'talk', target: '[data-zone="console"]', title: 'Talk to the crew',
    text: [
      'Hold {pushToTalk} and speak, or press {type} and type. Ask "fuel?" or "should I escape?".',
      'When they suggest an action, press {accept} to accept it. {voice} switches spoken alerts off, critical only, or all.',
    ],
  },
  {
    id: 'autopilot', target: '[data-zone="objective"]', title: 'Autopilot',
    text: [
      'Press {autopilot} and the jet flies toward the objective. Any arrow key takes control back.',
      'Cadet: any time. Pilot: only out of combat. Ace: none.',
    ],
    when: 'Long flights between fights, or while you check the radar.',
  },
  {
    id: 'keys', target: null, title: 'All keys',
    text: ['Esc or P pauses. Every key can be changed in Settings.'],
  },
  {
    id: 'done', target: null, title: 'Ready to fly',
    text: [
      'The training flight walks you through it for real: rings, the cannon, flares, then a strike.',
      'You can replay this tour from the main menu any time.',
    ],
  },
];

/** Keys shown on the summary bubble, in reading order. */
export const TOUR_KEY_ROWS: [string, string][] = [
  ['stick', 'Steer and climb'], ['throttle', 'Throttle'], ['boost', 'Boost (hold)'], ['cannon', 'Cannon (hold)'],
  ['missile', 'Heat-seeker'], ['nextTarget', 'Next target'], ['strike', 'Strike (lock, fire)'], ['flare', 'Flares'],
  ['autopilot', 'Autopilot'], ['pushToTalk', 'Talk (hold)'], ['type', 'Type to crew'], ['accept', 'Accept suggestion'],
  ['explain', 'Explain gauges'], ['voice', 'Voice mode'], ['pause', 'Pause'],
];

/** The same tour on a touch screen: buttons instead of keys, and a "try it" on every control. */
export const TOUCH_TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome', target: null, title: 'Cockpit tour',
    text: [
      'The game is frozen. We will walk through every instrument and button, and you can try each control.',
      'Hold the phone sideways with both thumbs: the left thumb flies, the right thumb fights. Tap Next or swipe.',
    ],
  },
  {
    id: 'stick', target: '[data-testid="touch-stick"]', title: 'Left thumb: fly', demo: 'stick',
    text: [
      'Put your thumb down anywhere on the left half and slide. The stick appears where you touch.',
      'Up climbs, down dives, left and right turn. Let go and the jet flies straight.',
    ],
    when: 'Small slides aim gently; push to the edge for a hard turn.',
    try: { action: 'stick', text: 'Try it: slide the stick.' },
  },
  {
    id: 'sight', target: '[data-testid="aim-area"]', title: 'Gun sight',
    text: [
      'The white W is your nose: bullets go where it points. The circle is the missile lock ring: amber while locking, green when locked.',
      'Red brackets are enemy aircraft; red domes are ground sites.',
    ],
  },
  {
    id: 'speed', target: '[data-zone="speed"]', title: 'Speed',
    text: ['Speed in knots, left of the sight. The cyan bar under it is boost energy.'],
  },
  {
    id: 'throttle', target: '[data-testid="touch-throttle"]', title: 'Throttle',
    text: ['Tap [[F]] fast, [[C]] cruise or [[S]] slow, or slide along it. The lit notch is your setting.'],
    when: 'Slow down to turn tighter in a dogfight.',
    try: { action: 'throttle', text: 'Try it: tap S, then C.' },
  },
  {
    id: 'altitude', target: '[data-zone="altitude"]', title: 'Altitude',
    text: ['Height above the ground in meters, right of the sight. Amber below 300 m, red below 150 m. Hitting the ground ends the mission.'],
  },
  {
    id: 'objective', target: '[data-zone="objective"]', title: 'Objective',
    text: [
      'The chip shows the phase: INGRESS, FIGHT, STRIKE, then EGRESS.',
      'The arrow points where to go and the number is how far. Magenta is the target, green the exit.',
    ],
  },
  {
    id: 'fuel', target: '[data-zone="fuel"]', title: 'Fuel',
    text: ['Fuel left. The white home line is what you need to reach the exit. Amber: close to the line. Red: you may not make it home.'],
    when: 'Near the line? Stop boosting and head for the exit.',
  },
  {
    id: 'mission-bar', target: '[data-zone="mission-bar"]', title: 'Time, score, stars',
    text: ['Mission clock, live score and stars. One star each for destroying the target, staying under 35% damage and finishing under 6 minutes.'],
  },
  {
    id: 'damage', target: '[data-zone="damage"]', title: 'Damage',
    text: ['Your jet from above. Nose, body, wings and tail turn amber, then red, as they take hits. At 100% you are shot down.'],
  },
  {
    id: 'weather', target: '[data-zone="weather"]', title: 'Weather',
    text: ['Which way the wind blows against your nose, how strong, and how far the nearest storm is.'],
    when: 'Storms hide you from radar, but they shake the jet and lightning can hit you.',
  },
  {
    id: 'radar', target: '[data-zone="radar"]', title: 'Radar',
    text: [
      'Top-down map, you in the middle, nose up. Red marks are enemies, domes are missile sites, magenta is the strike zone, green the exit.',
      'Tap a red mark to target it. Tap [[20 km]] to change the range.',
    ],
  },
  {
    id: 'threat-ring', target: '[data-zone="threat-ring"]', title: 'Threat ring', demo: 'threat',
    text: ['Wedges around the sight point at whatever is after you. Amber: a radar tracks you or a fighter attacks. Red with seconds: a missile is coming.'],
    when: 'Red wedge? Tap Flare and turn hard, now. One is shown here.',
  },
  {
    id: 'fire-cluster', target: '[data-testid="touch-fire"]', title: 'Right thumb: fight',
    text: [
      'Rest your right thumb on [[Fire]]. The other weapons sit on an arc around it, so you can roll your thumb to them without looking.',
      'A touch goes to the nearest button, and you can slide between them without lifting. Badges count what is left.',
    ],
  },
  {
    id: 'cannon', target: '[data-testid="touch-cannon"]', title: 'Fire: cannon',
    text: ['Hold to shoot: 600 rounds, about 30 seconds. Hits drones, fighters and ground sites. Best inside 2.5 km; put the W on the cyan lead circle.'],
    when: 'Drones, close fighters and ground guns. It saves your missiles.',
    try: { action: 'cannon', text: 'Try it: hold Fire.' },
  },
  {
    id: 'missile', target: '[data-testid="touch-missile"]', title: 'Heat-seeking missile',
    text: ['For aircraft within 6 km. Keep the enemy in the lock ring until the button rim turns green, then tap. You carry 6.'],
    when: 'Fighters you cannot keep in the gun sight.',
    try: { action: 'missile', text: 'Try it: tap Missile.' },
  },
  {
    id: 'strike', target: '[data-testid="touch-strike"]', title: 'Strike missile',
    text: ['Only for the mission target, inside the magenta strike zone; the button stays grey until then. Tap to lock; when the rim turns green, tap again to launch.'],
    when: 'Once per run, in the STRIKE phase. You have 2.',
  },
  {
    id: 'flare', target: '[data-testid="touch-flare"]', title: 'Flares',
    text: ['Drops a pair of flares that pull missiles away. The badge counts the 16 presses you have.'],
    when: 'Only when the threat ring shows a red wedge. Early flares are wasted.',
    try: { action: 'flare', text: 'Try it: tap Flare.' },
  },
  {
    id: 'boost', target: '[data-testid="touch-boost"]', title: 'Boost',
    text: ['Hold for extra speed. The energy bar under your speed drains in about 6 s and refills on its own.'],
    when: 'To escape a fight or close distance. It burns fuel fast.',
    try: { action: 'boost', text: 'Try it: hold Boost.' },
  },
  {
    id: 'autopilot', target: '[data-testid="touch-autopilot"]', title: 'Autopilot',
    text: [
      'Tap [[AP]] and the jet flies toward the objective, freeing your left thumb. Touch the stick to take back control.',
      'Cadet: any time. Pilot: out of combat. Ace: none.',
    ],
    when: 'Long flights between fights, or while you check the radar.',
    try: { action: 'autopilot', text: 'Try it: tap AP.' },
  },
  {
    id: 'console', target: '[data-zone="console"]', title: 'Crew console',
    text: ['Your AI crew speaks here in one short line. The icon says who; the color says how urgent: white info, green good, amber caution, red danger.'],
  },
  {
    id: 'talk', target: '[data-testid="touch-mic"], [data-testid="touch-keyboard"]', title: 'Talk to the crew',
    text: [
      'Hold the mic and speak, or tap the keyboard and type. Ask "fuel?" or "should I escape?".',
      'When the crew suggests an action, tap its button to accept.',
    ],
    when: 'Lift your left thumb to talk; the jet keeps flying straight.',
  },
  {
    id: 'system', target: '[data-testid="explain-btn"], [data-testid="log-btn"], [data-testid="help-btn"], [data-testid="pause-btn"], [data-testid="voice-toggle"]', title: 'Top buttons',
    text: ['[[i]] links each crew member to the gauges it watches. [[≡]] lists recent messages. [[?]] reopens the briefing, [[❚❚]] pauses, and the speaker switches spoken alerts: off, critical, all.'],
  },
  {
    id: 'done', target: null, title: 'Ready to fly',
    text: [
      'The training flight walks you through it for real: rings, the cannon, flares, then a strike.',
      'You can replay this tour from the main menu any time.',
    ],
  },
];
