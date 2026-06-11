import os
import random
import string
import socket
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, ConnectionRefusedError
import Quartz
import ApplicationServices
from dotenv import load_dotenv

# Force eager loading of PyObjC/Quartz functions and constants to avoid thread race conditions.
# Flask-SocketIO runs event handlers concurrently on separate threads; lazy loading during these 
# handlers causes PyObjC's lazy importer to raise KeyErrors (e.g. KeyError: 'CGEventGetLocation').
_eager_preloads = [
    Quartz.CGEventCreate,
    Quartz.CGEventGetLocation,
    Quartz.CGPoint,
    Quartz.CGEventCreateMouseEvent,
    Quartz.CGEventPost,
    Quartz.CGWarpMouseCursorPosition,
    Quartz.CGEventSetIntegerValueField,
    Quartz.CGEventCreateScrollWheelEvent,
    Quartz.CGEventCreateKeyboardEvent,
    Quartz.kCGEventLeftMouseUp,
    Quartz.kCGMouseButtonLeft,
    Quartz.kCGEventLeftMouseDragged,
    Quartz.kCGHIDEventTap,
    Quartz.kCGEventLeftMouseDown,
    Quartz.kCGMouseEventClickState,
    Quartz.kCGEventRightMouseDown,
    Quartz.kCGMouseButtonRight,
    Quartz.kCGEventRightMouseUp,
    ApplicationServices.AXIsProcessTrusted,
]

# Load optional .env variables
load_dotenv()

app = Flask(__name__)
# Enable Socket.IO with CORS allowed for local network clients
socketio = SocketIO(app, cors_allowed_origins="*")

# Port config
PORT = 8000

# State variable to track if mouse is held down (for dragging)
left_button_down = False

# Screen geometry variables
main_display = Quartz.CGMainDisplayID()
screen_width = Quartz.CGDisplayPixelsWide(main_display)
screen_height = Quartz.CGDisplayPixelsHigh(main_display)

# Determine security PIN / password
ACCESS_PASSWORD = os.getenv('ACCESS_PASSWORD')
if ACCESS_PASSWORD:
    APP_PIN = ACCESS_PASSWORD
    is_custom_password = True
else:
    # Generate random 4-digit numeric PIN
    APP_PIN = "".join(random.choices(string.digits, k=4))
    is_custom_password = False

def get_local_ip():
    """Detects the computer's local network IP address."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Does not need to be reachable or send actual packets
        s.connect(('10.254.254.254', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def get_mouse_pos():
    """Retrieves the current coordinates of the system cursor."""
    event = Quartz.CGEventCreate(None)
    pos = Quartz.CGEventGetLocation(event)
    return pos.x, pos.y

def check_accessibility():
    """Checks if the server process has macOS Accessibility permissions."""
    return ApplicationServices.AXIsProcessTrusted()

def get_public_tunnel_url():
    """Checks if tunnel.conf exists in the workspace and extracts the public URL."""
    conf_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tunnel.conf')
    if not os.path.exists(conf_path):
        return None
    try:
        with open(conf_path, 'r') as f:
            content = f.read()
            import re
            match = re.search(r'https://[a-zA-Z0-9-]+\.tunnel\.pyjam\.as/?', content)
            if match:
                return match.group(0).rstrip('/')
    except Exception as e:
        print(f"Error reading tunnel.conf: {e}")
    return None

# --- Flask Routes ---

@app.route('/')
def index():
    local_ip = get_local_ip()
    # Check if request originated from localhost (meaning the host machine itself)
    is_local = request.remote_addr in ('127.0.0.1', '::1', 'localhost', local_ip)
    trusted = check_accessibility()
    public_url = get_public_tunnel_url()

    return render_template(
        'index.html',
        is_local=is_local,
        pin=APP_PIN if is_local else '',
        local_ip=local_ip,
        port=PORT,
        trusted=trusted,
        public_url=public_url
    )

@app.route('/validate-token')
def validate_token():
    """Endpoint for frontend client to verify token validity before opening WebSocket connection."""
    token = request.args.get('token')
    return jsonify({'valid': token == APP_PIN})

# --- Socket.IO Event Handlers ---

@socketio.on('connect')
def handle_connect(auth=None):
    """
    Validates connection token.
    Token can be passed in 'auth' payload or query string parameter 'token'.
    """
    token = None
    if auth and isinstance(auth, dict):
        token = auth.get('token')
    if not token:
        token = request.args.get('token')

    if token != APP_PIN:
        print(f"Connection rejected: Unauthorized attempt with token '{token}' from {request.remote_addr}")
        raise ConnectionRefusedError('Unauthorized PIN')
        
    print(f"Client connected and authorized: {request.remote_addr}")

@socketio.on('disconnect')
def handle_disconnect():
    """
    Performs cleanup if the mobile client disconnects,
    ensuring the mouse button is released if it was left dragging.
    """
    global left_button_down
    print(f"Client disconnected: {request.remote_addr}")
    if left_button_down:
        print("Safety check: Releasing held left mouse button down state.")
        left_button_down = False
        x, y = get_mouse_pos()
        pos = Quartz.CGPoint(x, y)
        event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, pos, Quartz.kCGMouseButtonLeft)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)

@socketio.on('move')
def handle_move(data):
    """Moves the cursor relative to its current position."""
    global left_button_down
    dx = float(data.get('dx', 0))
    dy = float(data.get('dy', 0))

    x, y = get_mouse_pos()

    # Calculate new coordinates (macOS window server handles multi-monitor clamping natively)
    new_pos = Quartz.CGPoint(x + dx, y + dy)

    # If mouse button is currently held down, generate drag event (requires Accessibility).
    # Otherwise, warp cursor directly (does NOT require Accessibility permissions!).
    if left_button_down:
        move_event = Quartz.CGEventCreateMouseEvent(
            None,
            Quartz.kCGEventLeftMouseDragged,
            new_pos,
            Quartz.kCGMouseButtonLeft
        )
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, move_event)
    else:
        Quartz.CGWarpMouseCursorPosition(new_pos)

@socketio.on('click')
def handle_click(data):
    """Handles mouse click gestures (single click, right click, double click)."""
    button = data.get('button', 'left')
    action = data.get('action', 'click')

    x, y = get_mouse_pos()
    pos = Quartz.CGPoint(x, y)

    if button == 'left':
        if action == 'click':
            # Single Left Click
            down = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, pos, Quartz.kCGMouseButtonLeft)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
            up = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, pos, Quartz.kCGMouseButtonLeft)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)
        elif action == 'double':
            # Double Click
            # Event 1 Down (click state 1)
            d1 = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, pos, Quartz.kCGMouseButtonLeft)
            Quartz.CGEventSetIntegerValueField(d1, Quartz.kCGMouseEventClickState, 1)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, d1)
            # Event 1 Up (click state 1)
            u1 = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, pos, Quartz.kCGMouseButtonLeft)
            Quartz.CGEventSetIntegerValueField(u1, Quartz.kCGMouseEventClickState, 1)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, u1)
            # Event 2 Down (click state 2)
            d2 = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, pos, Quartz.kCGMouseButtonLeft)
            Quartz.CGEventSetIntegerValueField(d2, Quartz.kCGMouseEventClickState, 2)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, d2)
            # Event 2 Up (click state 2)
            u2 = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, pos, Quartz.kCGMouseButtonLeft)
            Quartz.CGEventSetIntegerValueField(u2, Quartz.kCGMouseEventClickState, 2)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, u2)

    elif button == 'right':
        if action == 'click':
            # Right Click
            down = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventRightMouseDown, pos, Quartz.kCGMouseButtonRight)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
            up = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventRightMouseUp, pos, Quartz.kCGMouseButtonRight)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)

@socketio.on('button_state')
def handle_button_state(data):
    """Explicitly holds or releases mouse button state (used for Drag lock toggle)."""
    global left_button_down
    button = data.get('button', 'left')
    state = data.get('state', 'up')

    x, y = get_mouse_pos()
    pos = Quartz.CGPoint(x, y)

    if button == 'left':
        if state == 'down':
            left_button_down = True
            event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, pos, Quartz.kCGMouseButtonLeft)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
        else:
            left_button_down = False
            event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, pos, Quartz.kCGMouseButtonLeft)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)

@socketio.on('scroll')
def handle_scroll(data):
    """Simulates 2D scroll event (vertical and horizontal scroll)."""
    dx = int(data.get('dx', 0))
    dy = int(data.get('dy', 0))

    # 0 = kCGScrollEventUnitLine (line scrolling). Lines scroll is standard and works reliably.
    # Scroll wheel event: Y scroll is wheel1 (4th arg), X scroll is wheel2 (5th arg)
    scroll_event = Quartz.CGEventCreateScrollWheelEvent(None, 0, 2, dy, dx)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, scroll_event)

@socketio.on('key')
def handle_key(data):
    """Simulates physical keyboard presses on macOS (Space, Arrow Keys)."""
    key_name = data.get('key')
    action = data.get('action', 'press')  # 'press', 'down', or 'up'
    
    # macOS Virtual Keycodes mapping
    key_map = {
        'space': 49,
        'left': 123,
        'right': 124,
        'down': 125,
        'up': 126
    }
    
    key_code = key_map.get(key_name)
    if key_code is not None:
        if action == 'press':
            # Fast Tap: send down then up
            down = Quartz.CGEventCreateKeyboardEvent(None, key_code, True)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
            up = Quartz.CGEventCreateKeyboardEvent(None, key_code, False)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)
        elif action == 'down':
            event = Quartz.CGEventCreateKeyboardEvent(None, key_code, True)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
        elif action == 'up':
            event = Quartz.CGEventCreateKeyboardEvent(None, key_code, False)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)

# --- Startup ---

if __name__ == '__main__':
    local_ip = get_local_ip()
    port = PORT
    pub_url = get_public_tunnel_url()

    print("\n" + "=" * 55)
    print("      VIRTUAL TOUCHPAD SERVER RUNNING")
    print("=" * 55)
    if pub_url:
        print(f"Public Tunnel URL:  {pub_url}")
    print(f"Local IP Address:   {local_ip}")
    print(f"Server URL:         http://{local_ip}:{port}")
    if is_custom_password:
        print(f"Access Password:    {APP_PIN} (set from .env)")
    else:
        print(f"Access PIN:         {APP_PIN}")
    print("-" * 55)
    print("Instructions:")
    print(f"1. Open http://localhost:{port} on this computer to view the dashboard.")
    if pub_url:
        print(f"2. Or open the Public Tunnel URL directly on your phone: {pub_url}/?token={APP_PIN}")
    else:
        print("2. Scan the pairing QR code displayed there to pair your phone instantly.")
    print("3. Alternatively, visit the Server URL on your phone browser and enter the Access PIN.")
    print("=" * 55 + "\n")

    socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=True)
