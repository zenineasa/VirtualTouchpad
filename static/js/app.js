document.addEventListener('DOMContentLoaded', () => {
    const pin = document.body.dataset.pin;
    const ip = document.body.dataset.ip;
    const port = document.body.dataset.port;
    const publicUrl = document.body.dataset.publicUrl;
    
    // Sensitivity configurations (persist in localStorage)
    let pointerSensitivity = parseFloat(localStorage.getItem('pointer_sens') || '1.2');
    let scrollSensitivity = parseFloat(localStorage.getItem('scroll_sens') || '1.0');

    // ==================== DESKTOP PAIRING DASHBOARD ====================
    
    // Generate QR code if on desktop
    const qrcodeContainer = document.getElementById("qrcode");
    if (document.body.classList.contains('local-device') && qrcodeContainer && pin) {
        const pairingUrl = publicUrl ? `${publicUrl}/?token=${pin}` : `http://${ip}:${port}/?token=${pin}`;
        new QRCode(qrcodeContainer, {
            text: pairingUrl,
            width: 180,
            height: 180,
            colorDark : "#020204",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    }

    // Connect manual testing button on desktop
    const btnTestMode = document.getElementById('btn-test-mode');
    if (btnTestMode) {
        btnTestMode.addEventListener('click', () => {
            document.body.classList.add('test-mode');
            // Store token for local device test
            localStorage.setItem('auth_token', pin);
            initApp(pin);
        });
    }

    // ==================== AUTHENTICATION LOGIC ====================

    // 1. Check if token is in URL (Auto-login from QR Code scan)
    const urlParams = new URLSearchParams(window.location.search);
    let token = urlParams.get('token');
    
    if (token) {
        // Clean URL to keep it clean, but keep token in localStorage
        localStorage.setItem('auth_token', token);
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
        initApp(token);
    } else {
        // 2. Fallback to stored token
        const savedToken = localStorage.getItem('auth_token');
        if (savedToken) {
            initApp(savedToken);
        } else {
            // Show login screen
            showSubview('login-overlay');
        }
    }

    // Handle manual login form
    const btnLogin = document.getElementById('btn-login');
    const pinInput = document.getElementById('pin-input');
    const loginError = document.getElementById('login-error');

    if (btnLogin && pinInput) {
        const attemptLogin = async () => {
            const enteredPin = pinInput.value.trim();
            if (!enteredPin) return;
            
            btnLogin.disabled = true;
            loginError.textContent = '';
            
            try {
                const res = await fetch(`/validate-token?token=${encodeURIComponent(enteredPin)}`);
                const data = await res.json();
                
                if (data.valid) {
                    localStorage.setItem('auth_token', enteredPin);
                    initApp(enteredPin);
                } else {
                    loginError.textContent = 'Invalid Access PIN. Please try again.';
                    pinInput.value = '';
                    pinInput.focus();
                }
            } catch (err) {
                loginError.textContent = 'Server connection failed.';
            } finally {
                btnLogin.disabled = false;
            }
        };

        btnLogin.addEventListener('click', attemptLogin);
        pinInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') attemptLogin();
        });
    }

    // Toggle views
    function showSubview(viewId) {
        document.querySelectorAll('.mobile-subview').forEach(view => {
            view.classList.remove('active');
        });
        const targetView = document.getElementById(viewId);
        if (targetView) targetView.classList.add('active');
    }

    // ==================== MAIN APPLICATION ROUTINE ====================

    function initApp(authToken) {
        showSubview('app-container');
        
        // Connect Socket.IO with token in connection auth payload
        const socket = io({
            auth: { token: authToken },
            reconnectionAttempts: 5,
            timeout: 5000
        });

        const statusIndicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');

        // Socket Status Handlers
        socket.on('connect', () => {
            statusIndicator.className = 'connected';
            statusText.textContent = 'Connected';
        });

        socket.on('disconnect', () => {
            statusIndicator.className = 'disconnected';
            statusText.textContent = 'Disconnected. Reconnecting...';
        });

        socket.on('connect_error', (err) => {
            statusIndicator.className = 'disconnected';
            // Only wipe the token and show the login overlay if the server explicitly rejected the PIN.
            if (err && err.message === 'Unauthorized PIN') {
                statusText.textContent = 'Auth Failed';
                localStorage.removeItem('auth_token');
                showSubview('login-overlay');
                if (loginError) loginError.textContent = 'Session expired or invalid token.';
            } else {
                statusText.textContent = 'Connection lost. Reconnecting...';
                // Do NOT redirect to login or clear token. Socket.IO's built-in reconnection 
                // will automatically restore the trackpad session as soon as the phone wakes up.
            }
        });

        // Haptic Feedback Helper
        function triggerHaptic() {
            if (navigator.vibrate) {
                navigator.vibrate(15); // Short, crisp 15ms tap
            }
        }

        // ==================== TOUCHPAD GESTURES & EVENTS ====================

        const trackpad = document.getElementById('trackpad');
        const trackpadInstruction = document.querySelector('.trackpad-instruction');
        
        let lastTouchX = 0;
        let lastTouchY = 0;
        let startTouchX = 0;
        let startTouchY = 0;
        let isMoving = false;
        let isScrolling = false;
        
        let touchCount = 0;
        let touchStartTime = 0;
        let lastTapTime = 0;
        
        const touchIndicators = {};

        // Helper to spawn interactive glowing points on touch
        function createTouchIndicator(id, x, y) {
            const pointer = document.createElement('div');
            pointer.className = 'touch-pointer';
            pointer.id = `touch-${id}`;
            pointer.style.left = `${x}px`;
            pointer.style.top = `${y}px`;
            trackpad.appendChild(pointer);
            touchIndicators[id] = pointer;
        }

        function updateTouchIndicator(id, x, y) {
            const pointer = touchIndicators[id];
            if (pointer) {
                pointer.style.left = `${x}px`;
                pointer.style.top = `${y}px`;
            }
        }

        function removeTouchIndicator(id) {
            const pointer = touchIndicators[id];
            if (pointer) {
                pointer.style.opacity = '0';
                pointer.style.transform = 'translate(-50%, -50%) scale(0.3)';
                setTimeout(() => {
                    if (pointer.parentNode) {
                        pointer.parentNode.removeChild(pointer);
                    }
                }, 150);
                delete touchIndicators[id];
            }
        }

        // Touch event handlers
        trackpad.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchCount = e.touches.length;
            touchStartTime = Date.now();
            
            // Hide instructions on touch
            if (trackpadInstruction) trackpadInstruction.classList.add('hide');
            
            // Spawning visual indicators and setup coordinate baselines
            if (touchCount === 1) {
                startTouchX = e.touches[0].clientX;
                startTouchY = e.touches[0].clientY;
                lastTouchX = startTouchX;
                lastTouchY = startTouchY;
                isMoving = true;
                isScrolling = false;
                
                createTouchIndicator(e.touches[0].identifier, startTouchX, startTouchY);
            } else if (touchCount === 2) {
                const avgX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                startTouchX = avgX;
                startTouchY = avgY;
                lastTouchX = avgX;
                lastTouchY = avgY;
                isMoving = false;
                isScrolling = true;
                
                createTouchIndicator(e.touches[0].identifier, e.touches[0].clientX, e.touches[0].clientY);
                createTouchIndicator(e.touches[1].identifier, e.touches[1].clientX, e.touches[1].clientY);
            }
        }, { passive: false });

        trackpad.addEventListener('touchmove', (e) => {
            e.preventDefault();
            
            // Move visual indicators
            for (let i = 0; i < e.touches.length; i++) {
                updateTouchIndicator(e.touches[i].identifier, e.touches[i].clientX, e.touches[i].clientY);
            }
            
            if (e.touches.length === 1 && isMoving) {
                const clientX = e.touches[0].clientX;
                const clientY = e.touches[0].clientY;
                
                // Calculate pointer delta scaled by sensitivity
                const dx = (clientX - lastTouchX) * pointerSensitivity;
                const dy = (clientY - lastTouchY) * pointerSensitivity;
                
                socket.emit('move', { dx: dx, dy: dy });
                
                lastTouchX = clientX;
                lastTouchY = clientY;
            } else if (e.touches.length === 2 && isScrolling) {
                const avgX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                
                // Calculate scroll amount (inverted for natural scrolling feel)
                const scrollX = (lastTouchX - avgX) * scrollSensitivity * 0.2;
                const scrollY = (lastTouchY - avgY) * scrollSensitivity * 0.2;
                
                if (Math.abs(scrollX) > 0.1 || Math.abs(scrollY) > 0.1) {
                    socket.emit('scroll', { dx: scrollX, dy: scrollY });
                    lastTouchX = avgX;
                    lastTouchY = avgY;
                }
            }
        }, { passive: false });

        trackpad.addEventListener('touchend', (e) => {
            e.preventDefault();
            
            // Remove active pointers that just ended
            for (let i = 0; i < e.changedTouches.length; i++) {
                removeTouchIndicator(e.changedTouches[i].identifier);
            }
            
            const duration = Date.now() - touchStartTime;
            const clickMovementThreshold = 10; // Pixels
            
            if (touchCount === 1) {
                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const dist = Math.hypot(endX - startTouchX, endY - startTouchY);
                
                // If duration is brief and pointer barely moved, count as Tap (Left Click)
                if (dist < clickMovementThreshold && duration < 250) {
                    const now = Date.now();
                    if (now - lastTapTime < 300) {
                        // Double Tap -> Double Click
                        triggerHaptic();
                        socket.emit('click', { button: 'left', action: 'double' });
                        lastTapTime = 0;
                    } else {
                        // Single Tap -> Single Left Click
                        triggerHaptic();
                        socket.emit('click', { button: 'left', action: 'click' });
                        lastTapTime = now;
                    }
                }
            } else if (touchCount === 2 && duration < 250) {
                // Two finger quick tap -> Right Click
                triggerHaptic();
                socket.emit('click', { button: 'right', action: 'click' });
            }
            
            isMoving = false;
            isScrolling = false;
            touchCount = e.touches.length;
        }, { passive: false });

        trackpad.addEventListener('touchcancel', (e) => {
            // Cleanup all visual fingers if cancelled
            for (let i = 0; i < e.changedTouches.length; i++) {
                removeTouchIndicator(e.changedTouches[i].identifier);
            }
            isMoving = false;
            isScrolling = false;
            touchCount = 0;
        });

        // ==================== MANUAL PHYSICAL BUTTON EVENTS ====================

        const btnLeft = document.getElementById('btn-left-click');
        const btnRight = document.getElementById('btn-right-click');
        const btnDrag = document.getElementById('btn-drag-lock');
        
        let dragLockActive = false;

        // Use touch events for zero-delay response on mobile
        if (btnLeft) {
            btnLeft.addEventListener('touchstart', (e) => {
                e.preventDefault();
                triggerHaptic();
                socket.emit('click', { button: 'left', action: 'click' });
            });
        }
        
        if (btnRight) {
            btnRight.addEventListener('touchstart', (e) => {
                e.preventDefault();
                triggerHaptic();
                socket.emit('click', { button: 'right', action: 'click' });
            });
        }

        if (btnDrag) {
            const toggleDragLock = () => {
                dragLockActive = !dragLockActive;
                triggerHaptic();
                
                if (dragLockActive) {
                    btnDrag.classList.add('active');
                    btnDrag.querySelector('.material-symbols-outlined').textContent = 'lock';
                    socket.emit('button_state', { button: 'left', state: 'down' });
                } else {
                    btnDrag.classList.remove('active');
                    btnDrag.querySelector('.material-symbols-outlined').textContent = 'lock_open';
                    socket.emit('button_state', { button: 'left', state: 'up' });
                }
            };
            btnDrag.addEventListener('touchstart', (e) => {
                e.preventDefault();
                toggleDragLock();
            });
        }

        // ==================== VIEW MODES & KEYBOARD REMOTE ====================

        const btnToggleRemote = document.getElementById('btn-toggle-remote');
        const trackpadContainer = document.getElementById('trackpad-view-container');
        const remoteContainer = document.getElementById('remote-view-container');
        const toggleIcon = document.getElementById('toggle-icon');
        
        let currentMode = 'trackpad'; // 'trackpad' or 'remote'
        
        if (btnToggleRemote && trackpadContainer && remoteContainer && toggleIcon) {
            btnToggleRemote.addEventListener('click', () => {
                triggerHaptic();
                if (currentMode === 'trackpad') {
                    currentMode = 'remote';
                    trackpadContainer.classList.remove('active');
                    remoteContainer.classList.add('active');
                    toggleIcon.textContent = 'mouse'; // Icon to switch back to mouse
                } else {
                    currentMode = 'trackpad';
                    remoteContainer.classList.remove('active');
                    trackpadContainer.classList.add('active');
                    toggleIcon.textContent = 'keyboard'; // Icon to switch to keyboard remote
                }
            });
        }
        
        // Handle D-pad and Spacebar buttons
        document.querySelectorAll('.remote-key').forEach(button => {
            const key = button.dataset.key;
            if (!key) return;
            
            button.addEventListener('touchstart', (e) => {
                e.preventDefault();
                triggerHaptic();
                socket.emit('key', { key: key, action: 'down' });
            });
            
            button.addEventListener('touchend', (e) => {
                e.preventDefault();
                socket.emit('key', { key: key, action: 'up' });
            });
            
            button.addEventListener('touchcancel', (e) => {
                e.preventDefault();
                socket.emit('key', { key: key, action: 'up' });
            });
            
            // Fallback for mouse click events (for testing in desktop browser)
            button.addEventListener('mousedown', (e) => {
                e.preventDefault();
                triggerHaptic();
                socket.emit('key', { key: key, action: 'down' });
            });
            
            button.addEventListener('mouseup', (e) => {
                e.preventDefault();
                socket.emit('key', { key: key, action: 'up' });
            });
            
            button.addEventListener('mouseleave', (e) => {
                e.preventDefault();
                socket.emit('key', { key: key, action: 'up' });
            });
        });

        // ==================== SETTINGS DRAWER CONTROLS ====================

        const btnSettings = document.getElementById('btn-settings');
        const btnCloseSettings = document.getElementById('btn-close-settings');
        const settingsDrawer = document.getElementById('settings-drawer');
        const drawerOverlay = document.getElementById('settings-drawer-overlay');
        
        const sliderPointer = document.getElementById('slider-pointer-sens');
        const sliderScroll = document.getElementById('slider-scroll-sens');
        const valPointer = document.getElementById('pointer-sens-value');
        const valScroll = document.getElementById('scroll-sens-value');
        const btnLogout = document.getElementById('btn-logout');

        // Apply loaded sensitivity variables to UI
        if (sliderPointer && valPointer) {
            sliderPointer.value = pointerSensitivity;
            valPointer.textContent = pointerSensitivity.toFixed(1) + 'x';
            
            sliderPointer.addEventListener('input', (e) => {
                pointerSensitivity = parseFloat(e.target.value);
                valPointer.textContent = pointerSensitivity.toFixed(1) + 'x';
                localStorage.setItem('pointer_sens', pointerSensitivity);
            });
        }

        if (sliderScroll && valScroll) {
            sliderScroll.value = scrollSensitivity;
            valScroll.textContent = scrollSensitivity.toFixed(1) + 'x';
            
            sliderScroll.addEventListener('input', (e) => {
                scrollSensitivity = parseFloat(e.target.value);
                valScroll.textContent = scrollSensitivity.toFixed(1) + 'x';
                localStorage.setItem('scroll_sens', scrollSensitivity);
            });
        }

        // Drawer toggle interactions
        const openDrawer = () => {
            settingsDrawer.classList.add('active');
            drawerOverlay.classList.add('active');
        };

        const closeDrawer = () => {
            settingsDrawer.classList.remove('active');
            drawerOverlay.classList.remove('active');
        };

        if (btnSettings) btnSettings.addEventListener('click', openDrawer);
        if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeDrawer);
        if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

        // Logout
        if (btnLogout) {
            btnLogout.addEventListener('click', () => {
                // Release drag state safety check
                if (dragLockActive) {
                    socket.emit('button_state', { button: 'left', state: 'up' });
                }
                localStorage.removeItem('auth_token');
                socket.disconnect();
                window.location.reload();
            });
        }
    }
});
