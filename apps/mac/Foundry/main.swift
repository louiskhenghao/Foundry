// Foundry's macOS menu bar app (ADR-0105): a status item around the compiled foundry engine beside it in Contents/MacOS.
// The engine serves the page in the person's own browser; this keeps it running, says how it is and what waits, opens
// the page, starts at login, and installs an update the engine downloaded and checked. Built with swiftc by
// scripts/build-release.ts, no Xcode project: one file, AppKit and ServiceManagement only.
import AppKit
import ServiceManagement

// MARK: - where things are

let engineExecutable = "foundry-engine"
/// the engine's exit code when a downloaded release waits in updates/ready.json to be installed
let updateReadyExit: Int32 = 75
let releasesPage = URL(string: "https://github.com/louiskhenghao/foundry-releases/releases")!
let env = ProcessInfo.processInfo.environment
let fm = FileManager.default

/// ~/.foundry, or FOUNDRY_HOME: where the engine writes app.json, the address it listens on
let foundryHome: URL = {
  if let h = env["FOUNDRY_HOME"], !h.isEmpty { return URL(fileURLWithPath: (h as NSString).expandingTildeInPath) }
  return fm.homeDirectoryForCurrentUser.appendingPathComponent(".foundry")
}()
let stateFile = foundryHome.appendingPathComponent("app.json")
let logDir = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Foundry")
let logFile = logDir.appendingPathComponent("app.log")

struct EngineState: Decodable { let pid: Int32; let port: Int; let url: String; let dataDir: String; let version: String? }
struct AppStatus: Decodable {
  struct Update: Decodable { let available: Bool; let latest: String? }
  let version: String; let inbox: Int; let briefs: Int; let update: Update
}
struct ReadyUpdate: Decodable { let version: String; let bundle: String }

/// one line in app.log, beside what the engine prints there
func log(_ message: String) {
  let line = "\(ISO8601DateFormatter().string(from: Date())) [app] \(message)\n"
  guard let data = line.data(using: .utf8) else { return }
  try? fm.createDirectory(at: logDir, withIntermediateDirectories: true)
  if let h = try? FileHandle(forWritingTo: logFile) { h.seekToEndOfFile(); h.write(data); try? h.close() }
  else { try? data.write(to: logFile) }
}

/// the log file, opened to append, for the engine's output: kept below 10 MB by moving the old one aside at each start
func engineLogHandle() -> FileHandle? {
  try? fm.createDirectory(at: logDir, withIntermediateDirectories: true)
  if let size = (try? fm.attributesOfItem(atPath: logFile.path))?[.size] as? Int, size > 10_000_000 {
    let old = logDir.appendingPathComponent("app.log.1")
    try? fm.removeItem(at: old)
    try? fm.moveItem(at: logFile, to: old)
  }
  let fd = open(logFile.path, O_WRONLY | O_CREAT | O_APPEND, 0o644)
  return fd >= 0 ? FileHandle(fileDescriptor: fd, closeOnDealloc: true) : nil
}

// MARK: - the PATH a terminal has

/// An app opened from the Finder, the Dock or at login gets launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin), without
/// Homebrew, ~/.local/bin, nvm or anything the person's shell adds. The engine must start with the right one: Bun looks
/// commands up in the PATH its process started with and ignores later changes. So: the login shell, run as a login and
/// interactive shell (Homebrew's shellenv is in .zprofile, nvm and the coding agents' installers write .zshrc), prints
/// PATH between two marks; six seconds at most, so an rc file that waits cannot hold the app.
func loginShellPath() -> String? {
  var shell = env["SHELL"] ?? ""
  if shell.isEmpty, let pw = getpwuid(getuid()), let sh = pw.pointee.pw_shell { shell = String(cString: sh) }
  guard !shell.isEmpty, fm.isExecutableFile(atPath: shell) else { return nil }
  let mark = "__FOUNDRY_PATH__"
  let print = (shell as NSString).lastPathComponent == "fish" ? "printf '\(mark)%s\(mark)' (string join : $PATH)" : "printf '\(mark)%s\(mark)' \"$PATH\""
  let p = Process()
  p.executableURL = URL(fileURLWithPath: shell)
  p.arguments = ["-l", "-i", "-c", print]
  var e: [String: String] = ["HOME": fm.homeDirectoryForCurrentUser.path, "SHELL": shell, "TERM": "dumb"]
  for k in ["USER", "LOGNAME", "LANG", "PATH"] { if let v = env[k] { e[k] = v } }
  p.environment = e
  let out = Pipe()
  p.standardOutput = out
  p.standardError = FileHandle.nullDevice
  p.standardInput = FileHandle.nullDevice
  var buffer = Data()
  let lock = NSLock()
  out.fileHandleForReading.readabilityHandler = { h in let d = h.availableData; lock.lock(); buffer.append(d); lock.unlock() }
  guard (try? p.run()) != nil else { return nil }
  let deadline = Date().addingTimeInterval(6)
  while p.isRunning && Date() < deadline { usleep(50_000) }
  if p.isRunning { kill(p.processIdentifier, SIGKILL) }
  usleep(100_000)
  out.fileHandleForReading.readabilityHandler = nil
  lock.lock(); let text = String(decoding: buffer, as: UTF8.self); lock.unlock()
  guard let a = text.range(of: mark), let b = text.range(of: mark, range: a.upperBound..<text.endIndex) else { return nil }
  let path = String(text[a.upperBound..<b.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
  return path.isEmpty ? nil : path
}

/// the login shell's folders first, then what the app was started with, then where installers put tools; each once.
/// ~/.local/bin is there even before it exists: what Setup installs lands in it, and the engine must find it then
func enginePath(login: String?) -> String {
  let home = fm.homeDirectoryForCurrentUser.path
  let extras = ["\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "\(home)/.bun/bin", "\(home)/.cargo/bin", "/opt/homebrew/sbin"]
  var seen = Set<String>(), parts: [String] = []
  for part in (login ?? "").split(separator: ":").map(String.init) + (env["PATH"] ?? "").split(separator: ":").map(String.init) + extras where !part.isEmpty && !seen.contains(part) {
    seen.insert(part); parts.append(part)
  }
  return parts.joined(separator: ":")
}

// MARK: - the menu bar icon, drawn from the logo's own shapes as a template image

func statusImage() -> NSImage {
  let size = NSSize(width: 18, height: 18)
  let image = NSImage(size: size, flipped: true) { _ in
    // the favicon's glyph on a 1024 grid, scaled to 18 pt: a spine, two arms, a node and three blocks
    let s: CGFloat = 18.0 / 1024.0
    let p = { (x: CGFloat, y: CGFloat) in NSPoint(x: x * s, y: y * s) }
    NSColor.black.set()
    let line = NSBezierPath()
    line.lineWidth = 96 * s
    line.lineCapStyle = .round
    line.move(to: p(387, 299)); line.line(to: p(675, 299))
    line.move(to: p(387, 299)); line.line(to: p(387, 751))
    line.move(to: p(387, 537)); line.line(to: p(615, 537))
    line.stroke()
    NSBezierPath(ovalIn: NSRect(x: (387 - 118) * s, y: (299 - 118) * s, width: 236 * s, height: 236 * s)).fill()
    NSBezierPath(roundedRect: NSRect(x: 595 * s, y: 219 * s, width: 160 * s, height: 160 * s), xRadius: 40 * s, yRadius: 40 * s).fill()
    NSBezierPath(roundedRect: NSRect(x: 541 * s, y: 463 * s, width: 148 * s, height: 148 * s), xRadius: 37 * s, yRadius: 37 * s).fill()
    NSBezierPath(roundedRect: NSRect(x: 295 * s, y: 659 * s, width: 184 * s, height: 184 * s), xRadius: 46 * s, yRadius: 46 * s).fill()
    return true
  }
  image.isTemplate = true
  return image
}

// MARK: - the app

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
  enum Phase: Equatable { case starting, running, stopped(String), updating }

  var item: NSStatusItem!
  let menu = NSMenu()
  let headline = NSMenuItem(title: "Foundry is starting…", action: nil, keyEquivalent: "")
  let openRow = NSMenuItem(title: "Open Foundry", action: #selector(openUI), keyEquivalent: "o")
  let inboxRow = NSMenuItem(title: "", action: #selector(openInbox), keyEquivalent: "")
  let briefsRow = NSMenuItem(title: "", action: #selector(openGoals), keyEquivalent: "")
  let updateRow = NSMenuItem(title: "", action: #selector(openUpdate), keyEquivalent: "")
  let startRow = NSMenuItem(title: "Start Foundry Again", action: #selector(startAgain), keyEquivalent: "")
  let loginRow = NSMenuItem(title: "Start at Login", action: #selector(toggleLogin), keyEquivalent: "")
  let logRow = NSMenuItem(title: "Show Log", action: #selector(showLog), keyEquivalent: "")
  let quitRow = NSMenuItem(title: "Quit Foundry", action: #selector(quit), keyEquivalent: "q")

  var engine: Process?
  /// the write end of the engine's stdin: the engine stops when this closes, however this app ends
  var lifeline: Pipe?
  var state: EngineState?
  var status: AppStatus?
  var phase: Phase = .starting { didSet { render() } }
  var crashes: [Date] = []
  var quitting = false
  var openWhenReady = true
  var poll: Timer?
  /// the PATH the engine starts with, resolved once per launch of the app
  var path: String?

  func applicationWillFinishLaunching(_ n: Notification) {
    // a login item opens no page; an app started again by an update neither (the page reloads by itself)
    if let ev = NSAppleEventManager.shared().currentAppleEvent, ev.eventID == kAEOpenApplication,
       ev.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem { openWhenReady = false }
    if CommandLine.arguments.contains("--after-update") { openWhenReady = false }
  }

  func applicationDidFinishLaunching(_ n: Notification) {
    log("Foundry.app \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "?") from \(Bundle.main.bundlePath)")
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.image = statusImage()
    item.button?.imagePosition = .imageLeft
    item.button?.toolTip = "Foundry"
    for row in [openRow, inboxRow, briefsRow, updateRow, startRow, loginRow, logRow, quitRow] { row.target = self }
    headline.isEnabled = false
    menu.delegate = self
    menu.autoenablesItems = false
    for row in [headline, .separator(), openRow, inboxRow, briefsRow, updateRow, startRow, .separator(), loginRow, logRow, .separator(), quitRow] { menu.addItem(row) }
    item.menu = menu
    render()
    offerLoginItemOnce()
    if Bundle.main.bundlePath.contains("/AppTranslocation/") { warnTranslocated() }
    startEngine()
    poll = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
  }

  // MARK: the engine

  func startEngine() {
    guard engine == nil else { return }
    // the login shell is asked once, off the main thread; the engine waits for its answer
    guard let path else {
      DispatchQueue.global(qos: .userInitiated).async {
        let resolved = enginePath(login: loginShellPath())
        DispatchQueue.main.async {
          self.path = resolved
          log("PATH for the engine: \(resolved)")
          self.startEngine()
        }
      }
      return
    }
    let exe = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/\(engineExecutable)")
    let p = Process()
    p.executableURL = exe
    p.arguments = ["serve"]
    var e = env
    e["FOUNDRY_APP_SHELL"] = "1"
    e["PATH"] = path
    p.environment = e
    let pipe = Pipe()
    p.standardInput = pipe
    if let out = engineLogHandle() { p.standardOutput = out; p.standardError = out }
    p.terminationHandler = { [weak self] proc in
      let code = proc.terminationStatus, how = proc.terminationReason
      DispatchQueue.main.async { self?.engineEnded(code: code, signaled: how == .uncaughtSignal) }
    }
    do {
      try p.run()
      engine = p
      lifeline = pipe
      state = nil
      phase = .starting
      log("engine started (pid \(p.processIdentifier))")
      waitForAddress(pid: p.processIdentifier, since: Date())
    } catch {
      log("engine could not start: \(error)")
      phase = .stopped("the engine could not start: \(error.localizedDescription)")
    }
  }

  /// the engine writes app.json once it listens; until then there is no address to open
  func waitForAddress(pid: Int32, since: Date) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
      guard let self, self.engine?.processIdentifier == pid else { return }
      if let data = try? Data(contentsOf: stateFile), let s = try? JSONDecoder().decode(EngineState.self, from: data), s.pid == pid {
        self.state = s
        log("engine listens on \(s.url) (data: \(s.dataDir))")
        self.refresh()
        return
      }
      if Date().timeIntervalSince(since) < 180 { self.waitForAddress(pid: pid, since: since) }
    }
  }

  func engineEnded(code: Int32, signaled: Bool) {
    engine = nil
    lifeline = nil
    log("engine ended (\(signaled ? "signal" : "exit") \(code))")
    if quitting { return }
    if !signaled && code == updateReadyExit { installUpdate(); return }
    // a crash: start again, waiting longer each time; five in two minutes is a fault to show, not to loop on
    crashes = crashes.filter { Date().timeIntervalSince($0) < 120 } + [Date()]
    if crashes.count >= 5 {
      phase = .stopped("Foundry stopped after \(crashes.count) failed starts")
      return
    }
    phase = .starting
    let delay = pow(2.0, Double(crashes.count - 1))
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.startEngine() }
  }

  func stopEngine(then done: @escaping () -> Void) {
    guard let p = engine, p.isRunning else { done(); return }
    p.terminate()
    let deadline = Date().addingTimeInterval(15)
    func wait() {
      if !p.isRunning { done(); return }
      if Date() > deadline { kill(p.processIdentifier, SIGKILL); done(); return }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { wait() }
    }
    wait()
  }

  // MARK: the status the menu shows

  func refresh() {
    guard let s = state, let url = URL(string: "\(s.url)/api/app/status") else { return }
    var req = URLRequest(url: url)
    req.timeoutInterval = 4
    URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
      let st = data.flatMap { try? JSONDecoder().decode(AppStatus.self, from: $0) }
      DispatchQueue.main.async {
        guard let self else { return }
        if let st {
          self.status = st
          if self.phase != .running { self.phase = .running; self.crashes = [] }
          else { self.render() }
          if self.openWhenReady { self.openWhenReady = false; self.openUI() }
        } else if self.phase == .running {
          self.phase = .starting
        }
      }
    }.resume()
  }

  func render() {
    let waiting = (status?.inbox ?? 0) + (status?.briefs ?? 0)
    item?.button?.title = phase == .running && waiting > 0 ? " \(waiting)" : ""
    item?.button?.appearsDisabled = phase != .running
    switch phase {
    case .starting: headline.title = "Foundry is starting…"
    case .running: headline.title = "Foundry \(status?.version ?? "") is running"
    case .updating: headline.title = "Foundry is updating…"
    case .stopped(let why): headline.title = why
    }
    openRow.isEnabled = phase == .running
    let inbox = phase == .running ? status?.inbox ?? 0 : 0
    inboxRow.isHidden = inbox == 0
    inboxRow.title = inbox == 1 ? "1 thing waits for you" : "\(inbox) things wait for you"
    let briefs = phase == .running ? status?.briefs ?? 0 : 0
    briefsRow.isHidden = briefs == 0
    briefsRow.title = briefs == 1 ? "1 Brief to approve" : "\(briefs) Briefs to approve"
    let latest = status?.update.available == true ? status?.update.latest : nil
    updateRow.isHidden = phase != .running || latest == nil
    updateRow.title = "Update to \(latest ?? "")…"
    if case .stopped = phase { startRow.isHidden = false } else { startRow.isHidden = true }
    loginRow.state = SMAppService.mainApp.status == .enabled ? .on : .off
  }

  func menuWillOpen(_ menu: NSMenu) {
    render()
    refresh()
  }

  // MARK: actions

  func page(_ path: String) {
    guard let s = state, let url = URL(string: s.url + path) else { return }
    NSWorkspace.shared.open(url)
  }
  @objc func openUI() { page("/") }
  @objc func openInbox() { page("/inbox") }
  @objc func openGoals() { page("/") }
  @objc func openUpdate() { page("/?update=1") }
  @objc func showLog() { NSWorkspace.shared.open(logFile) }
  @objc func startAgain() {
    crashes = []
    startEngine()
  }

  @objc func toggleLogin() {
    do {
      if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
      else { try SMAppService.mainApp.register() }
    } catch {
      log("start at login: \(error)")
    }
    if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
    render()
  }

  /// the first launch starts Foundry at login, as the installer's background service did; the menu turns it off
  func offerLoginItemOnce() {
    let key = "loginItemOffered"
    guard !UserDefaults.standard.bool(forKey: key), env["FOUNDRY_LOGIN_ITEM"] != "off" else { return }
    UserDefaults.standard.set(true, forKey: key)
    do { try SMAppService.mainApp.register(); log("start at login: on") } catch { log("start at login: \(error)") }
  }

  @objc func quit() {
    quitting = true
    poll?.invalidate()
    stopEngine { NSApp.terminate(nil) }
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    // logout, restart, Quit from the Dock's menu: the engine first, so no session is cut mid-write
    guard let p = engine, p.isRunning else { return .terminateNow }
    quitting = true
    stopEngine { NSApp.reply(toApplicationShouldTerminate: true) }
    return .terminateLater
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    // opened again from the Finder or Spotlight while running: the page
    if phase == .running { openUI() } else { openWhenReady = true }
    return false
  }

  // MARK: updates

  /// the engine downloaded a release, checked it and unpacked it: swap the bundle and start the new one
  func installUpdate() {
    phase = .updating
    guard let s = state ?? (try? Data(contentsOf: stateFile)).flatMap({ try? JSONDecoder().decode(EngineState.self, from: $0) }) else {
      log("update: no app.json, so no data folder to find the release in; starting again"); startEngine(); return
    }
    let updates = URL(fileURLWithPath: s.dataDir).appendingPathComponent("updates")
    let readyFile = updates.appendingPathComponent("ready.json")
    guard let data = try? Data(contentsOf: readyFile), let ready = try? JSONDecoder().decode(ReadyUpdate.self, from: data) else {
      log("update: no ready.json; starting again"); startEngine(); return
    }
    let fresh = URL(fileURLWithPath: ready.bundle)
    let current = Bundle.main.bundleURL
    let freshInfo = NSDictionary(contentsOf: fresh.appendingPathComponent("Contents/Info.plist"))
    guard fm.isExecutableFile(atPath: fresh.appendingPathComponent("Contents/MacOS/\(engineExecutable)").path),
          freshInfo?["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier else {
      log("update: \(fresh.path) is not a Foundry.app; starting again"); try? fm.removeItem(at: readyFile); startEngine(); return
    }
    if current.path.contains("/AppTranslocation/") {
      try? fm.removeItem(at: readyFile)
      fail("Foundry runs from a copy macOS made of it and cannot replace itself. Drag Foundry.app to Applications, open it from there, and update again.")
      return
    }
    // the old app goes beside the downloads, as the way back; then the new one takes its place
    let previous = updates.appendingPathComponent("previous/Foundry.app")
    do {
      try fm.createDirectory(at: previous.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? fm.removeItem(at: previous)
      try fm.moveItem(at: current, to: previous)
      do { try fm.moveItem(at: fresh, to: current) }
      catch { try? fm.moveItem(at: previous, to: current); throw error }
    } catch {
      log("update: could not replace \(current.path): \(error)")
      try? fm.removeItem(at: readyFile)
      fail("Foundry could not replace itself in \(current.deletingLastPathComponent().path) (\(error.localizedDescription)). Download \(ready.version) from the releases page and replace it by hand.")
      return
    }
    try? fm.removeItem(at: readyFile)
    // what the download left: the folder the release was unpacked in, empty now
    try? fm.removeItem(at: updates.appendingPathComponent(ready.version))
    log("update: \(ready.version) installed at \(current.path); the old app is at \(previous.path)")
    let config = NSWorkspace.OpenConfiguration()
    config.createsNewApplicationInstance = true
    config.activates = false
    config.environment = env
    config.arguments = ["--after-update"]
    quitting = true
    NSWorkspace.shared.openApplication(at: current, configuration: config) { _, error in
      if let error { log("update: the new app did not start: \(error)") }
      DispatchQueue.main.async { NSApp.terminate(nil) }
    }
  }

  func fail(_ message: String) {
    let alert = NSAlert()
    alert.messageText = "Foundry could not update"
    alert.informativeText = message
    alert.addButton(withTitle: "Open the Releases Page")
    alert.addButton(withTitle: "OK")
    NSApp.activate(ignoringOtherApps: true)
    if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(releasesPage) }
    startEngine()
  }

  func warnTranslocated() {
    let alert = NSAlert()
    alert.messageText = "Move Foundry to Applications"
    alert.informativeText = "macOS runs Foundry from a temporary copy because it was opened where it was downloaded. It works, but it cannot update itself there. Quit, drag Foundry.app to Applications, and open it from there."
    alert.addButton(withTitle: "Continue")
    alert.addButton(withTitle: "Quit")
    NSApp.activate(ignoringOtherApps: true)
    if alert.runModal() == .alertSecondButtonReturn { quit() }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = App()
app.delegate = delegate
app.run()
