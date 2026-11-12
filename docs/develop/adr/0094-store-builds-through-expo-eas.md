# ADR-0094: Store builds through Expo EAS — iOS to TestFlight, Android to Google Play — and a watch on the review

**Status:** accepted · 2026-11-12 · amends ADR-0091 and ADR-0041

## Context

ADR-0091 and ADR-0093 took Deploy from the web hosts to servers and platforms. The third place people asked for is a
phone: an app in the App Store and on Google Play. Both stores are unlike every place so far. Nothing is served at an
address; a signed binary is built, uploaded, processed by the store, and — for the App Store — submitted for a human
review that takes hours or days and ends in a release or a rejection. Signing needs a certificate and a provisioning
profile from Apple, or a keystore, which no machine of Foundry's should hold. And the first steps are the person's
alone: an Apple Developer or Play Console account, the app's record in the store, an Apple ID sign-in for the first
signing.

Expo's EAS already solves the build and the signing for Expo apps: it builds in the cloud from the project's source,
keeps the certificates on Expo's side, and submits to both stores with an App Store Connect API key or a Play service
account. Bare React Native, Flutter and native projects have no such service without Foundry running Xcode and
Gradle itself.

## Decision

- **Expo apps only, through EAS.** A store deploy takes a project with the `expo` package and an app config
  (`app.json`, or a dynamic `app.config.*` read when the build starts, after the project's install in the checkout).
  A bare React Native, Flutter or native project is refused in words. Signing stays on EAS: Foundry never sees a
  certificate, a profile or a keystore, and the readiness check says when EAS holds no iOS signing yet (no finished
  iOS build on EAS) and gives the one-time command, `eas credentials --platform ios`, that the person runs in their
  own folder with their Apple ID.
- **Two places, `appstore` and `play`, a third kind on the card (`store`)**, shown only when the project is an Expo
  app: a site would otherwise carry two greyed buttons that say nothing. **iOS, preview or production, is an upload
  to App Store Connect** that lands in TestFlight; production is the build the person then attaches to a version and
  submits for review *there*. Foundry never submits for review and never releases: both are the person's acts in
  App Store Connect, said so in the confirmation. **Android preview** is an internal-distribution APK, installed from
  the build's page, no store. **Android production** is `eas submit` to the production track with `releaseStatus:
  completed`: Google reviews and releases it, and tells no state through an API, so the record stops at
  *submitted* and points to the Play Console.
- **Foundry's own profiles in the checkout's eas.json**, merged over the project's (`foundry-preview`: an internal
  APK for Android, a store build for iOS, since TestFlight takes those alone; `foundry-production`: store builds, an
  app bundle for Android; both `extends` the project's `production` or `preview` profile when it has one), and a
  `foundry` submit profile with `ascAppId` and the key's path, or `serviceAccountKeyPath`, `track` and `releaseStatus`.
  A missing `cli.appVersionSource` becomes `local` so no prompt waits. The checkout is uploaded with `EAS_NO_VCS=1`, so
  Foundry's eas.json goes up and nothing is committed to the repository.
- **The run**: `eas build --platform <p> --profile <foundry profile> --non-interactive --no-wait --json`, then
  `eas build:view <id> --json` every `easPollMs` until it ends (90 minutes at most; the build's page is linked either
  way), then `eas submit --platform <p> --profile foundry --id <build> --non-interactive --wait` and
  `eas submit:view --json` for the submission's record. The App Store Connect app is found by bundle id through the
  API before anything is built; an app the store does not have is refused in words with where to make it. The .p8 key
  and the service account's JSON exist as files only while the commands run (`withSecretFile`); the token goes through
  `EXPO_TOKEN`; values are blanked out of the record. A store build has no address, so no smoke runs.
- **A watch on the App Store.** A `Deployment` gains a `submitted` status and a `store` record (the build, its page,
  the artifact, the submission, the console page, the state in words and Apple's code). Every `storePollMin` minutes
  (15), and on **Check now**, Foundry asks App Store Connect with its own ES256 token: the build's `processingState`
  (processing → VALID, in TestFlight), then the App Store version attached to that build and its `appVersionState`
  (waiting for review, in review, pending release, live, rejected, replaced). Each move is a `deploy.store_changed`
  event, told under the Delivery notifications; live sets the deployment `live` with the App Store address, a
  rejection sets it `failed` with Apple's state. A preview is done once it is in TestFlight; a deploy is left alone
  after 30 days. Google Play has no such watch.
- **Settings → Git & delivery → Stores**: the Expo token, the App Store Connect key id, issuer id and the .p8 contents,
  and the Play service account's JSON — secrets kept by the engine like the hosts' tokens, read from the environment
  too (`EXPO_TOKEN`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`). The readiness check: the token, the EAS link
  (`extra.eas.projectId`, with `eas init` as the command), `eas whoami`, and per store the key and the app's record
  (App Store Connect by bundle id; the Play Console reached with the service account through an edit opened and
  dropped), the iOS signing as a warning.

## Considered options

- **Building iOS and Android locally (Xcode, Gradle, fastlane).** Rejected: Foundry would hold the certificates and
  keystores, need a Mac for iOS, and reproduce what EAS does for every Expo app already; fastlane stays blocked for
  sessions and unused by Foundry.
- **Submitting for review and releasing through the App Store Connect API.** Rejected for v1: a review submission is
  a public act with the app's metadata, screenshots and compliance answers behind it; the person does it in App Store
  Connect, and Foundry tells them where it stands.
- **iOS preview as an ad hoc (internal) build.** Rejected: it needs each tester's device registered with Apple
  (`eas device:create`, interactive) and a profile per device; TestFlight is the preview channel Apple means.
- **EAS Update (over-the-air JS updates) as a preview.** Out of scope, as settled: a different product, not a store
  build.
- **Polling Google Play's review.** Impossible: the Android Publisher API exposes release status, not review state.

## Consequences

- `DeployProvider` gains `appstore` and `play`; `Deployment.status` a `submitted`; `Deployment.store` (`DeployStore`);
  events `deploy.submitted` and `deploy.store_changed`, and `deploy.finished` an optional `store` (the Android APK).
  Older rows and events replay unchanged.
- `DeliverySettings` gains `expoToken`, `ascKeyId`, `ascIssuerId`, `ascKey`, `playServiceAccount`, `storePollMin`;
  the three secrets join `SECRET_SETTINGS`.
- New modules `engine/src/deploy/eas.ts` (detection, profiles, the CLI's output), `asc.ts` (the token, the API, the
  states in words) and `play.ts` (the token, the app's record). The engine gains `storeFetch`, `easPollMs`, a
  `storeWatchTimer` and `checkStores`; the route `POST /api/goals/:id/deploy/store-check`.
- The boundary guard already blocked `eas build|submit|update|credentials|device:create` for sessions (ADR-0091).
- The user guide's Deploy and Git & delivery sections describe the stores, what Foundry never does there, and the
  watch; the notifications table names the store moves.
