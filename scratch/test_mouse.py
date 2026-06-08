import sys
import os
import time
import Quartz
import ApplicationServices

def test_quartz_movement():
    # Check accessibility trust status
    trusted = ApplicationServices.AXIsProcessTrusted()
    print(f"macOS AXIsProcessTrusted (Accessibility Permission): {trusted}")
    if not trusted:
        print("⚠️  Warning: Process is NOT trusted. Mouse clicks and scroll gestures will be blocked by macOS.")
        print("    To fix, go to: System Settings -> Privacy & Security -> Accessibility, and add/enable your Terminal/IDE.")
        print("    Note: Cursor movement will STILL work because it uses the permission-free Warp API.")
    else:
        print("✅ Success: Process has Accessibility permissions. All clicks and gestures will function.")

    print("\nTesting CGWarpMouseCursorPosition...")
    
    # 1. Get initial mouse location
    event = Quartz.CGEventCreate(None)
    start_pos = Quartz.CGEventGetLocation(event)
    print(f"Initial Mouse Position: ({start_pos.x:.2f}, {start_pos.y:.2f})")
    
    # 2. Simulate relative movement via Warp
    dx, dy = 100.0, 100.0
    new_pos = Quartz.CGPoint(start_pos.x + dx, start_pos.y + dy)
    
    # Warp cursor
    err = Quartz.CGWarpMouseCursorPosition(new_pos)
    
    # Allow some milliseconds for the system to process the warp
    time.sleep(0.1)
    
    # 3. Verify position updated
    check_event = Quartz.CGEventCreate(None)
    end_pos = Quartz.CGEventGetLocation(check_event)
    print(f"Final Mouse Position:   ({end_pos.x:.2f}, {end_pos.y:.2f})")
    
    # Screen size constraints check
    main_display = Quartz.CGMainDisplayID()
    width = Quartz.CGDisplayPixelsWide(main_display)
    height = Quartz.CGDisplayPixelsHigh(main_display)
    
    # Allow small epsilon because of screen edge bounds or OS rounding
    x_correct = abs(end_pos.x - new_pos.x) < 2.0
    y_correct = abs(end_pos.y - new_pos.y) < 2.0
    
    # If target coordinates exceeded screen limits, cursor should clamp to edges
    if not x_correct and new_pos.x >= width and abs(end_pos.x - (width - 1)) < 2.0:
        x_correct = True
    if not y_correct and new_pos.y >= height and abs(end_pos.y - (height - 1)) < 2.0:
        y_correct = True
        
    if x_correct and y_correct:
        print("✅ Success: Cursor warp completed successfully!")
        return True
    else:
        print(f"❌ Error: Cursor did not warp as expected. Target was ({new_pos.x:.2f}, {new_pos.y:.2f}) but is at ({end_pos.x:.2f}, {end_pos.y:.2f})")
        return False

if __name__ == '__main__':
    print("--- Starting Quartz Controls Verification ---")
    success = test_quartz_movement()
    sys.exit(0 if success else 1)
