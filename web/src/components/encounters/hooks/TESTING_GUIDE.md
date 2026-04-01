# Testing Guide: use-recording-guards Hook

This guide covers how to test the `use-recording-guards` hook both automatically (unit tests) and manually (browser testing).

## Quick Test Commands

```bash
# Run all tests
npm test

# Run only this hook's tests
npm test -- use-recording-guards.test.ts

# Run in watch mode (auto-rerun on changes)
npm test -- use-recording-guards.test.ts --watch

# Run with coverage
npm test -- use-recording-guards.test.ts --coverage
```

---

## ✅ Unit Tests (Automated)

**Location:** `use-recording-guards.test.ts`

**Coverage:**

- ✅ Navigation guard (prevents accidental navigation during recording)
- ✅ Wake lock acquisition and release
- ✅ Android notification handling
- ✅ Dialog state management
- ✅ Event listener cleanup on unmount

**Test Results:** 15 tests, all passing

---

## 🧪 Manual Testing Guide

### Prerequisites

1. Start the dev server: `npm run dev`
2. Navigate to `/encounters/new` or any encounter page with recording
3. Open browser DevTools (Console + Application tabs)

---

### Test 1: Navigation Guard (Desktop)

**Expected:** Recording should prevent accidental navigation

**Steps:**

1. Start a recording (click microphone button)
2. Try to navigate away by:
   - Clicking a sidebar link
   - Clicking the app logo
   - Typing a new URL in address bar
3. **Expected results:**
   - Clicking internal links → Custom dialog appears: "You have a recording in progress. Are you sure?"
   - Trying to close tab/window → Browser shows native "Leave site?" dialog
   - Cancel navigation → Stay on page, recording continues
   - Confirm navigation → Navigate away, recording stops

**Verification:**

```javascript
// In console, check that event listeners are attached:
window.onbeforeunload !== null; // Should be true when recording
```

---

### Test 2: Wake Lock (Mobile & Desktop)

**Expected:** Screen should stay on during recording

**Steps:**

1. **Desktop:** Open DevTools → Application → Screen Wake Lock
2. **Mobile:** Just use the device normally
3. Start recording
4. **Expected results:**
   - DevTools shows "Active wake lock" status
   - Mobile screen doesn't auto-lock during recording
   - Pause recording → Wake lock released
   - Resume recording → Wake lock re-acquired

**Verification (Console):**

```javascript
// Check if wake lock is supported
"wakeLock" in navigator; // Should be true on modern browsers

// Check if wake lock is active (while recording)
navigator.wakeLock
  .request("screen")
  .then((lock) => console.log("Wake lock active:", lock))
  .catch((err) => console.log("Wake lock denied:", err));
```

**Note:** Wake lock may fail if:

- Browser tab is not visible
- Battery is too low
- Browser doesn't support it (older browsers)

---

### Test 3: Android Notification

**Expected:** Android devices show persistent notification during recording

**Setup:**

- **Required:** Android device (or Android emulator)
- **Optional:** Chrome DevTools Device Mode (doesn't test actual notifications)

**Steps:**

1. Open app on Android device
2. Start recording
3. **Expected results:**
   - Browser requests notification permission (first time only)
   - Accept permission
   - Notification appears: "Recording in progress - Keep this tab open"
   - Lock screen → Notification visible
   - Unlock → Notification still there
   - Stop recording → Notification disappears

**Verification (Console on Android):**

```javascript
// Check notification permission
Notification.permission; // Should be "granted" after accepting

// Check if notification is shown
// (Note: Can't easily verify programmatically - visually check notification tray)
```

**Troubleshooting:**

- If notification doesn't appear: Check browser settings → Site settings → Notifications
- If notification dismissed: It will be recreated on next recording

---

### Test 4: Page Visibility + Wake Lock Re-acquisition

**Expected:** Wake lock should be re-acquired when returning to tab

**Steps:**

1. Start recording
2. Switch to another tab (or minimize browser on mobile)
3. Wait 2 seconds
4. Switch back to recording tab
5. **Expected results:**
   - Wake lock is re-acquired automatically
   - No errors in console
   - Recording continues normally

**Verification (Console):**

```javascript
// Listen for visibility changes
document.addEventListener("visibilitychange", () => {
  console.log("Visibility:", document.visibilityState);
});

// When returning to tab, wake lock should be re-requested
// Check console for "[recording-guards] Re-acquiring wake lock" (if you add logging)
```

---

### Test 5: Dialog State Management

**Expected:** Dialog should manage navigation correctly

**Steps:**

1. Start recording
2. Click an internal link (e.g., sidebar "Templates")
3. **Expected results:**
   - Custom dialog appears
   - Two buttons: "Cancel" and "Leave"
4. Click "Cancel"
   - Dialog closes
   - Stay on current page
   - Recording continues
5. Click link again
6. Click "Leave"
   - Dialog closes
   - Navigate to new page
   - Recording stopped

**Verification (React DevTools):**

```
RecordingBar
  ├── navDialogOpen: false (initial)
  ├── navDialogOpen: true (when link clicked during recording)
  └── navDialogOpen: false (after cancel or confirm)
```

---

### Test 6: Cleanup on Unmount

**Expected:** All resources should be released when component unmounts

**Steps:**

1. Start recording
2. Navigate to different encounter (or refresh page)
3. **Expected results:**
   - Wake lock released
   - Event listeners removed
   - Notification closed (Android)
   - No errors in console

**Verification (Console):**

```javascript
// Before unmount (while recording)
window.onbeforeunload !== null; // true

// After unmount (after navigation)
window.onbeforeunload === null; // true (event listener removed)
```

---

### Test 7: Multiple Recordings (Sequential)

**Expected:** Hook should reset properly between recordings

**Steps:**

1. Start recording → Stop recording
2. Start new recording
3. **Expected results:**
   - Wake lock re-acquired
   - Navigation guard re-enabled
   - No stale state from previous recording
   - All guards work correctly

---

## 🔍 Common Issues & Debugging

### Issue: Wake lock not working

**Possible causes:**

- Browser tab not visible (switch back to tab)
- Low battery (charge device)
- Browser doesn't support Wake Lock API (check `'wakeLock' in navigator`)
- HTTPS required (wake lock only works on secure origins)

**Debug:**

```javascript
if ("wakeLock" in navigator) {
  navigator.wakeLock
    .request("screen")
    .then((lock) => {
      console.log("✓ Wake lock acquired");
      lock.addEventListener("release", () => console.log("Wake lock released"));
    })
    .catch((err) => console.error("✗ Wake lock failed:", err));
} else {
  console.warn("Wake Lock API not supported");
}
```

---

### Issue: Notification not showing (Android)

**Possible causes:**

- Permission denied (check browser settings)
- Not Android device (notifications only on Android)
- Browser doesn't support Notification API

**Debug:**

```javascript
console.log("Notification permission:", Notification.permission);
console.log("Is Android:", /Android/i.test(navigator.userAgent));

if (Notification.permission === "default") {
  Notification.requestPermission().then((permission) => {
    console.log("New permission:", permission);
  });
}
```

---

### Issue: Navigation guard not working

**Possible causes:**

- `isRecording` prop is false
- Event listeners not attached
- Browser blocking beforeunload

**Debug:**

```javascript
// Check if beforeunload is attached
console.log("beforeunload attached:", window.onbeforeunload !== null);

// Manually trigger beforeunload
const event = new Event("beforeunload");
window.dispatchEvent(event);
console.log("Event dispatched");
```

---

## 📊 Testing Checklist

Use this checklist when testing the hook implementation:

### Basic Functionality

- [ ] Navigation guard shows dialog when clicking links during recording
- [ ] Browser shows "Leave site?" when trying to close tab during recording
- [ ] Wake lock keeps screen on during recording (mobile)
- [ ] Wake lock released when recording stopped
- [ ] Android notification appears during recording
- [ ] Android notification disappears when recording stopped

### Edge Cases

- [ ] Wake lock re-acquired when returning to tab after switching away
- [ ] Multiple sequential recordings work correctly
- [ ] Cleanup happens properly on unmount (no memory leaks)
- [ ] Navigation guard removed when recording stopped
- [ ] No errors in console during normal operation

### Cross-Browser

- [ ] Chrome Desktop
- [ ] Chrome Android
- [ ] Safari iOS
- [ ] Safari Desktop (note: wake lock may not be supported)
- [ ] Firefox (note: wake lock may not be supported)

### Accessibility

- [ ] Dialog can be dismissed with Escape key
- [ ] Focus trapped in dialog when open
- [ ] Screen reader announces dialog content

---

## 🎯 Success Criteria

The hook implementation is ready for production if:

1. ✅ All 15 unit tests pass
2. ✅ All manual tests pass on target browsers
3. ✅ No console errors during normal operation
4. ✅ Wake lock works on mobile devices
5. ✅ Navigation guard prevents accidental data loss
6. ✅ Android notifications work as expected
7. ✅ Cleanup happens properly (no memory leaks)

---

## 📝 Notes

- Wake Lock API is not supported in all browsers (Firefox, older Safari)
- Notifications only work on Android (iOS doesn't support persistent notifications)
- HTTPS is required for wake lock to work
- Browser may deny wake lock if battery is low or device is in power-saving mode

---

## 🔗 Related Files

- Hook implementation: `use-recording-guards.ts`
- Hook tests: `use-recording-guards.test.ts`
- Component using hook: `recording-bar.tsx`
- Other hooks: `use-audio-devices.ts`
