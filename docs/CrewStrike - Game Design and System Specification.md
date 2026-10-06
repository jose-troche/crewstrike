# CrewStrike — Game Design and System Specification

Oct 6, 2026 · @Jose

## 1. Vision and the pivot

CrewStrike is a fast, easy-to-fly arcade fighter game: fly a short mission, survive fighters and air defenses, destroy the target, and let a crew of six AI agents watch your gauges and tell you, in one short line, what matters right now.

**Why we pivoted.** The first prototype's visuals worked and are kept. Everything else changes, because playtesters hit four walls:

| What players said | What changes |
| --- | --- |
| They couldn't connect the agents to the parts of the jet they run | Each agent owns a visible cockpit zone, wears an icon, and lights that zone when it speaks (section 9) |
| The plane was hard to fly, and the goal was unclear | Arcade flight, assist levels from autopilot to full manual, and an objective marker that is always on screen |
| Too many instruments, with no way to know what each is for | Twelve instruments at most, each answering one question, each with a one-line "?" |
| Too much reading | Color, shape and gauges first; text is one short line at a time, and voice is optional |

**Design pillars**

1. **Clear goal at a glance.** You always know where to go and what phase you're in.
2. **Easy to fly, hard to master.** Cadet flies itself if you want; Ace is twitchy and fast.
3. **Every gauge earns its place.** If it doesn't answer a question you have mid-fight, it isn't on screen.
4. **AI that whispers, not shouts.** Short, rare, prioritized messages you can glance at or ignore.
5. **Fast but comfortable.** Speed you can feel without motion sickness.
6. **Anywhere, free.** Desktop to phone in a browser, hosted on Cloudflare's free tier.

**Non-goals for version 1:** real aircraft or weapon data (everything is arcade and generic), multiplayer, a story campaign, VR.

## 2. Handoff summary: what carries over

This section condenses every decision from the first design session that still applies, so a new session can start from these two documents alone.

| Topic | Decision | Status |
| --- | --- | --- |
| Name | **CrewStrike**, repo `crewstrike`. Renamed from WINGMIND, which now names only the earlier simulator design (itself formerly SKYWARDEN); "Skyward" is a separate project | Renamed |
| Working model | Claude writes spec and implementation docs; Jose commits them to the repo; Claude generates code, tests and deploys; Jose plays the deployed game and updates requirements | Kept |
| Platform | Browser game on Cloudflare's free tier: Workers Static Assets, one Worker (Hono), Workers AI, SQLite-backed Durable Objects, D1 | Kept; R2 and replays dropped |
| Compute split | Game loop and every real-time agent run in the browser; the edge only answers language questions, meters the budget and stores scores. A 60 Hz server tick would be 216,000 requests per player-hour against 100,000 free per day | Kept |
| AI rule | Deterministic first, LLM second. Alerts are templates; the LLM never sits in a time-critical path; every number it says is checked against game state | Kept |
| Inference tiers | Local grammar first, then on-device model (Chrome built-in AI), then the Workers AI free pool; OAuth-provider and bring-your-own-key tiers later (same pattern as Floorcraft) | Kept |
| Budget | Workers AI's 10,000 neurons a day is the only binding limit; a Durable Object ledger enforces a 9,000 ceiling; Llama 3.1 8B fast in JSON mode | Kept, and cheaper: only strategic questions use the LLM |
| Agent pattern | Typed bus, single-writer state, one arbiter with a fixed safety order, one voice for the pilot | Kept, simplified from 18 agents to 6 |
| Language | TypeScript everywhere, strict, no plain JavaScript files | Kept |
| Testing | Playwright, local-first on the dev machine; CI is optional, manual and never blocks a deploy; test hooks drive a seeded game; AI calls mocked | Kept, plus device projects for responsive checks |
| Content stance | Generic, arcade, illustrative; no real tactics or weapon data | Kept |

## 3. Core game loop and missions

A mission is 4 to 8 minutes in four phases (ingress, fight through, strike, get out), and the HUD always shows which phase you're in and where to go next.

1. **Ingress.** Fly toward the target area; avoid or fight patrols; pick a route around air defenses.
2. **Fight through.** Enemies react: fighters intercept, SAM sites lock on, drones swarm.
3. **Strike.** Enter the strike zone, lock the target, fire one or both heavy strike missiles.
4. **Egress.** Reach the green exit zone with fuel and airframe intact.

| Mission (v1) | Target | What makes it hard |
| --- | --- | --- |
| Radar Breaker | Radar station on a ridge | Two SAM sites cover the valley; terrain masking helps |
| Iron Tide | Warship at sea | Ship guns and escort fighters; no terrain to hide behind |
| Bridge Fall | Bridge on a supply road | Drone swarms and anti-aircraft guns; a storm rolls in mid-mission |

- **Win:** target destroyed and exit zone reached.
- **Lose:** plane destroyed, or fuel runs out.
- **Abort:** reach the exit before striking for a partial score. The AI crew may recommend it.
- **Score:** target, kills, damage taken, time, missiles left over; shown as 1 to 3 stars, with a three-line recap.

## 4. Flight, controls and difficulty

The jet always flies forward and banks into turns automatically, so steering is a single stick; difficulty decides how much the jet helps you.

### 4.1 Arcade flight model

- Steering points the nose; the jet banks and turns on its own (bank-to-turn).
- **Speed is controlled** with a throttle (slow, cruise, fast) plus **boost**, which burns fuel faster. Turning is tighter at lower speed.
- **Autopilot** ("follow route") flies toward the objective and avoids terrain while you handle weapons; any stick input takes over instantly.

### 4.2 Controls by device

| Action | Keyboard and mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer | Mouse or arrow keys | Left stick | Left virtual stick |
| Throttle | W / S | Right stick up and down | Slider on left edge |
| Boost | Shift (hold) | Left trigger | Boost button |
| Cannon | Space or left click (hold) | Right trigger | Fire button (hold) |
| Heat-seeking missile | F | Right bumper | Missile button |
| Strike missile | G | Y / Triangle | Strike button (appears in strike zone) |
| Flares | E | Left bumper | Flare button |
| Next target | Tab | X / Square | Tap an enemy on radar |
| Autopilot | R | B / Circle | Autopilot toggle |
| Push-to-talk | V (hold) | D-pad down (hold) | Mic button (hold) |
| Type a question | / | None | Keyboard icon |
| Voice on or off | M | Menu | Speaker icon |
| Pause | Esc | Start | Pause icon |

All keys and buttons can be remapped.

### 4.3 Difficulty levers

| Lever | Cadet | Pilot | Ace |
| --- | --- | --- | --- |
| Steering | Fully assisted; auto-levels when you let go | Assisted turns, manual leveling | Manual roll and pitch, higher sensitivity |
| Autopilot | Available any time, flies whole route | Available outside combat | Off |
| Ground protection | Automatic pull-up | Warning plus gentle pull | Warning only |
| Stall | Impossible | Warning, auto-recovers | Can stall at low speed |
| Aim assist | Strong, auto-lock | Light | None |
| Enemy skill | Slow to react, inaccurate | Moderate | Fast, accurate, coordinated |
| Incoming missiles | Slow, long warning | Medium | Fast, short warning |
| Fuel burn | Half | Normal | 1.5 times |
| Damage taken | Half | Normal | 1.5 times |
| AI crew chatter | Tips plus alerts | Key alerts | Critical only |

**Custom** exposes every lever individually, plus a stick-sensitivity slider.

## 5. Comfort: fast without motion sickness

The camera stays calm while the jet does the maneuvering: the horizon barely tilts, nothing shakes, and a fixed cockpit frame gives the eye a stable reference.

- **Comfort camera.** Camera roll is capped at ±15° while the jet icon banks fully; Ace can opt into full roll.
- **Fixed field of view** (75° default, adjustable). No field-of-view zoom on boost; speed shows as faint streaks at the screen edges.
- **No camera shake** by default. Hits show as a colored flash at the screen edge on the side they came from.
- **Stable frame.** The HUD frame and cockpit edges never move, giving the eye a fixed anchor.
- **Smooth frame rate first.** The game lowers resolution before it ever drops frames.
- **Optional comfort vignette** that darkens the edges during hard turns.
- **Reduced motion.** When the system asks for reduced motion, streaks and flashes are softened automatically.
- Pause works at any moment, including mid-dogfight.

## 6. Weapons, enemies and threats

The player carries four tools: a cannon, heat-seekers, flares, and two heavy strike missiles saved for the mission target. Every enemy threat is telegraphed visually before it can hurt you.

### 6.1 Player loadout

| Weapon | Best against | Count | How it works |
| --- | --- | --- | --- |
| Cannon | Drones, close dogfights | 600 rounds | Hold to fire; a lead marker shows where to aim |
| Heat-seeking missiles | Fighters | 6 | Hold the target in the ring until the lock tone, then fire |
| Flares | Incoming missiles | 16 | Fire when warned; best combined with a hard turn |
| Strike missiles | Mission target, big ground or sea targets | 2 | Appear in the strike zone; lock, fire, then turn for home |

### 6.2 Enemies

| Enemy | Behavior | Warning you get |
| --- | --- | --- |
| Fighter | Patrols, chases, fires missiles from behind | Red chevron on radar; "locking" warning |
| Drone swarm | Slow, many, rams or fires short bursts | Cluster icon with a count |
| SAM site | Long-range missile from the ground | Red dome on radar; amber "tracking", then red "launch" |
| Anti-aircraft guns | Flak near defended targets | Orange danger zone on radar |
| Warship | Guns and missiles at sea; can be the target | Dome like a SAM site, plus gun zone |

### 6.3 Threat telegraphing

- **Tracking:** an amber wedge appears on the threat ring around your crosshair, pointing at the threat.
- **Locked:** the wedge pulses amber with a rising tone.
- **Missile launched:** the wedge turns red, an arrow and a countdown bar show the missile's direction and time to impact.

### 6.4 Weather

- **Storms** are purple cells on the radar. Inside: turbulence, radar static and lightning damage. They also hide you from enemy radar.
- **Clouds** block sight lines for you and for enemies.
- **Wind** slightly pushes the jet and shows as an arrow on the weather gauge.

## 7. Cockpit HUD: every instrument has a purpose

Twelve instruments, each answering one question a pilot has mid-fight, each owned by one AI agent, and each explained in one sentence when you press "?".

| Instrument | Question it answers | How it shows | Owner agent |
| --- | --- | --- | --- |
| Objective marker and phase chip | Where do I go, and what now? | Magenta arrow at screen edge with distance; phase chip (Ingress, Fight, Strike, Egress) | Mission |
| Radar | Where are enemies, threats, the target? | Round top-down map; enemy icons, threat domes, storm cells, target, exit zone | Radar |
| Threat ring | What's aiming at me, and from where? | Ring around the crosshair with amber or red wedges | Radar |
| Damage | How hurt am I? | Jet silhouette with sections turning amber or red, plus a percentage | Flight |
| Fuel | Can I make it home? | Bar with a white "home" line showing fuel needed to reach the exit | Flight |
| Speed and throttle | How fast, and is boost ready? | Vertical tape with throttle notch and boost meter | Flight |
| Altitude | Am I too low? | Tape that turns amber, then red, near the ground | Flight |
| Weapons | What can I fire, and how many are left? | Four weapon cards with counts; selected card raised; lock state on the card | Weapons |
| Flares | Can I dodge a missile? | Row of pips | Weapons |
| Weather | Is a storm or wind a problem? | Icon with wind arrow; storm distance when one is near | Weather |
| Message console | What matters right now? | One or two short lines, each tagged with an agent icon | Wingman |
| Mission bar | How am I doing? | Timer, score, stars so far | Mission |

**One rule for every gauge:** green, amber and red mean the same thing everywhere (section 8), so a glance at color tells you whether to look closer.

## 8. Color and shape language

Color tells you how urgent something is; shape and icon tell you what it is, so the HUD still reads for colorblind players.

| Color | Meaning | Examples |
| --- | --- | --- |
| Green | Fine, safe | Fuel above the home line; exit zone |
| Amber | Caution, act soon | Being tracked; fuel near the home line; ammo low |
| Red | Danger, act now | Missile launched; ground collision; heavy damage |
| Cyan | You and friendly | Your jet, your missiles, autopilot route |
| Magenta | Mission target | Objective marker, strike zone |
| Purple | Weather | Storm cells, wind warnings |
| White | Neutral information | Speed, altitude numbers |

- **Shapes:** fighters are chevrons, drones are dots in a cluster, ground defenses are domes, ships are hulls, missiles are arrows.
- **Motion means urgency:** only red things pulse; amber glows steadily; nothing else animates.
- **Colorblind palettes** (deuteranopia, protanopia, tritanopia) swap hues but keep shapes and pulse rules.

## 9. The AI crew

Six agents fly with you, and each one visibly owns a zone of the cockpit: its icon sits on that zone, the zone glows when the agent speaks, and every message carries the same icon, so players connect "who said it" with "which gauge it's about" without being told.

&#91;embedded content: Cockpit zones by owner agent · 6 agents, 12 instruments\]

In the game, zones use the urgency colors from section 8; the agent colors here only show ownership, which the game conveys with icons and the crew strip.

| Agent | Icon | Owns | Watches | Says things like |
| --- | --- | --- | --- | --- |
| Radar | Eye | Radar, threat ring | Enemies, locks, missiles | "Missile, left! Flares." / "Two fighters closing from north." |
| Weapons | Crosshair | Weapon cards, flares | Ammo, locks, targets in range | "Strike missile in range." / "Cannon low: 80 rounds." |
| Flight | Wing | Damage, fuel, speed, altitude | Fuel versus distance home, damage, terrain | "Fuel: 3 minutes to exit." / "Pull up!" |
| Mission | Flag | Objective marker, phase chip, mission bar | Phase, route risk, exit | "Target 4 km. Strike zone ahead." / "Safer route: north valley." |
| Weather | Cloud | Weather gauge, storm cells | Storms, clouds, wind | "Storm ahead: radar blind for 20 seconds." |
| Wingman | Star | Message console, voice | Everything, through the other five | Answers your questions, strategic advice, mission recap |

### 9.1 Making the crew visible

- **Crew strip.** A row of the six icons sits beside the message console. An icon lights when its agent has something to say and dims when all is well. Tap or hover an icon for its one-line status ("Weapons: 412 rounds, 5 missiles, 2 strike").
- **Zone glow.** When an agent posts a message, its cockpit zone gets a brief outline glow in the message's urgency color.
- **Explain mode** (the "?" button) draws lines from each icon to the gauges it owns, then fades after 3 seconds.

### 9.2 How they coordinate

- Each agent reads the game state ten times a second and posts findings to a shared bus. Only the agent that owns a gauge writes about it.
- Wingman is the single voice. It picks the most important message by a fixed order, so two agents never talk over each other:

1. Ground collision
2. Missile launched at you
3. Being locked
4. Heavy damage
5. Fuel below the home line
6. Target in range or strike zone reached
7. Route and weather advice
8. Tips

- Everything in that list is computed locally from game state, in milliseconds. The language model only helps with strategic questions and the mission recap (section 11).

## 10. Message console and voice

The console shows at most two short lines below the crosshair, out of the aiming area; you can read it in a glance or ignore it, and voice is optional.

- **Format:** agent icon, then at most eight words, colored by urgency. Hover or tap a line for one more sentence of detail.
- **Lifetime:** lines fade after 4 seconds; red lines stay until the danger is over.
- **Pace:** at most one new line every 2 seconds, except red. Repeats are merged ("Drones ×5").
- **Combat quiet:** while you're dogfighting or defending a missile, only red and amber lines appear.
- **Chatter level** follows difficulty (tips, key alerts, critical only) and can be set separately.
- **Voice modes:** Off, Critical only (default), All. Toggle with M or the speaker icon. Critical voice lines are pre-recorded clips, so they play instantly.
- **History:** a small log button opens the last 30 messages, for after the fight.

## 11. Voice and typed commands

Hold push-to-talk, say a few words, let go: commands act instantly, questions about your jet answer instantly from game state, and only strategic questions reach the AI model, answering in about a second with a one-word verdict you can read at a glance.

| Kind | Examples | Answered by | Response |
| --- | --- | --- | --- |
| Instant commands | "Flares", "Boost", "Next target", "Autopilot on", "Go to target", "Head home", "Voice off", "Pause" | Local grammar, under 300 ms | Action plus a one-word confirmation line |
| Tactical questions | "Fuel?", "Ammo?", "How many missiles?", "Where's the target?", "What's that?" | Game state, instant | One line, and the matching gauge glows |
| How-to questions | "How do I use the strike missile?", "How do flares work?" | Built-in help cards, instant | One line, plus the button and gauge involved highlighted on screen |
| Strategic questions | "Should I escape?", "Dogfight or avoid?", "This route or that one?", "Should I abort?", "Best way to hit the target?" | Crew advisor, phrased by the AI model | Verdict chip, one-sentence reason, optional one-tap action |

### 11.1 Strategic answers

- **Verdict chip** in color: ENGAGE (cyan), AVOID (amber), ESCAPE (amber), ABORT (red), CONTINUE (green), REROUTE (purple).
- **One reason**, at most 15 words: "Two fighters, you have 2 missiles and 30% damage. Avoid; go north."
- **Optional action**, accepted with "yes", the Y key or a tap: "Set route north?"
- **Deterministic first.** A local advisor scores the options from fuel, damage, ammo, threats and distance, so the verdict exists even with no network. The model phrases the reason and may weigh nuance, but every number it says is checked against game state before it appears.

### 11.2 Keeping it quick

- Push-to-talk only; the mic is never open otherwise.
- No spoken read-backs in combat; a short confirmation line appears instead.
- No mic? Press "/" and type the same commands and questions.
- If the model is unavailable or the daily budget is used up, strategic answers still come from the local advisor, just with a template reason.

## 12. First visit

The landing page is the cockpit itself, live and paused behind a three-card explainer that shows, mostly in pictures, what the mission is, how the AI crew helps, and how to fly on your device.

1. **Your mission.** A picture strip: your jet, enemies, target, exit zone. One line: "Fly in, destroy the target, get out."
2. **Your AI crew.** The six agent icons around a cockpit sketch, each linked by a line to the gauges it owns. One line: "Six AI agents watch your instruments and tell you what matters."
3. **Fly.** Control diagram for the device detected: keyboard and mouse, gamepad, or touch. Difficulty picker (Cadet preselected), then two buttons: "Training flight" and "Start mission".

- Skip is always visible; the "?" button reopens the explainer later.
- The explainer shows only on the first visit (remembered in the browser).
- **Training flight** takes about 60 seconds: fly through three rings, shoot a drone, flare a missile, fire a strike missile. Each step is shown by an arrow and a highlighted control, not paragraphs.

## 13. Responsive UI

One cockpit layout reflows from a widescreen monitor to a phone held sideways, keeping the crosshair clear, the radar and threat ring always visible, and every control reachable.

| Mode | When | Layout |
| --- | --- | --- |
| Wide | Landscape, width 1280 px and up | Full cockpit: gauges on both sides, radar bottom-left, weapons bottom-right, console under the crosshair |
| Compact | Landscape, 900–1279 px wide, or height under 720 px | Smaller gauges; speed and altitude become thin tapes; weather folds into the radar |
| Touch | Any touch-first device in landscape | Virtual stick bottom-left, fire cluster bottom-right, radar top-left, console top-center |
| Rotate | Portrait | A simple picture asking you to turn the device; the game pauses |

**Requirements**

- 60 fps on desktop and laptop; 30 fps or better on a mid-range phone, with resolution lowered automatically to hold it.
- Under 50 ms from input to on-screen response.
- Every touch target is at least 44 px; notches and rounded corners are respected.
- HUD text and gauges scale smoothly with the screen; nothing overlaps the crosshair area at any size.
- First load under 5 MB compressed, so the cockpit appears in about 2 seconds on a typical connection.

## 14. Architecture at a glance

The whole game, including all six agents, runs in the browser; a single Cloudflare Worker serves it and answers only strategic questions, meters the AI budget and keeps scores.

- **Browser:** game loop and rendering, HUD, input, audio, the six agents in a background worker, the local grammar, tactical answers and the deterministic advisor.
- **Edge:** static hosting, one API Worker, Workers AI for strategic phrasing and mission recaps, a Durable Object budget ledger, and D1 for scores.

The companion implementation document covers the build in TypeScript, the free-tier budget, Playwright tests and the responsive layout in detail.

## 15. Acceptance and roadmap

Version 1 ships when new players can finish a mission at Cadet, name what the AI crew does, and play ten minutes without discomfort.

| Measure | Target | How it's checked |
| --- | --- | --- |
| First mission success at Cadet | 4 of 5 new players within two attempts | Playtest |
| Crew understood | 4 of 5 players can say what at least four agents do after one mission | Playtest interview |
| Comfort | No discomfort reported in a 10-minute session at default settings | Playtest |
| Alert speed | Red alert on screen within 100 ms; voice within 250 ms | Automated test |
| Frame rate | 60 fps desktop; 30 fps mid-range phone | Automated test |
| AI cost | 40 neurons or fewer per mission on average | Budget ledger |

**Roadmap**

1. **Playable core:** one mission, arcade flight, cannon and missiles, radar, Cadet difficulty.
2. **AI crew:** the six agents, crew strip, zone glow, message console, critical voice clips.
3. **Talk to your wingman:** push-to-talk, typed commands, tactical answers, strategic advisor.
4. **Full game:** three missions, all difficulty levels, onboarding explainer and training flight, polish.
