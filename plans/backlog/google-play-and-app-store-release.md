# MediTalk — Google Play & App Store Release Plan

> Audit date: 2026-04-07
> App ID: `ai.meditalk.app` | Version: `1.0` (build 1)

---

## 1. Code-Level Fixes (Both Platforms)

### iOS — Critical

- [ ] **Remove `NSAllowsArbitraryLoads`** from `web/ios/App/App/Info.plist`
  - Apple will reject the app with blanket HTTP allowed
  - Production server (`app.meditalk.ai`) is HTTPS — no exception domains needed
  - Keep ATS defaults (HTTPS enforced)

- [ ] **Change `UIRequiredDeviceCapabilities` from `armv7` to `arm64`**
  - File: `web/ios/App/App/Info.plist`
  - Apple requires 64-bit since iOS 11; `armv7` will cause rejection

- [ ] **Add missing privacy usage descriptions** (if applicable)
  - `NSCameraUsageDescription` — needed if camera is ever triggered (file uploads via `<input type="file">` can open camera)
  - `NSPhotoLibraryUsageDescription` — needed if user can pick photos
  - Check if the web app uses `<input type="file" accept="image/*">` — if yes, both are required

### Android — Critical

- [ ] **Configure release signing keystore**
  - Create keystore: `keytool -genkey -v -keystore meditalk-release.keystore -alias meditalk -keyalg RSA -keysize 2048 -validity 10000`
  - Store keystore file securely (NOT in git)
  - Add `signingConfigs` block in `web/android/app/build.gradle`:
    ```gradle
    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_FILE") ?: "meditalk-release.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
    ```
  - Reference in `buildTypes.release`: `signingConfig signingConfigs.release`

- [ ] **Enable minification for release builds**
  - File: `web/android/app/build.gradle`
  - Set `minifyEnabled true` in `buildTypes.release`
  - Test thoroughly after enabling — ProGuard can break reflection-based code

---

## 2. App Store Connect Setup (iOS)

- [ ] **Create app in App Store Connect** (appstoreconnect.apple.com)
  - Bundle ID: `ai.meditalk.app`
  - Primary language: Slovak
  - Category: Medical

- [ ] **App Information**
  - [ ] App name: MediTalk
  - [ ] Subtitle (optional, max 30 chars)
  - [ ] Privacy policy URL (required)
  - [ ] Category: Medical
  - [ ] Content rights: confirm no third-party content issues

- [ ] **Pricing & Availability**
  - [ ] Select pricing (Free / Paid / Subscription)
  - [ ] Select available countries/regions

- [ ] **App Privacy (Nutrition Labels)**
  - [ ] Data types collected: Audio data (microphone recordings), usage data
  - [ ] Data linked to user: account info, health data (medical notes)
  - [ ] Complete all privacy questionnaire sections

- [ ] **Screenshots** (required sizes)
  - [ ] iPhone 6.7" (1290 x 2796) — iPhone 15 Pro Max
  - [ ] iPhone 6.5" (1284 x 2778) — iPhone 14 Plus
  - [ ] iPad 12.9" (2048 x 2732) — if supporting iPad
  - Minimum 3 screenshots per size, recommend 5-8
  - Show key flows: encounter list, recording, generated note

- [ ] **App description**
  - [ ] Short description / promotional text (max 170 chars)
  - [ ] Full description (max 4000 chars)
  - [ ] Keywords (max 100 chars, comma-separated)
  - [ ] What's New text for v1.0

- [ ] **App Review Information**
  - [ ] Demo account credentials (for Apple reviewer)
  - [ ] Contact info for review team
  - [ ] Notes explaining microphone/audio usage

---

## 3. Google Play Console Setup (Android)

- [ ] **Create app in Google Play Console** (play.google.com/console)
  - Default language: Slovak
  - App type: App (not game)
  - Free or paid

- [ ] **Store listing**
  - [ ] App name: MediTalk
  - [ ] Short description (max 80 chars)
  - [ ] Full description (max 4000 chars)
  - [ ] App icon: 512x512 PNG (already have)
  - [ ] Feature graphic: 1024x500 PNG (required — create this)
  - [ ] Screenshots: minimum 2 per device type, recommend 5-8
    - [ ] Phone screenshots
    - [ ] Tablet screenshots (if supporting)

- [ ] **Content rating**
  - [ ] Complete IARC questionnaire
  - Medical app, no violence/gambling/etc.

- [ ] **Privacy & permissions**
  - [ ] Privacy policy URL (same as iOS)
  - [ ] Declare sensitive permissions usage:
    - RECORD_AUDIO: "Used to record doctor-patient conversations for automated medical note generation"
    - FOREGROUND_SERVICE: "Keeps audio recording active when app is in background"
    - WAKE_LOCK: "Prevents device sleep during active recording sessions"

- [ ] **Target audience & content**
  - [ ] Target age group: 18+ (medical professionals)
  - [ ] Not designed for children (no COPPA concerns)

- [ ] **Data safety section**
  - [ ] Audio data collected (microphone recordings)
  - [ ] Data encrypted in transit (HTTPS)
  - [ ] Data deletion policy
  - [ ] Third-party sharing (Anthropic Claude, OpenAI Whisper)

---

## 4. Pre-Submission Testing

### iOS
- [ ] **Build release archive** in Xcode (Product > Archive)
- [ ] **Test on physical device** (not just simulator)
- [ ] **Test these flows on iOS:**
  - [ ] Login / signup
  - [ ] Record encounter (microphone permission prompt)
  - [ ] Background recording (lock screen, switch apps)
  - [ ] View encounter list
  - [ ] Generate medical note
  - [ ] File upload (if applicable)
  - [ ] Safe area rendering (status bar, home indicator)
  - [ ] Splash screen appearance

### Android
- [ ] **Build signed release APK/AAB**: `cd web/android && ./gradlew bundleRelease`
- [ ] **Test on physical device** with release build
- [ ] **Test these flows on Android:**
  - [ ] Login / signup
  - [ ] Record encounter (microphone permission prompt)
  - [ ] Background recording (foreground service notification)
  - [ ] View encounter list
  - [ ] Generate medical note
  - [ ] File upload (storage permission on Android 12-)
  - [ ] Splash screen appearance

### Both Platforms
- [ ] **Test with poor network** (slow 3G simulation)
- [ ] **Test offline behavior** (graceful error messages)
- [ ] **Test deep links** (if applicable)
- [ ] **Verify no API keys in client bundle** (check source maps, JS bundle)

---

## 5. Legal & Compliance

- [ ] **Privacy policy** — hosted at a public URL
  - Must cover: data collected, how it's used, third-party processors (Anthropic, OpenAI), data retention, deletion rights
  - Required by both Apple and Google

- [ ] **Terms of service** (recommended)

- [ ] **GDPR compliance** (if serving EU users)
  - [ ] Data processing agreements with Anthropic, OpenAI, Supabase
  - [ ] User consent for audio recording
  - [ ] Right to deletion implemented

- [ ] **Medical data considerations**
  - [ ] Check if app falls under medical device regulations in target markets
  - [ ] Disclaimer that app is an aid, not a replacement for medical judgment

---

## 6. Submission

### iOS
- [ ] Upload build via Xcode or Transporter
- [ ] Select build in App Store Connect
- [ ] Submit for review
- [ ] Typical review: 1-3 days
- [ ] Be ready to respond to reviewer questions about microphone usage

### Android
- [ ] Upload signed AAB to Google Play Console
- [ ] Submit for review (Production or Internal testing track first)
- [ ] Typical review: hours to 3 days
- [ ] Monitor for policy compliance warnings

---

## 7. Post-Launch

- [ ] **Monitor crash reports** (Xcode Organizer / Play Console)
- [ ] **Increment version numbers** for updates
  - iOS: bump `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in Xcode
  - Android: bump `versionCode` (integer, must always increase) and `versionName`
- [ ] **Set up push notifications** (optional, requires `google-services.json` for Android, APNs for iOS)
- [ ] **Consider analytics** (optional)
