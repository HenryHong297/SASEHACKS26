"""
Focus tracker: webcam -> focused / unfocused, with a rolling focus score.

Uses MediaPipe Face Mesh (pretrained neural net) to find face landmarks, then
estimates head yaw/pitch. "Focused" = face visible and head pointed at the screen.

Setup:  pip install mediapipe opencv-python numpy
Run:    python focus_tracker.py
Keys:   'r' = recalibrate, 'q' = quit

How it works:
  1. Calibration (first few seconds): look at your screen normally. Your head
     angle then becomes "looking at screen" for you.
  2. Each frame: if head angle is within tolerance of that baseline -> attentive.
  3. Looking away only counts as a distraction after --grace seconds, so quick
     glances don't hurt you.
  4. Focus score = % of the last --window seconds (default 300 = 5 min) you
     were not in a distraction.
  5. Flags fire when you've been away >= --away-flag seconds in a row, or when
     your window focus score drops below --min-focus.
"""

import argparse
import time
from collections import deque

import cv2
import numpy as np

# MediaPipe Face Mesh landmark ids: nose tip, chin, eye outer corners, mouth corners
LM_IDS = [1, 152, 33, 263, 61, 291]

# Generic 3D face model (mm). Camera-style axes: x right, y down, z away from camera.
MODEL_POINTS = np.array([
    (0.0, 0.0, 0.0),       # nose tip
    (0.0, 63.6, 12.5),     # chin
    (-43.3, -32.7, 26.0),  # eye outer corner (image-left)
    (43.3, -32.7, 26.0),   # eye outer corner (image-right)
    (-28.9, 28.9, 24.1),   # mouth corner (image-left)
    (28.9, 28.9, 24.1),    # mouth corner (image-right)
], dtype=np.float64)


def head_pose_from_points(img_pts, w, h):
    """img_pts: 6x2 pixel coords in LM_IDS order. Returns (yaw, pitch) in degrees."""
    cam = np.array([[w, 0, w / 2], [0, w, h / 2], [0, 0, 1]], dtype=np.float64)
    ok, rvec, _ = cv2.solvePnP(MODEL_POINTS, img_pts, cam, np.zeros((4, 1)),
                               flags=cv2.SOLVEPNP_ITERATIVE)
    if not ok:
        return None
    rmat, _ = cv2.Rodrigues(rvec)
    angles = cv2.RQDecomp3x3(rmat)[0]  # degrees about x, y, z
    pitch, yaw = float(angles[0]), float(angles[1])
    return yaw, pitch


def head_pose(landmarks, w, h):
    pts = np.array([(landmarks[i].x * w, landmarks[i].y * h) for i in LM_IDS], dtype=np.float64)
    return head_pose_from_points(pts, w, h)


def on_flag(reason):
    """Hook your game logic in here (e.g. damage the ship)."""
    print(f"[FLAG] {time.strftime('%H:%M:%S')} - {reason}")


def main():
    import mediapipe as mp  # imported here so the math above is testable without it

    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--window", type=float, default=300, help="rolling window in seconds (300 = 5 min)")
    ap.add_argument("--grace", type=float, default=3, help="seconds looking away before it counts as a distraction")
    ap.add_argument("--away-flag", type=float, default=15, help="flag if continuously away this many seconds")
    ap.add_argument("--min-focus", type=float, default=0.70, help="flag if window focus score drops below this")
    ap.add_argument("--min-data", type=float, default=60, help="seconds of data needed before score-based flags")
    ap.add_argument("--yaw-tol", type=float, default=25, help="degrees left/right from baseline")
    ap.add_argument("--pitch-tol", type=float, default=20, help="degrees up/down from baseline")
    ap.add_argument("--calib", type=float, default=3, help="calibration seconds")
    ap.add_argument("--flag-cooldown", type=float, default=30)
    args = ap.parse_args()

    face_mesh = mp.solutions.face_mesh.FaceMesh(
        max_num_faces=1, min_detection_confidence=0.5, min_tracking_confidence=0.5)
    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit(f"Could not open camera {args.camera}")

    def reset_calibration():
        return {"start": time.time(), "yaw": [], "pitch": [], "base": None}

    calib = reset_calibration()
    samples = deque()  # (timestamp, focused_bool)
    session_start = time.time()
    away_since = None
    in_distraction = False
    distractions = 0
    last_flag = 0.0
    total_frames = focused_frames = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        h, w = frame.shape[:2]
        now = time.time()

        res = face_mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        pose = None
        if res.multi_face_landmarks:
            pose = head_pose(res.multi_face_landmarks[0].landmark, w, h)

        # ---- calibration phase ----
        if calib["base"] is None:
            elapsed = now - calib["start"]
            if pose:
                calib["yaw"].append(pose[0])
                calib["pitch"].append(pose[1])
            cv2.putText(frame, f"CALIBRATING: look at your screen ({max(0, args.calib - elapsed):.0f}s)",
                        (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
            if elapsed >= args.calib and len(calib["yaw"]) > 10:
                calib["base"] = (float(np.median(calib["yaw"])), float(np.median(calib["pitch"])))
                session_start = now
                samples.clear()
                away_since, in_distraction = None, False
            cv2.imshow("focus tracker", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
            continue

        # ---- per-frame attention check ----
        base_yaw, base_pitch = calib["base"]
        if pose is None:
            attentive = False  # no face in frame counts as away
            yaw_d = pitch_d = None
        else:
            yaw_d, pitch_d = pose[0] - base_yaw, pose[1] - base_pitch
            attentive = abs(yaw_d) < args.yaw_tol and abs(pitch_d) < args.pitch_tol

        # ---- grace period + distraction events ----
        if attentive:
            away_since = None
            in_distraction = False
        else:
            if away_since is None:
                away_since = now
            if now - away_since >= args.grace and not in_distraction:
                in_distraction = True
                distractions += 1
        away_for = 0.0 if away_since is None else now - away_since

        # ---- rolling window ----
        focused = not in_distraction
        samples.append((now, focused))
        while samples and now - samples[0][0] > args.window:
            samples.popleft()
        focus_score = sum(f for _, f in samples) / len(samples)
        data_secs = samples[-1][0] - samples[0][0]
        total_frames += 1
        focused_frames += focused

        # ---- flags ----
        if now - last_flag > args.flag_cooldown:
            if away_for >= args.away_flag:
                last_flag = now
                on_flag(f"away for {away_for:.0f}s straight")
            elif data_secs >= args.min_data and focus_score < args.min_focus:
                last_flag = now
                on_flag(f"focus score {focus_score:.0%} over last {data_secs / 60:.1f} min")

        # ---- overlay ----
        color = (0, 200, 0) if focused else (0, 0, 255)
        cv2.putText(frame, "FOCUSED" if focused else "UNFOCUSED", (10, 35),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
        cv2.putText(frame, f"focus (last {min(data_secs, args.window) / 60:.1f} min): {focus_score:.0%}",
                    (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(frame, f"distractions: {distractions}", (10, 100),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        if yaw_d is not None:
            cv2.putText(frame, f"yaw {yaw_d:+.0f}  pitch {pitch_d:+.0f}", (10, h - 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
        cv2.imshow("focus tracker", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        if key == ord("r"):
            calib = reset_calibration()

    cap.release()
    cv2.destroyAllWindows()
    if total_frames:
        print(f"\nSession: {(time.time() - session_start) / 60:.1f} min, "
              f"overall focus {focused_frames / total_frames:.0%}, distractions {distractions}")


if __name__ == "__main__":
    main()