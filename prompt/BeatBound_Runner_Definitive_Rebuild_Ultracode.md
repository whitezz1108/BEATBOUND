# BEATBOUND — RUNNER DEFINITIVE REBUILD
## Full Ultracode Execution Prompt

> Use this entire file as one prompt.

---

# IMPORTANT EXECUTION INSTRUCTION

Use the full capability and context budget available for this task.

Do not optimize for finishing quickly.

This is the highest-priority gameplay task in the project.

You are expected to inspect broadly, make substantial implementation changes, run the game and validation tools, and perform multiple refinement passes before returning control to me.

Do not ask me to choose between minor implementation options. Make strong engineering/game-design decisions yourself based on the target described below.

Only stop to ask me if:

1. a destructive decision would affect unrelated project systems,
2. essential project data is genuinely missing,
3. or the current environment prevents actual implementation/testing.

Otherwise, continue autonomously until the Runner showcase and real runtime meet the acceptance criteria.

---

# BEATBOUND — RUNNER DEFINITIVE REBUILD
## Build the Runner mode I actually want, not another incremental prototype

You are working on the current BeatBound repository.

Treat this as a serious gameplay-system rebuild, not a small polish pass.

You have permission to substantially refactor the RUNNER mode if the existing architecture is preventing good gameplay.

Your role for this task is simultaneously:

- senior gameplay programmer
- rhythm-game technical designer
- procedural level-design engineer
- platformer physics designer
- game-feel designer
- QA/playability engineer

The target is NOT merely “a functional Runner”.

The target is:

> a fast, musical, continuously choreographed rhythm-platforming mode whose player motion, terrain, jumps, gravity changes, hazards, and visual rhythm all feel intentionally composed around the music.

The current Runner is far below that target.

Do not defend the existing implementation.

Diagnose it, replace weak foundations where necessary, and keep iterating until the result visibly and mechanically demonstrates the target.

---

# 0. NON-NEGOTIABLE WORKING RULES

Before changing anything:

1. Inspect the current repository.
2. Find the real RUNNER runtime.
3. Find its physics.
4. Find its rendering.
5. Find its pattern/mechanics data.
6. Find its procedural generation path.
7. Find all Runner-related validation tools.
8. Find mode transition/input integration.
9. Find any existing test/demo level infrastructure.
10. Understand how current level JSON reaches the real runtime.

Do not rely on assumptions from old prompts.

The current code is the source of truth.

Do not automatically:

- git commit
- git push
- rewrite unrelated modes
- destroy backwards compatibility without a migration path

Keep ARENA / RADIAL / VERTICAL working.

If RUNNER data/schema must change, provide backward compatibility where reasonably possible.

Do not stop after writing architecture.

Do not stop after writing TODOs.

Do not stop because unit tests pass.

The mode must be actually playable and visually demonstrate the new traversal grammar.

---

# 1. WHY THE CURRENT RUNNER IS UNACCEPTABLE

The current Runner approximately looks and plays like:

flat floor
→ isolated spike
→ empty space
→ isolated spike
→ empty space
→ isolated spike

Most of the vertical screen is unused.

Player motion is mostly:

____/\____________/\____________/\____

This is not rhythm platforming.

This is a primitive auto-run obstacle prototype.

The intended inspiration is the TRAVERSAL GRAMMAR of games such as Geometry Dash:

- continuous forward movement
- chained inputs
- constant upcoming structure
- meaningful floor geometry
- meaningful ceiling geometry
- vertical traversal
- raised platforms
- drops
- gaps
- spikes
- saw-like hazards where appropriate
- jump sequences
- gravity inversion
- corridors
- portals / transition mechanics where useful
- short recovery moments
- high-density musical phrases
- strong anticipation

Do NOT copy Geometry Dash:

- artwork
- exact levels
- proprietary assets
- exact layouts

We are learning from its design grammar, not cloning content.

---

# 2. THE MOST IMPORTANT ARCHITECTURAL CHANGE

The old philosophy:

MUSIC BEAT
↓
CHOOSE OBSTACLE
↓
PLACE OBSTACLE

must be removed as the primary Runner generation strategy.

Replace it with:

SONG / MUSICAL PHRASE
↓
RUNNER GAMEPLAY MOTIF
↓
INTENDED PLAYER MOTION PHRASE
↓
PHYSICALLY VALID PLAYER TRAJECTORY
↓
TERRAIN CONSTRUCTION
↓
HAZARD CONSTRUCTION
↓
READABILITY / TELEGRAPH LAYER
↓
VISUAL / JUICE LAYER

The intended player motion comes BEFORE platforms and hazards.

This is mandatory.

---

# 3. PLAYER TRAJECTORY IS THE LEVEL

The most important generated artifact in RUNNER should be the player's intended movement trajectory.

For every active gameplay phrase, the system should know something approximately like:

time / beat
x
target y
gravity direction
grounded / airborne
jump requested
landing expected
platform target
clearance requirements

It does not need to be a perfect frame-by-frame TAS.

But it must be sufficient to answer:

- where should the player jump?
- where should the player land?
- how high should they travel?
- how long are they airborne?
- where should the next platform exist?
- how much clearance is required?
- is the next action reachable?

Only after this trajectory exists should terrain be built around it.

---

# 4. DEFINE A RUNNER MOTION LANGUAGE

Build a reusable motion-phrase vocabulary.

At minimum support concepts equivalent to:

GROUND_RUN

SHORT_JUMP

MEDIUM_JUMP

LONG_JUMP

HIGH_JUMP

QUICK_HOP

DOUBLE_HOP

TRIPLE_HOP

LAND_AND_IMMEDIATE_REJUMP

GAP_JUMP

LONG_GAP

DROP

DROP_AND_JUMP

STAIRCASE_UP

STAIRCASE_DOWN

PLATFORM_ASCENT

PLATFORM_DESCENT

HIGH_LOW_ALTERNATION

PLATFORM_HOP_CHAIN

RHYTHMIC_BOUNCE

SYNCOPATED_HOPS

AIRBORNE_ACCENT

CEILING_RUN

CEILING_HOP

INVERTED_PLATFORM_CHAIN

GRAVITY_FLIP_UP

GRAVITY_FLIP_DOWN

GRAVITY_ZIGZAG

TOP_BOTTOM_CORRIDOR

TIGHT_VERTICAL_WINDOW

RELEASE_RUN

Do not implement these as random labels.

They must correspond to actual geometry/trajectory behavior.

---

# 5. BUILD PHRASES, NOT EVENTS

The generator must operate primarily in multi-beat phrases.

Good basic units:

2 beats
4 beats
8 beats
16 beats

A typical phrase should contain several connected actions.

Example:

Beat 1:
ground run → jump

Beat 2:
land on raised platform

Beat 2.5:
immediate short jump

Beat 3:
land lower

Beat 3.5:
jump over spike

Beat 4:
land into next phrase

The next action should often be causally connected to the previous one.

The player should feel:

“I am performing a sequence.”

Not:

“I am waiting for the next object.”

---

# 6. RHYTHM PLATFORMING

RUNNER needs a real rhythmic input grammar.

Support sensible combinations of:

1 beat

1/2 beat

1/4 beat

occasional syncopation

Do not create unreadable input spam.

Example phrase:

1 & 2 & 3 & 4 &

J   L J   J L   J

Another:

1 & 2 & 3 & 4 &

J L J L     J   L

where:

J = expected jump
L = expected landing

The jump rhythm should produce terrain.

Not the other way around.

---

# 7. LANDINGS MATTER AS MUCH AS JUMPS

Current Runner thinking is too focused on obstacles.

In good rhythm platforming, landing itself is a rhythmic event.

Design:

jump
→ landing
→ immediate jump

and:

long jump
→ hard landing
→ short recovery
→ next jump

Landings should frequently coincide with:

- beat accents
- kick
- snare
- section accents
- visual pulses

where musically appropriate.

The player should feel the beat through:

TAKEOFF

and

LANDING.

---

# 8. PHYSICS MUST DRIVE GEOMETRY

Locate the real values for:

horizontal scroll speed

player width/height

collision box

jump impulse

gravity

terminal velocity if applicable

air control if applicable

gravity-inverted equivalents

From those values derive:

jump airtime

time to apex

maximum jump height

horizontal distance during a jump

reachable landing ranges

minimum landing width

minimum ceiling clearance

safe gap widths

Do not continue using arbitrary platform spacing disconnected from physics.

Create shared Runner traversal calculations if they do not already exist.

The generator and validator should use the SAME physical assumptions.

---

# 9. PLATFORM GEOMETRY MUST BECOME THE PRIMARY LEVEL STRUCTURE

The current flat-floor baseline must stop dominating the mode.

RUNNER needs real terrain.

Support meaningful use of:

ground floor

raised blocks

low platforms

medium platforms

high platforms

floating platforms

short platforms

long platforms

stepped terrain

staggered platforms

gaps

pits

ceiling geometry

inverted surfaces

The level should regularly move through vertical zones conceptually similar to:

BOTTOM

LOW

MID

HIGH

CEILING

Not every phrase needs all five.

But energetic Runner sections should not spend most of their duration at BOTTOM.

---

# 10. A SCREENSHOT MUST SHOW A COURSE

This is a hard visual acceptance criterion.

During an active medium/high-intensity Runner phrase, a screenshot should usually communicate a traversal route even when frozen.

A typical screenshot should contain multiple meaningful structures such as:

- current platform
- next landing platform
- elevation difference
- a gap
- floor hazard
- ceiling hazard
- upcoming high/low transition
- corridor boundary
- gravity transition
- chained geometry

BAD SCREENSHOT:

player

flat line

spike

empty space

spike

GOOD SCREENSHOT:

ceiling structure
↓
hanging hazard
↓
raised target platform
↓
gap
↓
current platform
↓
floor hazard
↓
visible next trajectory

The route should be readable from the frame.

---

# 11. STRUCTURAL DENSITY, NOT RANDOM DENSITY

The current Runner is too empty.

Do NOT fix this by simply increasing obstacle count.

Increase STRUCTURAL DENSITY.

That means:

more terrain relationships

more visible upcoming route

more vertical framing

more chained landings

more platforms

more corridors

more geometry

more meaningful spatial rhythm

Avoid:

random spike spam

random decoration spam

random hazard noise

---

# 12. USE THE CEILING

The ceiling currently contributes too little to gameplay.

It should become a real level-design surface.

Use it for:

hanging obstacles

ceiling spikes

ceiling platforms

upper corridor boundaries

gravity-inverted traversal

visual framing

top/bottom alternation

After gravity inversion, the ceiling becomes the floor.

Inverted gameplay must be a real section, not a gimmick lasting one second.

---

# 13. GRAVITY FLIP MUST CREATE FULL GAMEPLAY PHRASES

Bad implementation:

normal
→ portal
→ 1 second upside down
→ portal
→ normal

Reject this.

Good implementation:

normal traversal phrase
↓
clear visual/music anticipation
↓
gravity transition
↓
safe inverted landing
↓
4–16 beat inverted phrase
↓
ceiling jumps / hazards / platform chain
↓
transition phrase
↓
flip back
↓
safe landing
↓
continue

Every gravity flip must account for:

arrival trajectory

landing surface

player clearance

reaction window

camera readability

next action

Do not flip gravity directly into unavoidable death.

---

# 14. BUILD VERTICAL CORRIDORS

Introduce gameplay where floor and ceiling together define the route.

Examples:

wide corridor

narrow corridor

corridor gradually rising

corridor gradually falling

alternating high/low window

inverted corridor

gravity-change corridor

The player should sometimes need to follow a moving safe vertical envelope.

This creates strong rhythmic movement without relying only on spikes.

---

# 15. SPIKES ARE A LANGUAGE ELEMENT, NOT THE ENTIRE LANGUAGE

Spikes should be used intentionally.

Support combinations such as:

single spike

double spike

triple spike

spike cluster

edge spike

pit spike

ceiling spike

alternating top/bottom spike

spike on platform

spike before landing

spike after landing

spike forcing immediate re-jump

But the level must remain structurally interesting even if spikes are temporarily hidden.

Terrain is primary.

Spikes refine the route.

---

# 16. OTHER HAZARD FAMILIES

Inspect what the current engine can safely support.

Where appropriate, use or introduce reusable Runner hazard types such as:

saws / rotating hazards

hanging hazards

pits

moving obstacles

crushers only if readable

jump pads

jump orbs

gravity portals

speed-change gates if appropriate

Do not implement every possible mechanic merely to increase feature count.

Every new mechanic must create a useful traversal verb.

---

# 17. JUMP PAD / ORB PHILOSOPHY

If jump pads or orbs are implemented:

they must be used musically and predictably.

They can create:

forced high jump

midair re-launch

rhythm accent

trajectory redirect

gravity interaction

Do not let them become random visual objects.

The player must immediately understand:

what they do

when they trigger

where they will send the player

---

# 18. CAMERA / LOOK-AHEAD

Inspect the current player screen position and visible look-ahead.

Runner must provide enough future visibility to read a dense phrase.

The player should not be positioned so far right that upcoming geometry becomes surprise damage.

The camera should support:

anticipation

planning

rhythm reading

For fast sections, enough upcoming terrain should be visible to mentally parse multiple actions ahead.

If necessary, adjust:

player horizontal anchor

camera composition

object spawn visibility

telegraph distance

---

# 19. PLAYER SCALE

Retune the Runner player's:

visual size

collision box

environment scale

platform dimensions

The player should feel agile.

Avoid a giant block squeezing through tiny geometry.

Visual collider relationship should be forgiving and intuitive.

Collision box may be modestly smaller than visual bounds if appropriate.

No pixel-perfect corridors.

---

# 20. RUNNER TRAJECTORY WAVEFORM

Create or expose a debug representation of expected vertical motion over time.

For a phrase, imagine plotting:

Y position

against

beat/time.

Current bad output resembles:

____/\____________/\____________/\____

Target output should contain actual phrases:

__/\/\___/‾‾\__\/\_/‾\___/\/\____

Not necessarily chaotic.

It should visually correspond to:

rise

repeat

variation

climax

release

Different motifs should produce visibly different trajectory signatures.

---

# 21. PHRASE GRAMMAR

Create higher-level phrase archetypes.

Examples:

## GROOVE

moderate jumps
stable terrain
clear repetition

## ASCENT

successively higher landings

## DESCENT

controlled drops and lower platforms

## BOUNCE

short repeated hops

## WAVE

low → high → low → high

## CLIMB_AND_DROP

rising staircase ending in large fall

## GAP_RUN

series of increasingly difficult gaps

## FLIP

gravity-transition phrase

## INVERTED_GROOVE

ceiling rhythm section

## CORRIDOR

constrained high/low route

## BURST

short dense rhythm

## RELEASE

low-threat breathing segment

The procedural system should compose these deliberately.

---

# 22. INTRODUCTION → REPETITION → VARIATION → CLIMAX → RELEASE

RUNNER should use actual level-design phrasing.

For example, over 16 beats:

Beats 1–4:
introduce rhythm

Beats 5–8:
repeat with recognition

Beats 9–12:
variation

Beats 13–15:
climax

Beat 16:
release / transition

Do not continuously generate unrelated mechanics every beat.

Teach the player a movement idea.

Repeat it.

Then modify it.

---

# 23. MOTIFS MUST RECUR

If a section establishes:

short-short-long

or:

low-high-low

or:

jump-land-jump

the same motif should sometimes return later with variation.

This gives the Runner musical memory.

Do not make every 4 beats unrelated.

---

# 24. MUSIC-READY INTERFACE

The advanced Editor/music-director work may happen separately.

However, RUNNER must expose a clean interface so musical analysis can eventually control:

phrase intensity

rhythm subdivision

melody contour

accent positions

section boundaries

gravity transitions

motif choice

terrain direction

Do not tightly couple the new Runner to one simple beat-only generator.

Build it so future musical information can drive it.

---

# 25. MELODY → TERRAIN CONTOUR

Support the concept of terrain following musical contour.

Examples:

melody rising

→ ascending platforms

melody falling

→ descending platforms

large melodic leap

→ larger jump or elevation change

repeated note pattern

→ repeating platform motif

sustained phrase

→ longer airborne / long platform / lower input density

The current generator may initially use synthetic/test contour data.

But the architecture must support this cleanly.

---

# 26. PERCUSSION → ACTION TIMING

Runner action accents should eventually respond to rhythmic layers.

Conceptually:

kick
→ takeoff / heavy landing / platform transition

snare
→ sharp landing / hazard accent

fast percussion
→ hop chain

fill
→ dense transition phrase

Again:

do not hardcode these assumptions blindly.

But make the system capable of accepting an accent timeline.

---

# 27. BUILD A DETERMINISTIC RUNNER SHOWCASE BEFORE PROCEDURAL RECONNECTION

This is mandatory.

Do not immediately regenerate a whole song.

First create a deterministic handcrafted / explicitly scripted Runner showcase.

Length:

approximately 45–60 seconds.

It must intentionally demonstrate the complete desired gameplay vocabulary.

Suggested structure:

0–6 sec
simple readable jumps

6–12 sec
chained short jumps

12–18 sec
staircase ascent and descent

18–24 sec
high/low platform alternation

24–30 sec
gap sequence + landing rhythm

30–38 sec
gravity flip + inverted ceiling traversal

38–46 sec
vertical corridor / top-bottom movement

46–54 sec
dense rhythmic climax

54–60 sec
release and safe finish

The exact timing can change based on the current project.

But the showcase must demonstrate ALL important systems.

I need a direct way to launch this showcase.

---

# 28. CREATE MULTIPLE MICRO TEST LEVELS

Also create smaller deterministic test scenes or fixtures.

At minimum:

RUNNER_TEST_01_BASIC_CHAIN

RUNNER_TEST_02_SHORT_SHORT_LONG

RUNNER_TEST_03_STAIRCASE

RUNNER_TEST_04_HIGH_LOW

RUNNER_TEST_05_GAP_CHAIN

RUNNER_TEST_06_DROP_AND_JUMP

RUNNER_TEST_07_GRAVITY_FLIP

RUNNER_TEST_08_INVERTED_CHAIN

RUNNER_TEST_09_VERTICAL_CORRIDOR

RUNNER_TEST_10_DENSE_PHRASE

RUNNER_TEST_11_MIXED_SHOWCASE

Each test should isolate a design problem.

This makes tuning possible without replaying an entire song.

---

# 29. AUTOMATED PLAYABILITY VALIDATION

Find the existing runner-check or equivalent.

Extend it rather than creating redundant tools if possible.

Validate actual traversal.

At minimum detect:

unreachable jump

gap wider than physical capability

platform too narrow to land

insufficient landing clearance

ceiling collision during arc

landing directly in unavoidable hazard

forced jump with insufficient timing window

impossible gravity transition

spawn overlap

hazard overlapping intended safe path

corridor too narrow

platform embedded in another collider

invalid inverted landing

large unexplained empty section

---

# 30. VALIDATE THE INTENDED PATH

Where possible, validation should inspect the intended trajectory generated before terrain construction.

For every expected landing:

verify a valid surface exists.

For every expected jump:

verify the next target lies within a reachable region.

For every airborne segment:

verify hazards do not invade required clearance unless the player is expected to perform a different mechanic.

The generator should know WHY a challenge is solvable.

Not merely hope that it is.

---

# 31. OPTIONAL BOT / SIMULATION

If practical within the existing architecture:

build a lightweight deterministic traversal simulator for the intended route.

It does not need ML or full AI.

It can simply execute the planned jump events against approximate Runner physics.

Use it to detect:

trajectory mismatch

missed platforms

hazard intersection

gravity-transition failures

This would be highly valuable.

Do not spend the entire task building an overengineered bot if it blocks gameplay progress.

---

# 32. DIAGNOSTIC METRICS

Add useful Runner diagnostics.

Examples:

jumpsPerBar

landingsPerBar

verticalRangeUsage

terrainHeightVariance

airborneRatio

platformTransitions

gravityStateChanges

maxFlatRunBeats

maxEmptyScreenTime

averageLandingWidth

minimumClearance

phraseCount

motifRepeatRate

hazardDensity

structuralDensity

Do not blindly maximize metrics.

Use them to detect dead or pathological sections.

For energetic phrases:

a very large maxFlatRunBeats should be suspicious.

---

# 33. EMPTY SPACE RULE

Long empty flat-floor stretches are allowed only when musically or structurally intentional.

Examples:

intro

break

recovery

pre-drop anticipation

outro

They should not appear simply because the generator failed to create content.

---

# 34. VISUAL READABILITY

Gameplay structures must be readable instantly.

Clearly distinguish:

solid platform

hazard

background

interactable object

gravity portal

jump pad / orb

decorative geometry

Do not allow the background to compete with collision geometry.

The player should understand future movement in under a second.

---

# 35. GAME FEEL AFTER STRUCTURE WORKS

Once the deterministic showcase is mechanically strong, polish Runner feel.

Possible systems:

landing squash / impact

jump stretch

rotation

small trail

beat-synced platform pulse

landing particle burst

subtle screen impact

gravity-flip transition effect

portal distortion

speed lines at high intensity

camera impulse on major accents

Do not let these effects obscure hitboxes or upcoming terrain.

Juice must reinforce timing.

---

# 36. CHARACTER ROTATION

If the current player is a square-like Runner avatar:

use its rotation meaningfully.

Examples:

airborne rotation

landing snap

inverted rotation

gravity transition interpolation

The player's pose should communicate state.

Do not leave it visually static during movement if rotation fits the existing art direction.

---

# 37. BACKGROUND SHOULD SUPPORT SPEED

The current mode should visually communicate forward velocity.

After gameplay geometry works, use restrained methods such as:

parallax

layered background motion

beat-reactive structures

foreground silhouettes

motion accents

Do not replace level geometry with decoration.

---

# 38. DEATH / RETRY LOOP

Inspect Runner death and restart.

Rhythm platforming requires fast iteration.

If the current restart loop is slow or disruptive:

improve it.

Target:

clear hit

short readable death response

fast restart

minimal unnecessary waiting

Do not introduce long countdowns for every Runner retry unless required by the broader game.

---

# 39. INPUT LATENCY / BUFFERING

Inspect jump input behavior.

Consider implementing or tuning:

small jump input buffer

small coyote-time equivalent if appropriate for this auto-run system

early press buffering before landing

Do NOT make input sloppy.

But rhythm input should feel responsive rather than requiring frame-perfect presses.

Use modest values appropriate to the game's speed.

Document them.

---

# 40. HOLD BEHAVIOR

Determine whether Runner jump is:

tap-only

hold-for-height

fixed-height

If the existing design does not intentionally support variable jump height, do not accidentally create ambiguous physics.

Choose a coherent model.

For BeatBound, prioritize predictable rhythm-platforming.

If variable height meaningfully improves gameplay, implement it carefully and make procedural validation aware of it.

Otherwise fixed deterministic jump arcs may be preferable.

Base the decision on the current runtime and desired feel.

---

# 41. SPEED TIERS

Runner may need several controlled scroll-speed tiers.

For example:

LOW

NORMAL

HIGH

CLIMAX

Do not continuously change speed.

Speed changes should happen intentionally at phrase or section boundaries.

A speed increase must preserve:

readability

jump timing

physics solvability

camera look-ahead

generation rules

---

# 42. DIFFICULTY SHOULD COME FROM COMPOSITION

Do not create difficulty mainly through:

faster hazards

shorter reaction time

tiny landing surfaces

pixel-perfect gaps

Instead increase:

chained actions

rhythm complexity

vertical movement

platform transitions

top/bottom interaction

gravity changes

motif variation

path precision

Difficulty must remain learnable.

---

# 43. SAFE SPACE MUST BE REAL

When the intended trajectory passes through a corridor:

use actual player collision dimensions.

Include margin.

A mathematically possible 1-pixel route is a failure.

---

# 44. PROCEDURAL COMPOSER — ONLY AFTER THE SHOWCASE WORKS

After the deterministic Runner showcase is convincingly fun:

reconnect procedural generation.

The generation hierarchy must be:

SECTION

→ INTENSITY

→ RUNNER MOTIF

→ PHRASE

→ TRAJECTORY

→ PHYSICS VALIDATION

→ TERRAIN

→ HAZARDS

→ READABILITY CHECK

→ FINAL VALIDATION

Do not return to per-beat random obstacle selection.

---

# 45. PROCEDURAL PHRASE COMPOSITION

Build phrase templates with controlled parameters.

For example:

STAIRCASE_UP

parameters:
- number of steps
- beats per step
- vertical increment
- hazards
- final jump

BOUNCE_CHAIN

parameters:
- hop rhythm
- landing heights
- spike placement
- ending type

GRAVITY_SECTION

parameters:
- pre-flip phrase
- inversion length
- inverted motif
- post-flip recovery

Templates can vary without becoming random noise.

---

# 46. CONTROLLED RANDOMNESS

Use seed-based deterministic variation.

Randomness may choose:

variation

height

spacing

motif order

hazard flavor

But it must stay inside validated design ranges.

Randomness must never directly decide:

“maybe this jump is impossible.”

---

# 47. ANTI-REPETITION

Prevent procedural output from producing:

same jump arc 20 times

same spike spacing repeatedly

same platform height repeatedly

same gravity trick every section

Use phrase-level variation and motif memory.

But repetition can be intentional when the music repeats.

---

# 48. ANTI-CHAOS

Also prevent:

new mechanic every second

constant gravity flips

random platform heights

unreadable stacked hazards

The player must be able to learn a phrase.

Variation comes after recognition.

---

# 49. RUNNER-SPECIFIC TELEGRAPHING

Some mechanics require anticipation.

Examples:

gravity flip

speed change

large drop

tight corridor

orb chain

Use clear telegraphing.

Telegraphing should be integrated into the level:

portal placement

lighting

geometry framing

color pulse

lead-in shape

rather than giant debug text when possible.

---

# 50. MODE TRANSITION INTO RUNNER

Inspect the existing BeatBound mode-transition system.

When entering Runner:

show the correct Runner controls.

If the game uses four keys globally, display the actually relevant keys and actions.

The transition countdown should remain compatible with the project's current 3-second target.

Once Runner begins:

the first gameplay phrase must give a short readable onboarding window.

Do not transition directly into a lethal dense sequence.

---

# 51. DO NOT BREAK AUDIO SYNC

All Runner redesign must preserve BeatBound's music synchronization.

If gameplay uses beat/time coordinates:

keep one authoritative timeline.

Avoid:

visual time drift

physics time drift

transition desync

pause/resume offset bugs

Runner action timings should be derived from the same musical clock where possible.

---

# 52. VALIDATE AT MULTIPLE BPM VALUES

Test at minimum representative cases such as:

slow BPM

medium BPM

high BPM

The exact values should use the current project's supported ranges.

A jump that feels correct at 120 BPM may not map directly to every tempo.

The system may need:

subdivision choices

phrase stretching

speed tier changes

instead of blindly placing one jump every beat.

---

# 53. DO NOT FORCE ONE JUMP PER BEAT

This is critical.

Music is not:

beat = jump

Sometimes:

one jump lasts two beats.

Sometimes:

two hops occur inside one beat.

Sometimes:

the player runs for a beat.

Sometimes:

landing is the accent.

The system must understand rhythmic phrases rather than mapping every onset to a jump.

---

# 54. DEVELOP WITH AN INTERNAL CRITIQUE LOOP

Do not implement once and immediately declare success.

Use this loop:

IMPLEMENT

↓
RUN TESTS

↓
PLAY / INSPECT SHOWCASE

↓
COMPARE AGAINST ACCEPTANCE CRITERIA

↓
IDENTIFY THE THREE BIGGEST WEAKNESSES

↓
FIX THEM

↓
REPEAT

Perform multiple meaningful refinement passes.

Do not artificially report success after the first technically working implementation.

---

# 55. SELF-REVIEW QUESTIONS

After each major pass, explicitly ask internally:

Does the player still spend too much time on flat ground?

Are there still isolated obstacles with no relationship?

Does the screen still have huge meaningless empty areas?

Does the trajectory visibly form phrases?

Are landings rhythmic?

Are platforms creating movement?

Is the ceiling actually used?

Are gravity sections substantial?

Can I read upcoming geometry?

Does the mode feel fast even in a screenshot?

Are there distinct low/high/intense/release phrases?

If several answers are bad:

continue working.

---

# 56. HARD FAILURE CONDITIONS

Do NOT claim completion if any of these remain common:

flat floor + isolated spikes

multi-second empty active sections

one jump every several seconds

gravity flip as a tiny gimmick

procedural random obstacle placement

unreachable platforms

unreadable incoming geometry

ceiling never used

platforms only cosmetic

player Y mostly flat

the showcase contains no memorable traversal sequence

the test level looks essentially like the old Runner with extra objects

---

# 57. TARGET FEEL

The Runner should produce moments like:

ground sprint

→ spike hop

→ land on raised block

→ immediate second hop

→ descend onto short platform

→ leap over gap

→ land exactly on musical accent

→ climb two platforms

→ large drop

→ gravity portal

→ invert

→ ceiling hop sequence

→ narrow high/low corridor

→ flip back

→ rapid three-jump climax

→ long landing

→ release

This should feel like one choreographed passage.

---

# 58. ACCEPTANCE METRIC: PLAYER MOTION

During a representative energetic 16-beat section:

the player should normally experience multiple meaningful changes in:

height

airborne state

landing surface

risk

route

A section where the player remains on the same floor for most of 16 beats is generally a failure unless intentionally designed as a break.

---

# 59. ACCEPTANCE METRIC: SCREEN COMPOSITION

For several screenshots taken from the deterministic showcase:

I should be able to look at each frame and identify:

current route

next route

vertical structure

danger

landing target

The screen must not look like a sparse debug prototype.

---

# 60. ACCEPTANCE METRIC: PHYSICAL FAIRNESS

Every mandatory challenge in the showcase must be consistently beatable by a competent player using the intended controls.

Avoid:

blind jumps

surprise death

sub-frame reaction

pixel-perfect landing

camera-hidden hazards

---

# 61. ACCEPTANCE METRIC: MUSICALITY

Even before advanced song analysis integration, the deterministic showcase should visibly demonstrate:

repeated rhythmic motifs

landing accents

dense and sparse contrast

build-up

climax

release

gravity transition at a musically sensible structural point

The gameplay should feel choreographed rather than randomly generated.

---

# 62. PRESERVE PROJECT QUALITY

Keep code modular.

Avoid creating one giant Runner file.

Separate reasonable responsibilities, for example:

physics/traversal calculations

phrase representation

trajectory planning

terrain construction

hazard construction

validation

render/runtime integration

debug diagnostics

Exact structure should follow the existing project architecture.

Do not refactor unrelated systems just for elegance.

---

# 63. DEBUG VIEW

Add a developer-facing Runner debug mode if useful.

Potential overlays:

intended trajectory

landing targets

reachable jump envelope

current phrase name

beat grid

gravity state

colliders

safe clearance

motif name

This should be optional and disabled in normal gameplay.

This will be valuable for future Editor integration.

---

# 64. DOCUMENT IMPORTANT CONSTANTS

Avoid unexplained magic numbers.

Important tuning values should have understandable names or comments:

jump buffer

minimum landing width

clearance margin

platform height steps

look-ahead

safe reaction time

gravity transition safety

phrase density

Do not over-configure trivial values.

---

# 65. USE THE PROJECT'S REAL VALIDATORS

Run the existing authoritative tools after modifications.

The project previously includes or has included tools conceptually like:

sync-test

level-report

camp-audit

runner-check

Use the CURRENT repository's actual scripts and commands.

Do not assume names if they changed.

Resolve failures properly.

Do not simply disable validations.

---

# 66. RUN REAL PLAYTEST PATHS

Do not only test isolated classes.

Load the Runner through the real BeatBound runtime.

Use the same:

LevelLoader

timing system

collision system

mode system

render path

that the game uses.

The deterministic showcase must run inside the actual game.

---

# 67. PROCEDURAL GENERATOR FINAL TEST

After the deterministic showcase is strong:

generate multiple seeded Runner sequences.

Use several seeds.

Check that they differ meaningfully while retaining:

solvability

density

phrasing

vertical variation

readability

musical rhythm

No seed should regress back to flat-floor spike spam.

---

# 68. FINAL REPORT

When the task is genuinely complete, provide a concise but concrete report containing:

A. Root causes found in the old Runner

B. Architecture changed

C. Major Runner gameplay systems now available

D. Deterministic test/showcase levels created

E. Procedural generation changes

F. Physics/playability validation added

G. Commands/tests executed

H. Test results

I. Remaining known limitations

J. Direct playtest instructions

K. Exact files significantly changed

Do not describe something as complete if it only has scaffolding.

---

# 69. MOST IMPORTANT PRIORITY ORDER

If time/complexity becomes large, prioritize in this order:

1. player trajectory planning

2. real platform terrain

3. chained jumps and rhythmic landings

4. physics-valid generation

5. vertical screen usage

6. gravity + ceiling traversal

7. corridors

8. procedural phrase composer

9. gameplay readability

10. visual juice

Never sacrifice priorities 1–6 just to add more effects.

---

# 70. FINAL PRODUCT STANDARD

The old Runner asks:

“What obstacle comes next?”

The new Runner must ask:

“What movement phrase is the player performing next?”

The final experience should feel closer to:

performing a musical obstacle course

than:

dodging randomly timed spikes.

When I play it, I want to experience:

continuous movement

high-low-high-low traversal

fast consecutive jumps

rhythmic landings

intentional platform shapes

meaningful gaps

dense but readable sections

ceiling gameplay

gravity inversion

musical build and release

strong visual forward momentum

I should be able to feel the music through the player's movement trajectory.

That is the standard.

Do not stop at “better than before.”

Build a Runner mode that is strong enough to become one of BeatBound's signature gameplay modes.
