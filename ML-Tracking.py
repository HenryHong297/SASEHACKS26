"""
Focus tracker: webcam -> focused / unfocused, with a rolling focus score.

Uses MediaPipe's Face Landmarker (Tasks API, pretrained neural net) to find
face landmarks, then estimates head yaw/pitch. "Focused" = face visible and
head pointed at the screen.

Note: this uses the Tasks API (mediapipe.tasks.python.vision), not the older
mediapipe.solutions.face_mesh - that legacy API isn't shipped for newer Python
versions (e.g. no mediapipe.solutions on Python 3.14 at time of writing). The
Tasks API's landmarks are drop-in compatible (.x/.y in the same normalized
0..1 range), so head_pose() below needed no changes.

Setup:  pip install -r requirements.txt
Run:    python ML-Tracking.py
Keys:   'r' = recalibrate, 'q' = quit

First run downloads face_landmarker.task (~4MB) from Google's official
MediaPipe model bucket and caches it next to this script.

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

Integration with the Controlled Charge web game:
  This script also serves its live focus state on a local HTTP endpoint
  (http://localhost:<port>/focus) so the browser test client can poll it and
  forward real focus/unfocus events into the game over the same socket it
  already uses for the manual toggle - no server changes needed. See
  FocusStateServer below and public/client.js's pollLocalTracker().
"""

import argparse
import json
import os
import threading
import time
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

FACE_LANDMARKER_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/latest/face_landmarker.task"
)
FACE_LANDMARKER_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "face_landmarker.task")


def ensure_face_landmarker_model(path=FACE_LANDMARKER_MODEL_PATH, url=FACE_LANDMARKER_MODEL_URL):
    if not os.path.exists(path):
        print(f"downloading face landmarker model to {path} ...")
        urllib.request.urlretrieve(url, path)
    return path


class FocusState:
    """Thread-safe holder for the latest focus reading, shared with the HTTP server."""

    def __init__(self):
        self._lock = threading.Lock()
        self._data = {"focused": True, "focusScore": 1.0, "distractions": 0, "calibrating": True, "error": None}

    def update(self, **kwargs):
        with self._lock:
            self._data.update(kwargs)

    def snapshot(self):
        with self._lock:
            return dict(self._data)


class FocusStateHTTPHandler(BaseHTTPRequestHandler):
    def _cors_headers(self):
        # Chrome/Edge's Private Network Access policy blocks a public https
        # page (e.g. the ngrok tunnel url) from reaching into localhost
        # unless the local server explicitly opts in with this header - on
        # both the preflight and the real response.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path != "/focus":
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(self.server.focus_state.snapshot()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self._cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # keep the console clean, the cv2 overlay already shows status


def start_focus_state_server(focus_state, port):
    server = ThreadingHTTPServer(("127.0.0.1", port), FocusStateHTTPHandler)
    server.focus_state = focus_state
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server

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
    # imported here so the math above is testable without mediapipe/cv2 installed
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

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
    ap.add_argument("--port", type=int, default=8765, help="local HTTP port that serves /focus for the web game")
    args = ap.parse_args()

    focus_state = FocusState()
    start_focus_state_server(focus_state, args.port)
    print(f"serving live focus state on http://localhost:{args.port}/focus")

    model_path = ensure_face_landmarker_model()
    landmarker = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    )
    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened() or not cap.read()[0]:
        raise SystemExit(
            f"Could not open camera {args.camera} (opened={cap.isOpened()}).\n"
            "Most webcams only allow ONE application to use them at a time - this usually means\n"
            "something else already has it open: a browser tab with the game's camera preview\n"
            "active, Discord/Teams/Zoom running in the background, or the Windows Camera app.\n"
            "Close/pause those (or refresh the browser tab after starting this script) and try again."
        )
    video_start = time.time()
    consecutive_read_failures = 0

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
            consecutive_read_failures += 1
            focus_state.update(error=f"camera read failed ({consecutive_read_failures}x in a row)")
            print(f"[warn] camera read failed ({consecutive_read_failures}x) - is another app using it?")
            if consecutive_read_failures >= 100:  # ~a few seconds at typical frame rates
                raise SystemExit(
                    "Camera stopped delivering frames. Something else likely grabbed it "
                    "(browser tab, Discord/Teams/Zoom, Camera app) - close that and rerun."
                )
            time.sleep(0.05)
            continue
        consecutive_read_failures = 0
        h, w = frame.shape[:2]
        now = time.time()

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp_ms = int((now - video_start) * 1000)
        res = landmarker.detect_for_video(mp_image, timestamp_ms)
        pose = None
        if res.face_landmarks:
            pose = head_pose(res.face_landmarks[0], w, h)

        # ---- calibration phase ----
        if calib["base"] is None:
            elapsed = now - calib["start"]
            if pose:
                calib["yaw"].append(pose[0])
                calib["pitch"].append(pose[1])
            cv2.putText(frame, f"CALIBRATING: look at your screen ({max(0, args.calib - elapsed):.0f}s)",
                        (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
            focus_state.update(calibrating=True, error=None)
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
        focus_state.update(
            focused=focused, focusScore=focus_score, distractions=distractions, calibrating=False, error=None
        )

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
    landmarker.close()
    if total_frames:
        print(f"\nSession: {(time.time() - session_start) / 60:.1f} min, "
              f"overall focus {focused_frames / total_frames:.0%}, distractions {distractions}")


if __name__ == "__main__":
    main()