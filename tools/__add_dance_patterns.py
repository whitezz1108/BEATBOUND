"""One-shot authoring helper: append the two pure-dance pattern families.

Not a build step and not part of the toolchain -- it exists so the fourteen new
A12 patterns (AP52-AP65, the Drip Too Hard and Jangchung dance families) could
be written once, in a readable shape, instead of as 2000 lines of hand-edited
JSON. It is kept as the provenance for those patterns, the way the other
`__`-prefixed scripts in this directory are kept. Re-running it is a no-op that
fails loudly: it asserts the ids are not already in the library.

    python tools/__add_dance_patterns.py
"""

import collections
import json

P = 'beatbound_library_v1/patterns.mvp.json'
MIRROR = {'LEFT': 'RIGHT', 'RIGHT': 'LEFT', 'UP': 'DOWN', 'DOWN': 'UP'}


def seq(pairs, mirror=False):
    return [
        collections.OrderedDict([
            ('beatOffset', off),
            ('direction', MIRROR[dr] if mirror else dr),
        ])
        for off, dr in pairs
    ]


def event(bar, beat, pairs, final, misses, mode='DAMAGE', mirror=False, prep=2, movement=0):
    return collections.OrderedDict([
        ('at', collections.OrderedDict([('bar', bar), ('beat', beat)])),
        ('mechanicId', 'A12'),
        ('params', collections.OrderedDict([
            ('prepBeats', prep),
            ('sequence', seq(pairs, mirror)),
            ('finalBeatOffset', final),
            ('maxMisses', misses),
            ('failureMode', mode),
            ('movementScale', movement),
        ])),
    ])


def pat(pid, name, fn, overall, diff, bars, tags, events, notes):
    return collections.OrderedDict([
        ('id', pid),
        ('name', name),
        ('mode', 'ARENA'),
        ('function', fn),
        ('difficulty', collections.OrderedDict([
            ('overall', overall),
            ('reaction', diff[0]),
            ('rhythmComplexity', diff[1]),
            ('spatialComplexity', diff[2]),
            ('inputComplexity', diff[3]),
            ('informationLoad', diff[4]),
        ])),
        ('lengthBars', bars),
        ('musicTags', collections.OrderedDict([
            ('rhythm', tags[0]),
            ('sections', tags[1]),
            ('energy', tags[2]),
        ])),
        ('events', events),
        ('constraints', collections.OrderedDict([('maxSimultaneousThreats', 1)])),
        ('notes', notes),
    ])


NEW = []

# ---------------------------------------------------------------------------
# Drip Too Hard -- 112.35 BPM, half-time, a swung vocal over a sparse low end.
# The analysis put the grid bar phase two beats in, so bar N beat 3 is the real
# downbeat: a phrase there resolving four grid beats later lands on the next
# real downbeat, which is what every pattern below is built around.
# ---------------------------------------------------------------------------

WALK = [(0, 'LEFT'), (0.667, 'UP'), (1.333, 'RIGHT'), (2, 'DOWN'), (2.667, 'LEFT')]

NEW.append(pat(
    'AP52', 'Seal Break: Swung Walk', 'PRACTICE', 3, (2, 4, 2, 3, 3), 4,
    (['SYNCOPATED', 'ACCENT'], ['VERSE', 'DROP'], ['MID']),
    [event(1, 3, WALK, 4, 2), event(3, 3, WALK, 4, 2, mirror=True)],
    'Drip Too Hard is a half-time record with a swung vocal, so the phrase is a '
    'triplet walk rather than an eighth-note one: five steps at two-thirds of a '
    'beat each, which is the subdivision the voice is actually using. Nothing '
    'lands on a strong beat except the accent, and that is the point -- the '
    'player is asked to feel the swing rather than count the grid. Two rounds, '
    'the phrase and its mirror, each resolving on a real downbeat four beats '
    'after it starts.',
))

NEW.append(pat(
    'AP53', 'Seal Break: Call and Reply', 'PRACTICE', 3, (2, 2, 2, 3, 2), 3,
    (['BEAT', 'DOWNBEAT'], ['VERSE', 'BREAKDOWN'], ['MID']),
    [
        event(1, 3, [(0, 'LEFT'), (1, 'UP'), (2, 'RIGHT'), (3, 'DOWN')], 4, 2),
        event(3, 1, [(0, 'RIGHT'), (0.5, 'DOWN'), (1, 'LEFT')], 2, 2),
    ],
    'The call is four arrows, one per beat, filling a whole real bar. The reply '
    'is three arrows in half a bar -- the same idea answered in half the time. '
    'That long-then-short shape is the song\'s own call and response between the '
    'vocal and the drop, and it teaches a player to read phrase length as '
    'information instead of expecting a fixed number of inputs. Both accents '
    'land on downbeats.',
))

NEW.append(pat(
    'AP54', 'Seal Break: Half-Time', 'COMBINE', 3, (3, 3, 2, 3, 3), 4,
    (['HALF_TIME', 'SUBDIVISION', 'ACCENT'], ['DROP', 'CHORUS'], ['MID']),
    [
        event(1, 3, [(0, 'LEFT'), (0.5, 'RIGHT'), (2, 'UP'), (2.5, 'DOWN'), (3, 'UP')], 4, 1),
        event(3, 3, [(0, 'RIGHT'), (0.5, 'LEFT'), (2, 'DOWN'), (2.5, 'UP'), (3, 'DOWN')], 4, 1),
    ],
    'A doubled cell, a beat and a half of nothing, then a second doubled cell '
    'running into the accent. The hole is authored rather than accidental: a '
    'player who reads ahead sees the gap and has to hold position through it '
    'instead of filling it. On a half-time record the silence is the loudest '
    'part of the bar, so the phrase spends its steps exactly where the track '
    'does and rests where the track rests.',
))

NEW.append(pat(
    'AP55', 'Seal Break: Offbeat', 'COMBINE', 4, (3, 4, 2, 4, 4), 4,
    (['SYNCOPATED', 'SUBDIVISION', 'ACCENT'], ['DROP', 'CHORUS'], ['HIGH']),
    [
        event(1, 3, [(0, 'LEFT'), (0.5, 'UP'), (1.5, 'RIGHT'), (2, 'DOWN'), (2.5, 'LEFT'), (3, 'UP')], 4, 1),
        event(3, 3, [(0, 'RIGHT'), (0.5, 'DOWN'), (1.5, 'LEFT'), (2, 'UP'), (2.5, 'RIGHT'), (3, 'DOWN')], 4, 1),
    ],
    'Six arrows in three beats with the second one missing: the cell doubles on '
    'the first half-beat and then skips the beat it would have landed on. The '
    'skip is what makes it read as syncopation rather than as a run -- the hand '
    'wants to press on that beat and has to not. One miss forgiven, because the '
    'first time a player meets a hole in a stream they will press into it.',
))

NEW.append(pat(
    'AP56', 'Seal Break: Pressure', 'CLIMAX', 5, (4, 3, 2, 5, 4), 4,
    (['SUBDIVISION', 'DRIVING', 'ACCENT'], ['DROP'], ['HIGH', 'PEAK']),
    [
        event(1, 3, [(0, 'LEFT'), (0.5, 'UP'), (1, 'RIGHT'), (1.5, 'DOWN'), (2, 'LEFT'), (2.5, 'UP'), (3, 'RIGHT')], 4, 1, 'HEAVY'),
        event(3, 3, [(0, 'RIGHT'), (0.5, 'DOWN'), (1, 'LEFT'), (1.5, 'UP'), (2, 'RIGHT'), (2.5, 'DOWN'), (3, 'LEFT')], 4, 1, 'HEAVY'),
    ],
    'Seven arrows, one per half-beat, straight through the bar and into the '
    'accent. This is the plainest thing the mechanic can ask for at this tempo '
    'and it is here on purpose: after the swing and the syncopation of the '
    'first drop, the loudest bars of the record ask for an even stream a player '
    'can lock onto. The pressure is the tempo, not the shape, which is why one '
    'miss is forgiven and the collapse behind it is heavy.',
))

NEW.append(pat(
    'AP57', 'Seal Break: Triplet Storm', 'CLIMAX', 5, (4, 5, 2, 5, 5), 4,
    (['SYNCOPATED', 'SUBDIVISION', 'ACCENT'], ['DROP'], ['HIGH', 'PEAK']),
    [
        event(1, 3, [(0, 'LEFT'), (0.667, 'RIGHT'), (1.333, 'UP'), (2, 'DOWN'), (2.333, 'LEFT'), (2.667, 'RIGHT'), (3, 'UP')], 4, 1, 'HEAVY'),
        event(3, 3, [(0, 'RIGHT'), (0.667, 'LEFT'), (1.333, 'DOWN'), (2, 'UP'), (2.333, 'RIGHT'), (2.667, 'LEFT'), (3, 'DOWN')], 4, 1, 'HEAVY'),
    ],
    'The swung walk again, but where it used to end it now doubles: four '
    'triplet steps, then three in the last beat. A player who learned the walk '
    'in the first drop recognises the opening and then has to accelerate inside '
    'a subdivision they thought they knew. That recognition-then-subversion is '
    'what makes a climax read as a climax rather than as a longer version of '
    'the same thing.',
))

NEW.append(pat(
    'AP58', 'Seal Break: Finale', 'BOSS', 5, (4, 4, 3, 5, 5), 5,
    (['SUBDIVISION', 'SYNCOPATED', 'ACCENT', 'DROP'], ['DROP', 'OUTRO'], ['HIGH', 'PEAK']),
    [
        event(1, 3, [(0, 'LEFT'), (0.5, 'UP'), (1, 'RIGHT'), (1.5, 'DOWN'), (2, 'LEFT'), (2.5, 'UP')], 4, 1, 'HEAVY'),
        event(3, 3, [(0, 'RIGHT'), (0.667, 'DOWN'), (1.333, 'LEFT'), (2, 'UP'), (2.5, 'RIGHT'), (3, 'DOWN')], 4, 1, 'HEAVY'),
        event(5, 1, [(0, 'LEFT'), (0.5, 'RIGHT'), (1, 'UP')], 2, 1, 'HEAVY'),
    ],
    'Three rounds in one pattern, and the only dance pattern in the library '
    'that asks for a third: an even six, a swung six, then a short three that '
    'resolves on the last beat of the pattern. The rounds are the same length '
    'on paper and different lengths in the hand, so the phrase cannot be '
    'memorised as a list -- it has to be read. It closes the level on the bar '
    'the record closes on, and the collapse behind it is heavy so that failing '
    'the last thing the song asks for is unambiguous.',
))

# ---------------------------------------------------------------------------
# Jangchung -- 129.2 BPM, four-on-the-floor and relentless, with the grid
# downbeat on the real downbeat. This family's signature is the accent: either
# on the bar line, or on beat four pushing into the next bar the way the track
# does.
# ---------------------------------------------------------------------------

NEW.append(pat(
    'AP59', 'Seal Break: Pulse', 'PRACTICE', 3, (3, 3, 2, 3, 3), 4,
    (['DOWNBEAT', 'SUBDIVISION', 'ACCENT'], ['VERSE', 'BUILD'], ['MID', 'HIGH']),
    [
        event(1, 3, [(0, 'LEFT'), (0.4, 'UP'), (0.8, 'RIGHT'), (1.2, 'DOWN')], 2, 2),
        event(3, 3, [(0, 'RIGHT'), (0.4, 'DOWN'), (0.8, 'LEFT'), (1.2, 'UP')], 2, 2),
    ],
    'Four arrows inside a beat and a fifth, then the accent on the very next '
    'bar line. At 129 BPM that is a press every 190ms, fast enough that the '
    'phrase has to be read as a shape rather than as four separate decisions, '
    'and the reward is an accent landing on the downbeat of the loudest track '
    'in the library. The mirror starts two beats later, so both accents land on '
    'bar lines and the pattern reads as a pulse rather than as a run.',
))

NEW.append(pat(
    'AP60', 'Seal Break: Push', 'PRACTICE', 3, (3, 3, 2, 3, 3), 4,
    (['SUBDIVISION', 'ACCENT', 'DRIVING'], ['VERSE', 'BUILD'], ['MID', 'HIGH']),
    [
        event(1, 3, [(0, 'LEFT'), (0.5, 'RIGHT'), (1, 'UP'), (1.5, 'DOWN'), (2, 'LEFT')], 5, 2),
        event(3, 3, [(0, 'RIGHT'), (0.5, 'LEFT'), (1, 'DOWN'), (1.5, 'UP'), (2, 'RIGHT')], 5, 2),
    ],
    'Five eighth-note steps and then three full beats of nothing before the '
    'accent lands on beat four. The gap is the mechanic: the player finishes '
    'the phrase early and has to hold the beat they were given instead of '
    'pressing when their hands are ready. Beat four is where this track pushes '
    'into the next bar, so the accent is authored to arrive with the push '
    'rather than with the downbeat it pushes toward.',
))

NEW.append(pat(
    'AP61', 'Seal Break: Stomp', 'COMBINE', 4, (4, 3, 2, 4, 4), 4,
    (['SUBDIVISION', 'DRIVING', 'ACCENT'], ['BUILD', 'DROP'], ['HIGH']),
    [
        event(1, 3, [(0, 'LEFT'), (0.5, 'LEFT'), (1, 'UP'), (1.5, 'UP'), (2, 'RIGHT'), (2.5, 'RIGHT')], 5, 1),
        event(3, 3, [(0, 'RIGHT'), (0.5, 'RIGHT'), (1, 'DOWN'), (1.5, 'DOWN'), (2, 'LEFT'), (2.5, 'LEFT')], 5, 1),
    ],
    'The same direction twice, three times over, then the accent on beat four. '
    'Doubled cells are how a four-on-the-floor record asks for weight rather '
    'than speed -- the hand comes back to the key it just left instead of '
    'travelling, which is a different motion from a run even at the same '
    'tempo. The accent on beat four keeps the push feel this family uses for '
    'the track, so the phrase ends leaning into the next bar.',
))

NEW.append(pat(
    'AP62', 'Seal Break: Roll', 'COMBINE', 4, (4, 3, 2, 4, 4), 4,
    (['SUBDIVISION', 'DOWNBEAT', 'ACCENT'], ['DROP', 'CHORUS'], ['HIGH']),
    [
        event(1, 3, [(0, 'LEFT'), (0.5, 'UP'), (1, 'RIGHT'), (1.5, 'DOWN'), (2, 'LEFT'), (2.5, 'UP'), (3, 'RIGHT')], 6, 1),
        event(3, 3, [(0, 'RIGHT'), (0.5, 'DOWN'), (1, 'LEFT')], 2, 1),
    ],
    'Seven arrows across three beats, resolving on the downbeat of the bar '
    'after next, then a three-arrow reply that resolves on the downbeat after '
    'that. The long round is long enough to leave working memory and has to be '
    'read as a continuous roll; the short round is the same idea compressed, so '
    'the two accents arrive two beats apart with nothing between them. It is '
    'the only pattern in the family whose rounds differ in length and share a '
    'resolution point.',
))

NEW.append(pat(
    'AP63', 'Seal Break: Break', 'CLIMAX', 5, (5, 4, 2, 5, 5), 4,
    (['SYNCOPATED', 'SUBDIVISION', 'ACCENT'], ['DROP'], ['HIGH', 'PEAK']),
    [
        event(1, 3, [(0, 'LEFT'), (0.5, 'RIGHT'), (1.5, 'UP'), (2, 'DOWN'), (2.5, 'LEFT'), (3, 'RIGHT'), (3.5, 'UP')], 5, 1, 'HEAVY'),
        event(3, 3, [(0, 'RIGHT'), (0.5, 'LEFT'), (1.5, 'DOWN'), (2, 'UP'), (2.5, 'RIGHT'), (3, 'LEFT'), (3.5, 'DOWN')], 5, 1, 'HEAVY'),
    ],
    'Seven arrows with one missing, and the missing one is the beat the player '
    'has been taught to press on. The hole sits where this family usually puts '
    'a step, so a player running on muscle memory will press into it and lose '
    'the phrase -- reading the row is the only way through. It is the hardest '
    'reading demand in the library at this tempo, which is why the accent lands '
    'on beat four rather than on a downbeat: the reward is the push, not the '
    'resolution.',
))

NEW.append(pat(
    'AP64', 'Seal Break: Torrent', 'CLIMAX', 5, (5, 3, 2, 5, 5), 4,
    (['SUBDIVISION', 'DRIVING', 'ACCENT'], ['DROP'], ['HIGH', 'PEAK']),
    [
        event(1, 3, [(0, 'LEFT'), (0.5, 'UP'), (1, 'RIGHT'), (1.5, 'DOWN'), (2, 'LEFT'), (2.5, 'UP'), (3, 'RIGHT'), (3.5, 'DOWN')], 5, 1, 'HEAVY'),
        event(3, 3, [(0, 'RIGHT'), (0.5, 'DOWN'), (1, 'LEFT'), (1.5, 'UP'), (2, 'RIGHT'), (2.5, 'DOWN'), (3, 'LEFT'), (3.5, 'UP')], 5, 1, 'HEAVY'),
    ],
    'Eight arrows, one per half-beat: four beats of continuous input and then '
    'the accent on beat four of the next bar. There is no trick in the shape '
    'and that is deliberate -- at 129 BPM a plain eight is already at the edge '
    'of what a hand can do without a break, and the pattern exists to find out '
    'whether a player can keep an even stream going when nothing in the phrase '
    'tells them where they are. One miss forgiven, heavy collapse behind it.',
))

NEW.append(pat(
    'AP65', 'Seal Break: Last Stand', 'BOSS', 5, (5, 5, 3, 5, 5), 8,
    (['SUBDIVISION', 'SYNCOPATED', 'ACCENT', 'DROP'], ['DROP', 'CLIMAX'], ['PEAK']),
    [
        event(1, 3, [(0, 'LEFT'), (0.5, 'UP'), (1, 'RIGHT'), (1.5, 'DOWN'), (2, 'LEFT'), (2.5, 'UP'), (3, 'RIGHT'), (3.5, 'DOWN')], 5, 1, 'HEAVY'),
        event(3, 3, [(0, 'RIGHT'), (0.5, 'DOWN'), (1, 'LEFT'), (1.5, 'UP'), (2, 'RIGHT'), (2.5, 'DOWN'), (2.75, 'RIGHT'), (3, 'LEFT'), (3.25, 'UP')], 5, 1, 'HEAVY'),
        event(5, 3, [(0, 'LEFT'), (0.5, 'RIGHT'), (1, 'UP'), (1.5, 'DOWN'), (2, 'LEFT'), (2.5, 'RIGHT'), (2.75, 'LEFT'), (3, 'UP'), (3.25, 'DOWN')], 5, 1, 'HEAVY'),
        event(7, 1, [(0, 'RIGHT'), (0.5, 'UP'), (1, 'LEFT'), (1.5, 'DOWN'), (2, 'RIGHT')], 3, 1, 'HEAVY'),
    ],
    'Four rounds and thirty-one inputs: an even eight, then two nines that end '
    'in a sixteenth cluster, then a short five that closes on beat four of the '
    'last bar. Each round is a little longer than the last and every accent '
    'still lands where this family puts it for the track, so the phrase '
    'escalates in load without ever moving its resolution. It is the last thing '
    'the level asks for and it ends on the last musical bar of the record.',
))


def main():
    with open(P, encoding='utf8') as fh:
        d = json.load(fh, object_pairs_hook=collections.OrderedDict)
    existing = {p['id'] for p in d['patterns']}
    for p in NEW:
        assert p['id'] not in existing, p['id']
    d['patterns'].extend(NEW)
    with open(P, 'w', encoding='utf8', newline='\n') as fh:
        fh.write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
    print('appended %d patterns; library now %d' % (len(NEW), len(d['patterns'])))


if __name__ == '__main__':
    main()
