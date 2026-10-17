#!/usr/bin/env python3
"""Bakes the Mixamo car clips (Entering_Car / Driving / Exiting_Car) into src/player/figure/assets/clips.json.
   python3 scripts/locomotion/bake_car_clips.py   (needs numpy + scipy; no three.js)
   Run it AFTER bake_locomotion.py (which keeps the car clips it finds in clips.json).

   Same retarget as bake_locomotion.py (Mixamo local rotations copied bone for bone, hips position scaled to the figure), plus:
   - the ROOT motion is taken out of the pose: the hips horizontal position and the pelvis heading (yaw) are removed from the hips
     track and stored as curves in meta.car.<clip> (x, z, yaw, in the SEAT FRAME). The game places the character with them.
   - SEAT FRAME: origin on the driver's seat (pelvis point), +z = the way the car faces, +x = towards the driver's door (the car's left),
     yaw 0 = facing the car's nose. Entering_Car was authored with the car facing +x, so it is rotated by 90 deg into this frame.
     Exiting_Car and Driving are already in it. The passenger seat is the same thing mirrored (the game flips the character in x).
   - dy: extra vertical offset (m) that lowers the character onto the low BMW seat (the clips were made for a taller car)
   - inside: 0..1, how far the character is inside the car (the game blends ground height -> car floor height with it)
   - events: clip times at which the car door should start opening / closing (hand on the door handle)
"""
import sys, os, json, base64, re
import numpy as np
from scipy.spatial.transform import Rotation as Rot
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fbxconv import clip
from fk import fk, BONES, HIPS_BIND, ASSET_DIR

SRC = os.environ.get('CAR_SRC', os.path.join(HERE, '..', 'character-src', 'car'))
FILES = {'carEnter': 'Entering_Car.fbx', 'carDrive': 'Driving.fbx', 'carExit': 'Exiting_Car.fbx'}
C_Y = 94.02046617
U = HIPS_BIND[1] / C_Y
BIND_XZ = np.array([HIPS_BIND[0], HIPS_BIND[2]])
HIPS_SEAT = 0.47      # pelvis height above the ground once seated (the low BMW seat); the game's cabin is built for it
RECLINE_DEG = float(os.environ.get('RECLINE_DEG', 30.0))     # the seated driver leans back this much (the i8 is a low car: the head would stick out of the roof otherwise)
HEAD_FOLLOW = float(os.environ.get('HEAD_FOLLOW', 0.7))     # how much of the lean the head follows (1 = head tilts back with the torso, 0 = stays upright)
LATERAL_SHIFT = 0.12  # m: the clips' door handle is 12 cm further out than the BMW's door skin; the character stands that much closer
q5 = lambda x: float(np.round(x, 5))
bone_key = lambda k: re.sub(r'[\[\].:/]', '', BONES[k]['name'])


def sm(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def load(name):
    t, tr, _ = clip(os.path.join(SRC, FILES[name]))
    q = {k: v['q'].copy() for k, v in tr.items() if k in BONES}
    p = (tr['hips']['p'] - np.array([0, C_Y, 0])) * U + HIPS_BIND
    return t, q, p


def heading(W):
    """pelvis heading (rad, 0 = facing +z, + towards +x), unwrapped: from the line between the upper legs"""
    L = W['leftupleg'] - W['rightupleg']
    f = np.cross(L, [0, 1, 0])
    return np.unwrap(np.arctan2(f[:, 0], f[:, 2]))


def ry(psi, v):
    """rotate (x,z) pairs by heading psi (rotation about +y): forward (0,1) -> (sin, cos)"""
    c, s = np.cos(psi), np.sin(psi)
    return np.stack([v[..., 0] * c + v[..., 1] * s, -v[..., 0] * s + v[..., 1] * c], -1)


def split_root(name):
    t, q, p = load(name)
    W, _ = fk(q, p)
    psi = heading(W)
    R = Rot.from_rotvec(np.stack([np.zeros_like(psi), -psi, np.zeros_like(psi)], 1))
    q2 = dict(q)
    q2['hips'] = (R * Rot.from_quat(q['hips'])).as_quat()
    # root = hips ground position minus the (rotated) bind offset, so the pose keeps the figure's own hips offset
    root = p[:, [0, 2]] - ry(psi, np.tile(BIND_XZ, (len(t), 1)))
    p2 = np.tile(HIPS_BIND, (len(t), 1))
    p2[:, 1] = p[:, 1]
    return t, q, p, q2, p2, root, psi


def recline(q2, p2, w):
    """Leans the torso back by RECLINE_DEG * w (per frame, w in 0..1) about the pelvis' sideways axis, in the heading-free pose.
    Everything above the spine follows by itself; the upper arms are put back to their original WORLD orientation so the forearms and
    hands keep pointing at the wheel (they just move back with the shoulders); the head follows HEAD_FOLLOW of the lean."""
    th = np.radians(RECLINE_DEG) * np.asarray(w)
    n = len(th)
    Rx = lambda a: Rot.from_rotvec(np.stack([a, np.zeros(n), np.zeros(n)], 1))   # + = lean forward (y -> +z), so back = -a
    W0, WQ0 = fk(q2, p2)
    q = dict(q2)
    spine_w = Rx(-th) * WQ0['spine']
    q['spine'] = (WQ0['hips'].inv() * spine_w).as_quat()
    _, WQ1 = fk(q, p2)
    for arm in ('leftarm', 'rightarm'):
        q[arm] = (WQ1[BONES[arm]['parent']].inv() * WQ0[arm]).as_quat()
    head_w = Rx(-th * HEAD_FOLLOW) * WQ0['head']
    q['head'] = (WQ1['neck'].inv() * head_w).as_quat()
    return q


def pack(t, q, p):
    out = {'duration': q5(t[-1]), 'times': [q5(x) for x in t], 'q': {}, 'p': {}}
    for k, a in q.items():
        a = a / np.linalg.norm(a, axis=1, keepdims=True)
        for i in range(1, len(a)):
            if np.dot(a[i], a[i - 1]) < 0:
                a[i] = -a[i]
        out['q'][bone_key(k)] = base64.b64encode(np.round(a * 32767).astype('<i2').tobytes()).decode()
    out['p'][bone_key('hips')] = [float(np.round(x, 4)) for x in p.reshape(-1)]
    return out


J = json.load(open(os.path.join(ASSET_DIR, 'clips.json')))
data = {n: split_root(n) for n in FILES}

# ---- seat frame ---------------------------------------------------------------------------------------------------------------
tD, _, pD, _, _, rootD, psiD = data['carDrive']
seat_root = rootD[0]
seat_yaw = psiD[0]
tE, _, pE, _, _, rootE, psiE = data['carEnter']
# Entering_Car: car faces +x in the clip; seat frame x' = -z, z' = x (and heading - 90 deg). Offset so the clip ends on the seat.
M = lambda r: np.stack([-r[:, 1], r[:, 0]], 1)
off = seat_root - M(rootE)[-1]
rootE_S = M(rootE) + off
psiE_S = psiE - np.pi / 2
tX, _, pX, _, _, rootX, psiX = data['carExit']
rootX_S = rootX.copy()
psiX_S = psiX.copy()

curves = {}
def curve(name, t, root, psi, py, dy, inside, events):
    n = len(t)
    return {
        'dur': q5(t[-1]), 't': [q5(x) for x in t],
        'x': [round(float(x), 4) for x in root[:, 0]], 'z': [round(float(x), 4) for x in root[:, 1]],
        'yaw': [round(float(x), 4) for x in psi],
        'dy': [round(float(x), 4) for x in dy], 'inside': [round(float(x), 3) for x in inside],
        'events': events,
    }

# Entering: stands close to the door at first, drops onto the low seat while swinging the legs in
shE = LATERAL_SHIFT * (1 - sm(tE, 2.0, 3.2))
rE = rootE_S.copy(); rE[:, 0] -= shE
dyE = (HIPS_SEAT - pE[-1, 1]) * sm(tE, 3.1, 3.8)
curves['carEnter'] = curve('carEnter', tE, rE, psiE_S, pE[:, 1], dyE, sm(tE, 2.7, 3.4), {'doorOpen': 0.95, 'doorClose': 3.55})
# Driving: still, a fixed seat
dyD = np.full(len(tD), HIPS_SEAT - pD[0, 1])
curves['carDrive'] = curve('carDrive', tD, np.tile(seat_root, (len(tD), 1)), np.full(len(tD), seat_yaw), pD[:, 1], dyD, np.ones(len(tD)), {})
# Exiting: rises off the seat while stepping out, ends standing close to the door
shX = LATERAL_SHIFT * sm(tX, 1.8, 3.0)
rX = rootX_S.copy(); rX[:, 0] -= shX
dyX = (HIPS_SEAT - pX[0, 1]) * (1 - sm(tX, 1.5, 2.3))
curves['carExit'] = curve('carExit', tX, rX, psiX_S, pX[:, 1], dyX, 1 - sm(tX, 1.8, 2.6), {'doorOpen': 0.45, 'doorClose': 3.55})

# lean back: full in the Driving clip, eased in once the Entering clip has shut the door, eased out as the Exiting clip starts
recl_w = {'carEnter': sm(tE, 4.1, 5.0), 'carDrive': np.ones(len(tD)), 'carExit': 1 - sm(tX, 0.0, 0.5)}
reclined = {}
for n in FILES:
    t, q, p, q2, p2, root, psi = data[n]
    reclined[n] = recline(q2, p2, recl_w[n])

clips = J['clips']
for n in FILES:
    t, q, p, q2, p2, root, psi = data[n]
    clips[n] = pack(t, reclined[n], p2)
# where the hands end up on the Driving pose (seat frame, y above the ground): the steering wheel goes there
tD_, _, pD_, q2D, p2D, _, _ = data['carDrive']
WD, _ = fk(reclined['carDrive'], p2D)
dyDrive = curves['carDrive']['dy'][0]
hl, hr = WD['lefthand'][0], WD['righthand'][0]
wheel = {'x': round(float((hl[0] + hr[0]) / 2), 3), 'y': round(float((hl[1] + hr[1]) / 2 + dyDrive), 3), 'z': round(float((hl[2] + hr[2]) / 2), 3),
         'span': round(float(np.linalg.norm(hl - hr)), 3)}
head_top = float(WD['headtopend'][:, 1].max() + dyDrive)
hip_y = float(p2D[0, 1] + dyDrive)
print('DRIVE pose  wheel (seat frame):', wheel, ' head top above ground: %.3f m (pelvis %.2f)' % (head_top, hip_y),
      ' head top z: %.3f' % float(WD['headtopend'][0, 2]), ' knee/foot z:', WD['leftfoot'][0].round(2), WD['rightfoot'][0].round(2))
J['meta'].setdefault('car', {})
J['meta']['car'] = {
    'clips': curves,
    # seat frame -> car frame (metres, car origin under the middle of the wheelbase, +x = the car's left): set in vehicles/CarSeat.ts
    'hipsSeat': HIPS_SEAT, 'lateralShift': LATERAL_SHIFT, 'wheel': wheel, 'headTop': round(head_top, 3), 'reclineDeg': RECLINE_DEG,
}
json.dump(J, open(os.path.join(ASSET_DIR, 'clips.json'), 'w'), separators=(',', ':'))
print('clips.json', os.path.getsize(os.path.join(ASSET_DIR, 'clips.json')), 'bytes')

# ---- verification: pose' + root must rebuild the original motion exactly -------------------------------------------------------
for n in FILES:
    t, q, p, q2, p2, root, psi = data[n]
    W0, _ = fk(q, p)
    W1, _ = fk(q2, p2)
    c, s = np.cos(psi), np.sin(psi)
    err = 0
    for k in ('hips', 'head', 'lefthand', 'righthand', 'leftfoot', 'rightfoot'):
        w = W1[k]
        x = w[:, 0] * c + w[:, 2] * s + root[:, 0]
        z = -w[:, 0] * s + w[:, 2] * c + root[:, 1]
        err = max(err, np.abs(x - W0[k][:, 0]).max(), np.abs(z - W0[k][:, 2]).max(), np.abs(w[:, 1] - W0[k][:, 1]).max())
    c0 = curves[n]
    print(f'{n:9s} {t[-1]:5.2f}s {len(t):3d} keys  rebuild error {err:.2e} m  root x[{min(c0["x"]):.2f},{max(c0["x"]):.2f}] z[{min(c0["z"]):.2f},{max(c0["z"]):.2f}]  '
          f'yaw {np.degrees(c0["yaw"][0]):.0f}..{np.degrees(c0["yaw"][-1]):.0f}  dy {min(c0["dy"]):.2f}..{max(c0["dy"]):.2f}')
print('seat frame offset for Entering', off.round(3), 'seat root', seat_root.round(3), 'seat yaw deg', round(float(np.degrees(seat_yaw)), 1))
