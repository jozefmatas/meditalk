# MediTalk — Capacitor Native App Migration Plan

> **Status:** Planning
> **Created:** 2026-03-31
> **Goal:** Convert Next.js PWA to native iOS/Android apps for persistent microphone access during screen lock
> **Complexity Estimate:** Medium-High (3-4 weeks development + 2-4 weeks testing/deployment)

---

## Executive Summary

**Problem:** Web PWA cannot maintain microphone access when device screen locks on iOS/Android. Wake Lock API and notifications are insufficient — iOS suspends all web audio within seconds of screen lock.

**Solution:** Wrap Next.js app in Capacitor native container to use native microphone APIs that survive screen lock.

**Complexity:** MEDIUM-HIGH

- ✅ **Low complexity:** Codebase is already well-structured for Capacitor (standalone PWA manifest, modern Next.js)
- ⚠️ **Medium complexity:** Requires native build pipeline, app store deployment, code signing
- ⚠️ **High complexity:** Recording logic refactor (MediaRecorder → Capacitor Audio Recorder), background mode permissions

**Timeline:** 3-4 weeks development + 2-4 weeks for app store review/deployment

---

## Current Architecture Assessment

### What's Already Working (✅ Capacitor-Ready)

- **Next.js 16 App Router** — Capacitor officially supports Next.js with static export
- **PWA manifest** — Already configured (`manifest.ts`) with standalone display, icons ready
- **Modern React 19** — No compatibility issues with Capacitor
- **next-intl** — Works with Capacitor (client-side i18n)
- **IndexedDB** — Native support in Capacitor WebView
- **Supabase client** — Works via HTTP (no changes needed)
- **WebSocket streams** — ElevenLabs Scribe works in WebView
- **Icon assets** — `/public/icon-192.png`, `/public/icon-512.png` ready for mobile

### What Needs Changes (⚠️ Requires Work)

- **MediaRecorder API** → Replace with Capacitor Audio Recorder plugin
- **Wake Lock API** → Replace with Capacitor Background Mode + Keep Awake plugins
- **navigator.mediaDevices** → Replace with Capacitor Media plugin for device selection
- **Web notifications** → Replace with Capacitor Local Notifications plugin
- **Build pipeline** → Add `next export` + Capacitor CLI + native builds (Xcode/Android Studio)
- **Routing** → Verify Next.js routing works in `file://` context (likely needs static export)
- **Server-side APIs** → Already using API routes via HTTP (no changes needed, but deploy domain required)

### Critical Files Requiring Changes

| File                                                                         | Current Implementation                  | Capacitor Replacement                               |
| ---------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| [recording-bar.tsx:124-126](web/src/components/encounters/recording-bar.tsx) | `navigator.mediaDevices.getUserMedia()` | `@capacitor-community/media` or `@capacitor/device` |
| [recording-bar.tsx:141](web/src/components/encounters/recording-bar.tsx)     | `MediaRecorder` API                     | `@capacitor-community/audio-recorder`               |
| [recording-bar.tsx:159-174](web/src/components/encounters/recording-bar.tsx) | Wake Lock API                           | `@capacitor-community/keep-awake` + Background Mode |
| [recording-bar.tsx:182-209](web/src/components/encounters/recording-bar.tsx) | Web Notifications                       | `@capacitor/local-notifications`                    |
| `next.config.ts`                                                             | Dynamic Next.js                         | Static export + Capacitor config                    |

---

## Why Capacitor? (vs React Native, Flutter, etc.)

**Pros:**

- ✅ **Minimal rewrite** — Wraps existing Next.js app, ~90% of code reusable
- ✅ **Native APIs** — Access to iOS/Android microphone background mode
- ✅ **Web skills** — Team continues using React/TypeScript/Tailwind
- ✅ **Dual deployment** — Keep web PWA + add native apps (same codebase!)
- ✅ **Official support** — Ionic maintains Capacitor, large community, good docs
- ✅ **Incremental migration** — Can ship basic version quickly, add native features progressively

**Cons:**

- ⚠️ **Native tooling required** — Need Xcode (macOS only), Android Studio
- ⚠️ **App store submission** — 2-4 weeks review time, developer accounts ($99/year iOS + $25 one-time Android)
- ⚠️ **Static export limitation** — Next.js must be statically exported (no SSR in app, but API routes still work via HTTP)
- ⚠️ **Bundle size** — WebView + bundled assets = larger than pure native (~20-30 MB vs 5-10 MB)
- ⚠️ **Plugin compatibility** — Some web APIs need plugin wrappers (MediaRecorder, Wake Lock, etc.)

**Alternative: React Native**

- ❌ **Full rewrite** — Would need to rebuild UI in React Native components (no Tailwind, no shadcn)
- ❌ **Longer timeline** — 3-6 months vs 3-4 weeks for Capacitor
- ✅ **Better performance** — Native UI rendering, smaller bundle size
- ✅ **No WebView overhead** — Pure native

**Verdict:** Capacitor is the right choice for MediTalk given the existing codebase and timeline constraints.

---

## Phase 1 — Core Capacitor Setup (Week 1: 5-7 days)

### 1.1 Install Capacitor

**Install core packages:**

```bash
cd web
pnpm add @capacitor/core @capacitor/cli
pnpm add @capacitor/ios @capacitor/android
```

**Initialize Capacitor:**

```bash
npx cap init
# App name: MediTalk
# Package ID: ai.meditalk.app (or com.yourdomain.meditalk)
# Web asset directory: out (after static export)
```

**Files created (inside `web/` folder):**

- `capacitor.config.ts` (NEW) — Capacitor configuration
- `ios/` (NEW) — Xcode project
- `android/` (NEW) — Android Studio project

**Project structure after Capacitor init:**

```
meditalk/
├── web/
│   ├── ios/              ← Xcode project (generated by Capacitor)
│   ├── android/          ← Android Studio project (generated by Capacitor)
│   ├── src/
│   ├── public/
│   ├── out/              ← Static export (generated by next build)
│   ├── package.json
│   ├── capacitor.config.ts  ← Capacitor config
│   ├── next.config.ts
│   └── ...
├── admin/
│   └── ...
└── plans/
    ├── security.md
    └── capacitor.md
```

**Why this structure?**

- ✅ Standard Capacitor convention (generated by `npx cap init`)
- ✅ All web app code (Next.js + native wrappers) in one place
- ✅ Simpler relative paths in `capacitor.config.ts`
- ✅ Single build root for CI/CD

**What to commit to git:**

Add to `.gitignore`:

```gitignore
# Capacitor native builds (can be regenerated)
web/ios/App/App.xcworkspace/xcuserdata/
web/ios/App/Pods/
web/android/.gradle/
web/android/app/build/
web/android/local.properties
```

Keep in git (project configuration):

- `web/ios/App/` (Xcode project files)
- `web/android/app/` (Android project files)
- `web/capacitor.config.ts`

### 1.2 Configure Next.js Static Export

**File:** `web/next.config.ts`

**Changes:**

```typescript
const nextConfig: NextConfig = {
  output: "export", // ← Enable static export for Capacitor
  images: {
    unoptimized: true, // Required for static export
  },
  trailingSlash: true, // Helps with file:// routing
  headers: async () => [{ source: "/(.*)", headers: securityHeaders }],
};
```

**Why static export?**

- Capacitor WebView loads from `file://` (no Node.js server)
- API routes continue working via HTTP (calls to your deployed backend)
- Client-side routing (Next.js App Router) works fine with static export

### 1.3 Update Build Scripts

**File:** `web/package.json`

```json
{
  "scripts": {
    "dev": "next dev -p 8111",
    "build": "next build",
    "build:capacitor": "next build && npx cap sync",
    "export": "next build",
    "ios": "npx cap run ios",
    "android": "npx cap run android",
    "sync": "npx cap sync"
  }
}
```

**Build workflow:**

1. `pnpm build` — Next.js builds to `/out` directory (static export)
2. `npx cap sync` — Copies `/out` to native projects (`ios/App/public/`, `android/app/src/main/assets/public/`)
3. `npx cap run ios|android` — Opens Xcode/Android Studio to build/run native app

### 1.4 Configure Capacitor Settings

**File:** `web/capacitor.config.ts` (NEW)

```typescript
import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.meditalk.app",
  appName: "MediTalk",
  webDir: "out",
  server: {
    // For dev: load from local Next.js server
    // For prod: load from bundled assets
    url: process.env.CAP_SERVER_URL,
    cleartext: true, // Allow HTTP in dev
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#4945ff",
      showSpinner: false,
    },
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#ffffff",
  },
  android: {
    backgroundColor: "#ffffff",
    allowMixedContent: true, // Only if needed for dev
  },
};

export default config;
```

### 1.5 Test Basic WebView

**Goal:** Verify Next.js app loads in Capacitor WebView

```bash
pnpm build:capacitor
npx cap open ios    # Opens Xcode
npx cap open android # Opens Android Studio
```

**Expected result:**

- App loads in simulator/emulator
- UI renders correctly
- Navigation works
- API calls to production backend succeed

**Common issues:**

- **Routing fails** → Add `trailingSlash: true` to `next.config.ts`
- **Images broken** → Ensure `images.unoptimized: true` in config
- **API calls fail** → Check CORS headers on backend (allow app domain)

---

## Phase 2 — Replace Web APIs with Capacitor Plugins (Week 2: 5-7 days)

### 2.1 Install Required Plugins

```bash
pnpm add @capacitor-community/audio-recorder
pnpm add @capacitor-community/keep-awake
pnpm add @capacitor/local-notifications
pnpm add @capacitor/device
pnpm add @capacitor/app
pnpm add @capacitor/filesystem
```

**Plugin summary:**

- **audio-recorder** — Replaces MediaRecorder API
- **keep-awake** — Replaces Wake Lock API
- **local-notifications** — Replaces Web Notifications
- **device** — Device info and permissions
- **app** — App lifecycle events
- **filesystem** — Save audio files before upload

### 2.2 Replace MediaRecorder with Capacitor Audio Recorder

**File:** [web/src/components/encounters/recording-bar.tsx](web/src/components/encounters/recording-bar.tsx)

**Current code (lines 141-300):**

```typescript
// Web API
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
mediaRecorderRef.current.ondataavailable = (e) =>
  chunksRef.current.push(e.data);
mediaRecorderRef.current.start(timeslice);
```

**New code (Capacitor):**

```typescript
import { AudioRecorder } from "@capacitor-community/audio-recorder";
import { Capacitor } from "@capacitor/core";

// Request microphone permission (iOS/Android)
const hasPermission = await AudioRecorder.requestPermission();
if (!hasPermission.value) {
  setMicError(true);
  return;
}

// Start recording
await AudioRecorder.startRecording();

// Stop and get file
const result = await AudioRecorder.stopRecording();
// result.value.path → file:// URL to recorded audio
// Convert to Blob for upload
const fileBlob = await fetch(result.value.path).then((r) => r.blob());
```

**Key differences:**

- ❌ No `timeslice` support (no chunked recording) — recording saved as single file on stop
- ❌ No `mimeType` control — iOS uses M4A (AAC), Android uses M4A or WebM depending on device
- ✅ Survives screen lock (native audio session)
- ✅ Simpler API (no MediaStream, no dataavailable events)

**Migration impact:**

- Remove `chunksRef` logic (single file now)
- Remove `segmentsRef` logic (no pause/resume chunking)
- Simplify upload flow (one file instead of concatenated chunks)
- Update file type detection (M4A on iOS, WebM on Android)

### 2.3 Replace Wake Lock with Keep Awake + Background Mode

**File:** [web/src/components/encounters/recording-bar.tsx](web/src/components/encounters/recording-bar.tsx)

**Current code (lines 164-179):**

```typescript
// Web API
wakeLockRef.current = await navigator.wakeLock.request("screen");
```

**New code (Capacitor):**

```typescript
import { KeepAwake } from "@capacitor-community/keep-awake";

// Keep screen on during recording
await KeepAwake.keepAwake();

// On stop
await KeepAwake.allowSleep();
```

**Background Mode configuration (iOS):**

**File:** `ios/App/App/Info.plist`

Add background mode for audio:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

**File:** `ios/App/Podfile`

Add microphone permission description:

```ruby
target 'App' do
  # Add permission descriptions
  post_install do |installer|
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['INFOPLIST_FILE'] = 'Pods/Target Support Files/#{target.name}/#{target.name}-Info.plist'
      end
    end
  end
end
```

**File:** `ios/App/App/Info.plist`

Add microphone permission description:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>MediTalk needs microphone access to record medical consultations</string>
```

**Background Mode configuration (Android):**

**File:** `android/app/src/main/AndroidManifest.xml`

Add permissions:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

### 2.4 Replace Web Notifications with Local Notifications

**File:** [web/src/components/encounters/recording-bar.tsx](web/src/components/encounters/recording-bar.tsx)

**Current code (lines 194-204):**

```typescript
// Web API
notificationRef.current = new Notification(title, { body, icon });
```

**New code (Capacitor):**

```typescript
import { LocalNotifications } from "@capacitor/local-notifications";

// Request permission
await LocalNotifications.requestPermissions();

// Show notification
await LocalNotifications.schedule({
  notifications: [
    {
      id: 1,
      title: t("recordingNotificationTitle"),
      body: t("recordingNotificationBody"),
      ongoing: true, // Persistent notification (Android)
      sound: null,
      attachments: null,
      actionTypeId: "",
      extra: null,
    },
  ],
});

// Cancel notification
await LocalNotifications.cancel({ notifications: [{ id: 1 }] });
```

### 2.5 Detect Capacitor Environment

**File:** `web/src/lib/platform.ts` (NEW)

```typescript
import { Capacitor } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();
export const isIOS = Capacitor.getPlatform() === "ios";
export const isAndroid = Capacitor.getPlatform() === "android";
export const isWeb = Capacitor.getPlatform() === "web";
```

**Usage in recording-bar.tsx:**

```typescript
import { isNative, isIOS } from "@/lib/platform";

// Use Capacitor API if native, otherwise fallback to web
if (isNative) {
  await AudioRecorder.startRecording();
} else {
  // Existing MediaRecorder code (for web PWA)
  mediaRecorderRef.current = new MediaRecorder(stream);
}
```

**Why keep web fallback?**

- Continue supporting PWA for desktop users (no screen lock issues on desktop)
- Easier development (no need to build native every time)
- Gradual migration (can ship web first, native later)

**Note:** After native app is stable and most mobile users have migrated, you can remove Wake Lock + Android notification code from web PWA (see Phase 3.2 for deprecation strategy)

---

## Phase 3 — Native Permissions & UX (Week 2-3: 3-5 days)

### 3.1 Mobile App Download Banner (Web PWA)

**Goal:** Drive users to download native app for better recording experience

**File:** `web/src/components/shared/mobile-app-banner/index.tsx` (NEW)

```typescript
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/shared/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, AppleIcon, GoogleIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";

export function MobileAppBanner() {
  const t = useTranslations("app");
  const [dismissed, setDismissed] = useState(true);
  const [platform, setPlatform] = useState<"ios" | "android" | null>(null);

  useEffect(() => {
    // Only show on mobile devices
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) return;

    // Check if user already dismissed
    const wasDismissed = localStorage.getItem("mobile-app-banner-dismissed");
    if (wasDismissed) return;

    // Detect platform
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isAndroid = /Android/i.test(navigator.userAgent);

    setPlatform(isIOS ? "ios" : isAndroid ? "android" : null);
    setDismissed(false);
  }, []);

  const handleDismiss = () => {
    localStorage.setItem("mobile-app-banner-dismissed", "true");
    setDismissed(true);
  };

  const handleDownload = () => {
    if (platform === "ios") {
      window.location.href = "https://apps.apple.com/app/meditalk/YOUR_APP_ID";
    } else if (platform === "android") {
      window.location.href = "https://play.google.com/store/apps/details?id=ai.meditalk.app";
    }
  };

  if (dismissed || !platform) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <HugeiconsIcon
          icon={platform === "ios" ? AppleIcon : GoogleIcon}
          className="size-6 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {t("downloadAppTitle")}
          </p>
          <p className="text-xs opacity-90 truncate">
            {t("downloadAppDescription")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleDownload}
        >
          {t("download")}
        </Button>
        <button
          onClick={handleDismiss}
          className="p-1 hover:opacity-70 transition-opacity"
          aria-label={t("dismiss")}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-5" />
        </button>
      </div>
    </div>
  );
}
```

**Add to layout:**

**File:** `web/src/app/[locale]/(app)/layout.tsx`

```typescript
import { MobileAppBanner } from "@/components/shared/mobile-app-banner";

export default function AppLayout({ children }) {
  return (
    <>
      <MobileAppBanner />
      {/* existing layout */}
    </>
  );
}
```

**i18n keys:**

**File:** `web/messages/en.json`, `sk.json`, `cs.json`

```json
{
  "app": {
    "downloadAppTitle": "Get the MediTalk app",
    "downloadAppDescription": "Better recording experience + works when screen is locked",
    "download": "Download",
    "dismiss": "Dismiss"
  }
}
```

**When to show:**

- ✅ Mobile devices only (iOS/Android)
- ✅ First visit or until dismissed
- ❌ Desktop browsers (no benefit)
- ❌ Already in native app (Capacitor.isNativePlatform)

**Dismissal behavior:**

- Dismiss button saves to `localStorage`
- Persists across sessions
- Can re-show after 30 days (optional enhancement)

### 3.2 Deprecate Wake Lock on Web PWA (Optional)

**Strategy:** Since we're pushing users to native app, we can simplify web PWA by removing Wake Lock complexity.

**Option A: Remove immediately (aggressive)**

- Show warning: "Recording on mobile web is limited. Download the app for best experience."
- Remove Wake Lock + Android notification code
- Web PWA becomes desktop-only (screen can lock on mobile, user warned)

**Option B: Deprecate gradually (recommended)**

- Keep Wake Lock for 3-6 months during migration
- Show deprecation notice on mobile web: "Limited support. Download app for reliable recording."
- After 90% of mobile users are on native app, remove Wake Lock

**Option C: Keep forever (safe but complex)**

- Maintain dual code paths indefinitely
- More maintenance burden
- Users can choose web or native

**Recommended: Option B (Gradual Deprecation)**

Timeline:

- Month 1-2: Launch native app + download banner
- Month 3-4: Add deprecation notice to web PWA
- Month 5-6: Analyze usage (if <5% users still on web, proceed to remove)
- Month 7+: Remove Wake Lock code from web PWA

### 3.3 Request Microphone Permissions

**File:** `web/src/components/encounters/recording-bar.tsx`

**Add permission flow:**

```typescript
import { AudioRecorder } from "@capacitor-community/audio-recorder";
import { Capacitor } from "@capacitor/core";

const requestMicPermission = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) {
    // Web: navigator.mediaDevices.getUserMedia() handles permission
    return true;
  }

  // Native: Use Capacitor plugin
  const status = await AudioRecorder.requestPermission();
  return status.value;
};

const handleRecord = async () => {
  const hasPermission = await requestMicPermission();
  if (!hasPermission) {
    setMicError(true);
    toast.error(t("micPermissionDenied"));
    return;
  }

  // Proceed with recording...
};
```

### 3.4 Handle App Background/Foreground

**File:** `web/src/app/[locale]/(app)/layout.tsx`

**Add app state listener:**

```typescript
import { App } from '@capacitor/app';
import { useEffect } from 'react';

export default function AppLayout({ children }) {
  useEffect(() => {
    // Listen for app state changes (iOS/Android only)
    const listener = App.addListener('appStateChange', (state) => {
      if (state.isActive) {
        console.log('[app] Foreground');
        // Re-acquire wake lock if recording
      } else {
        console.log('[app] Background');
      }
    });

    return () => {
      listener.remove();
    };
  }, []);

  return <>{children}</>;
}
```

### 3.5 Add Splash Screen

**Install plugin:**

```bash
pnpm add @capacitor/splash-screen
```

**Configure in capacitor.config.ts:**

```typescript
plugins: {
  SplashScreen: {
    launchShowDuration: 2000,
    backgroundColor: "#4945ff",
    showSpinner: false,
  },
},
```

**Add splash assets:**

- `ios/App/App/Assets.xcassets/Splash.imageset/` — iOS splash image
- `android/app/src/main/res/drawable/splash.png` — Android splash image

**Hide splash after app loads:**

```typescript
import { SplashScreen } from "@capacitor/splash-screen";

useEffect(() => {
  SplashScreen.hide();
}, []);
```

---

## Phase 4 — Build & Deploy Pipeline (Week 3: 5-7 days)

### 4.0 Update Deep Links & App Store Metadata

**Deep links for download banner:**

After app store submission, you'll get:

- iOS: `https://apps.apple.com/app/meditalk/YOUR_APP_ID`
- Android: `https://play.google.com/store/apps/details?id=ai.meditalk.app`

Update the MobileAppBanner component with real URLs once apps are live.

**App Store metadata:**

- Primary feature: "Record medical consultations even when screen is locked"
- Screenshots: Show recording during screen lock (before/after comparison)
- Keywords: medical recording, consultation notes, voice transcription, healthcare AI

## Phase 4 — Build & Deploy Pipeline (Week 3: 5-7 days)

### 4.1 iOS Build Setup

**Requirements:**

- macOS with Xcode 15+ (FREE)
- Apple Developer account ($99/year)
- Provisioning profile + code signing certificate

**Steps:**

1. Open Xcode: `npx cap open ios`
2. Select target → Signing & Capabilities
3. Team: Select your Apple Developer team
4. Bundle Identifier: `ai.meditalk.app` (must match Capacitor config)
5. Add capabilities:
   - ✅ Background Modes → Audio
   - ✅ Push Notifications (if needed later)
6. Build: Product → Archive
7. Distribute: App Store Connect

**App Store submission:**

- App name: MediTalk
- Category: Medical
- Age rating: 17+ (medical content)
- Privacy policy URL: https://meditalk.ai/privacy-policy
- Screenshots: iPhone 6.7", iPad Pro 12.9" (required)
- App review: 1-2 weeks

### 4.2 Android Build Setup

**Requirements:**

- Android Studio (FREE)
- Google Play Console account ($25 one-time)
- Keystore for signing (generate once, keep secure)

**Steps:**

1. Open Android Studio: `npx cap open android`
2. Generate keystore:
   ```bash
   keytool -genkey -v -keystore meditalk.keystore -alias meditalk -keyalg RSA -keysize 2048 -validity 10000
   ```
3. Configure signing in `android/app/build.gradle`:
   ```gradle
   android {
     signingConfigs {
       release {
         storeFile file("../../meditalk.keystore")
         storePassword "YOUR_PASSWORD"
         keyAlias "meditalk"
         keyPassword "YOUR_PASSWORD"
       }
     }
     buildTypes {
       release {
         signingConfig signingConfigs.release
       }
     }
   }
   ```
4. Build: Build → Generate Signed Bundle / APK → Android App Bundle (AAB)
5. Upload to Google Play Console

**Google Play submission:**

- App name: MediTalk
- Category: Medical
- Content rating: High Maturity (medical content)
- Privacy policy URL: https://meditalk.ai/privacy-policy
- Screenshots: Phone, Tablet (required)
- App review: 3-7 days

### 4.3 CI/CD Automation

**File:** `.github/workflows/build-native.yml` (NEW)

```yaml
name: Build Native Apps

on:
  push:
    branches: [main]
    paths:
      - "web/**"

jobs:
  ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: cd web && pnpm install && pnpm build:capacitor
      - name: Build iOS
        run: |
          cd web/ios/App
          xcodebuild -workspace App.xcworkspace -scheme App -configuration Release archive -archivePath build/App.xcarchive
      - name: Upload to TestFlight
        run: |
          xcrun altool --upload-app --type ios --file build/App.xcarchive --apiKey ${{ secrets.APP_STORE_API_KEY }}

  android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: cd web && pnpm install && pnpm build:capacitor
      - name: Build Android
        run: |
          cd web/android
          ./gradlew bundleRelease
      - name: Upload to Play Console
        run: |
          # Use fastlane or Google Play API
```

---

## Phase 5 — Testing & QA (Week 4: 7-10 days)

### 5.1 Device Testing Matrix

**iOS devices:**

- iPhone 15 Pro (iOS 18.0) — latest flagship
- iPhone SE 3rd gen (iOS 17.0) — budget device
- iPad Air (iPadOS 18.0) — tablet

**Android devices:**

- Samsung Galaxy S24 (Android 14) — flagship
- Google Pixel 7 (Android 14) — stock Android
- OnePlus Nord (Android 13) — mid-range

### 5.2 Critical Test Cases

| Test Case                         | Expected Behavior                                               | Priority |
| --------------------------------- | --------------------------------------------------------------- | -------- |
| **Recording during screen lock**  | Microphone continues, timer updates, real-time transcript works | P0       |
| **Recording during phone call**   | Interrupted gracefully, prompt to resume after call             | P0       |
| **Recording during low battery**  | Warning at 10%, forced stop at 5% with auto-save                | P1       |
| **Recording during network loss** | Upload queue in IndexedDB, auto-retry on reconnect              | P1       |
| **Recording with Bluetooth mic**  | Works with AirPods, car Bluetooth, external mics                | P1       |
| **App update during recording**   | Recording survives update, resumes from background              | P2       |
| **Permissions denied**            | Clear error message, link to Settings                           | P0       |
| **Background mode battery drain** | <5% extra drain per hour of recording                           | P1       |

### 5.3 App Store Review Preparation

**Common rejection reasons:**

- ❌ Missing privacy policy (add `/privacy-policy` page)
- ❌ Insufficient microphone usage description (improve NSMicrophoneUsageDescription)
- ❌ Medical claims without disclaimer (add "This is a tool for healthcare professionals" disclaimer)
- ❌ Crashes on launch (test on oldest supported iOS/Android versions)
- ❌ Background mode abuse (justify in review notes: "Medical consultation recording requires continuous audio")

**Review notes template:**

```
This app is designed for healthcare professionals to record medical consultations.

Background audio mode is required because:
1. Consultations can last 15-30 minutes
2. Doctors need to interact with other apps (EMR, labs) during consultation
3. Screen locks automatically during recording to save battery
4. Stopping recording mid-consultation would lose critical medical data

Test account:
Email: reviewer@meditalk.ai
Password: [provided separately]

Test flow:
1. Log in with test account
2. Tap "New Encounter"
3. Tap Record button (grants mic permission)
4. Lock screen → observe recording continues
5. Unlock → observe live transcript updates
6. Stop recording → see generated medical note
```

---

## Migration Strategy & Timeline

### Option A: Big Bang Migration (FAST, HIGH RISK)

**Timeline:** 3-4 weeks

1. Week 1: Capacitor setup + static export
2. Week 2: Replace all web APIs
3. Week 3: Native builds + app store submission
4. Week 4: QA + bug fixes

**Pros:**

- ✅ Fastest path to native apps
- ✅ Clean codebase (no web/native branching)

**Cons:**

- ❌ Risky (users lose web PWA if native fails)
- ❌ No rollback (commits are hard to revert)
- ❌ Testing rushed (less time to catch bugs)

### Option B: Incremental Migration (SLOW, LOW RISK) — RECOMMENDED

**Timeline:** 5-6 weeks

1. Week 1: Capacitor setup + basic WebView (keep web APIs)
2. Week 2: Test native app with existing web code (no changes)
3. Week 3: Add platform detection + dual code paths (web + native)
4. Week 4: Replace web APIs with Capacitor (behind feature flag)
5. Week 5: Native builds + app store submission
6. Week 6: QA + bug fixes

**Pros:**

- ✅ Safe (web PWA continues working)
- ✅ Testable (can ship partial native features)
- ✅ Rollback friendly (feature flags)

**Cons:**

- ⏱️ Slower (5-6 weeks vs 3-4 weeks)
- 🔀 Code branching (if (isNative) everywhere)

**Recommended approach: Option B (Incremental)**

---

## Complexity Assessment

### Development Complexity: MEDIUM-HIGH

| Task                    | Complexity | Reasoning                                       |
| ----------------------- | ---------- | ----------------------------------------------- |
| Capacitor setup         | LOW        | Well-documented, official Next.js guide         |
| Static export           | LOW        | Change config, test routing                     |
| Replace MediaRecorder   | MEDIUM     | New API, different recording flow (no chunking) |
| Replace Wake Lock       | LOW        | Simple plugin, similar API                      |
| Replace Notifications   | LOW        | Simple plugin, similar API                      |
| iOS build + signing     | MEDIUM     | Requires macOS, Xcode knowledge, code signing   |
| Android build + signing | LOW        | Well-documented, mostly automated               |
| App store submission    | MEDIUM     | Requires metadata, screenshots, review prep     |
| Testing                 | MEDIUM     | Need multiple devices, edge cases               |

### Maintenance Complexity: MEDIUM

**Ongoing work:**

- Update Capacitor plugins (quarterly)
- Update native dependencies (iOS/Android SDK updates)
- Test on new OS versions (iOS 19, Android 15)
- Monitor app store reviews (respond within 24h)
- Debug native crashes (requires native tooling)

**Team skill requirements:**

- ✅ React/TypeScript/Next.js (already have)
- ✅ Web APIs (already have)
- ⚠️ Xcode + iOS development (NEW — need to learn or hire)
- ⚠️ Android Studio + Android development (NEW — need to learn or hire)
- ⚠️ App store management (NEW)

---

## Cost Estimate

### One-Time Costs

| Item                     | Cost         | Notes                          |
| ------------------------ | ------------ | ------------------------------ |
| Apple Developer Program  | $99/year     | Required for App Store         |
| Google Play Developer    | $25 one-time | Required for Play Store        |
| macOS device (if needed) | $1,000-2,500 | Mac Mini sufficient for builds |
| Development time         | 3-6 weeks    | @ your hourly rate             |

### Recurring Costs

| Item                    | Cost          | Notes                                                    |
| ----------------------- | ------------- | -------------------------------------------------------- |
| Apple Developer Program | $99/year      | Annual renewal                                           |
| CI/CD for native builds | $50-100/month | GitHub Actions macOS runners expensive                   |
| App store assets        | $0-500        | Screenshots, promo graphics (one-time or refresh)        |
| Beta testing            | $0            | TestFlight (iOS) and Internal Testing (Android) are free |

---

## Risks & Mitigation

| Risk                          | Likelihood | Impact | Mitigation                                           |
| ----------------------------- | ---------- | ------ | ---------------------------------------------------- |
| Static export breaks features | Medium     | High   | Test thoroughly, add fallbacks for dynamic routes    |
| Recording quality degrades    | Low        | High   | A/B test native vs web recording before launch       |
| App store rejection           | Medium     | Medium | Follow review guidelines, prepare clear review notes |
| Battery drain in background   | Medium     | Medium | Profile battery usage, optimize audio session config |
| Capacitor plugin bugs         | Low        | Medium | Use stable plugin versions, test on multiple devices |
| Native build pipeline fails   | Low        | High   | Set up CI/CD early, automate builds                  |

---

## Alternatives Considered

### Alternative 1: Stay Web-Only (DO NOTHING)

**Pros:**

- ✅ Zero additional work
- ✅ No app store hassle
- ✅ Instant updates (no review delay)

**Cons:**

- ❌ Screen lock kills recording (DEALBREAKER for doctors)
- ❌ Battery drain (Wake Lock keeps screen on)
- ❌ Unprofessional (notifications don't prevent audio suspension on iOS)

**Verdict:** Not viable for medical consultation recording

### Alternative 2: Progressive Web App (PWA) with Hacks

**Idea:** Use Web Audio API + AudioWorklet to keep audio context alive

**Pros:**

- ✅ No native build
- ✅ Works on web

**Cons:**

- ❌ iOS still suspends audio within seconds (confirmed in testing)
- ❌ Unreliable (browser behavior varies)
- ❌ High battery drain (keeping CPU alive via audio worklet)

**Verdict:** Not reliable enough for medical use

### Alternative 3: Electron (Desktop Only)

**Pros:**

- ✅ Full Node.js API access
- ✅ No screen lock issues

**Cons:**

- ❌ Desktop only (doctors use mobile/tablets during consultations)
- ❌ Large bundle size (>100 MB)
- ❌ Windows/macOS only (no iOS/Android)

**Verdict:** Wrong platform for this use case

---

## Success Metrics (3 Months Post-Launch)

| Metric                 | Target       | Measurement                                  |
| ---------------------- | ------------ | -------------------------------------------- |
| Recording success rate | >95%         | (successful recordings / total attempts)     |
| Screen lock survival   | 100%         | No interrupted recordings due to screen lock |
| App store rating       | >4.5/5.0     | Average rating on App Store + Play Store     |
| Battery impact         | <5% per hour | Background recording battery drain           |
| Crash-free sessions    | >99.5%       | Firebase Crashlytics                         |
| App store rejections   | <3           | Before first approval                        |

---

## Decision Framework

### When to START Capacitor migration?

✅ **YES, start now** if:

- Screen lock recording is a frequent user complaint
- Doctors are avoiding the app due to this limitation
- You have 3-6 weeks of development capacity
- You're comfortable with app store submissions
- You can dedicate 1-2 engineers to native builds

⏸️ **WAIT** if:

- Web PWA is working well enough (few complaints)
- Development team is fully booked
- You prefer to ship other features first
- You're unsure about iOS/Android expertise

❌ **DON'T START** if:

- Users are primarily on desktop (rare for medical consultations)
- Budget is constrained (<$2,000 for tools + accounts)
- No capacity for ongoing native maintenance

### Recommendation for MediTalk:

**✅ START CAPACITOR MIGRATION**

**Reasoning:**

- Screen lock is a CRITICAL issue for 15-30 min medical consultations
- Codebase is already well-structured (PWA manifest, Next.js App Router)
- 3-4 weeks is acceptable timeline for this impact
- Native APIs will also enable future features (offline mode, file system access, camera integration)

---

## Summary

**Capacitor migration is MEDIUM-HIGH complexity but HIGH value for MediTalk.**

**Key Points:**

- 3-4 weeks development time (incremental approach)
- ~90% code reuse from existing Next.js app
- Requires native tooling (Xcode, Android Studio)
- $124 one-time + $99/year for app stores
- Solves critical screen lock recording issue
- Enables future native features (offline, camera, etc.)

**Next Steps:**

1. Approve this plan
2. Set up Apple Developer + Google Play accounts
3. Install Xcode + Android Studio
4. Start Phase 1 (Capacitor setup + static export)
5. Test basic WebView on iOS/Android simulators
6. If successful, proceed to Phase 2 (replace web APIs)

---

## References

- Capacitor docs: https://capacitorjs.com/docs
- Capacitor + Next.js guide: https://capacitorjs.com/docs/guides/nextjs
- Audio Recorder plugin: https://github.com/capacitor-community/audio-recorder
- Keep Awake plugin: https://github.com/capacitor-community/keep-awake
- iOS Background Modes: https://developer.apple.com/documentation/avfoundation/audio_playback_recording_and_processing/recording_audio_in_the_background
- Android Foreground Services: https://developer.android.com/guide/components/foreground-services
