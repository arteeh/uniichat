// UniiChat for iOS
// ================
// The site (Site.swift) in a web view, and what only an app does there:
//
// - Notifications: once signed in, the app asks to notify, and gives the
//   server its phone's push token (/api/push); the server pushes each
//   turn's last message (Push.ts). iOS shows none while the app is open.
// - Sign-in links open the app (universal links: the server's
//   apple-app-site-association names /auth), signing in its web view.
// - The mic dictates (the site's own recorder; iOS asks once).
// - A download (Export Memory, a file, a picture's) goes to the share
//   sheet; the site's prompt() is an alert.
// - The bridge (`unii`, web/src/main.ts) tells the page it is in the app,
//   which notifies by itself (no Web Push there).
//
// Any page off the site opens in Safari. The share extension is Share/.

import SwiftUI
import UserNotifications
import WebKit

@main
struct Unii: App {

  @UIApplicationDelegateAdaptor private var phone: Phone

  var body: some Scene {
    WindowGroup {
      ZStack {
        Color.white.ignoresSafeArea()
        Web().ignoresSafeArea(.container, edges: .bottom)
      }
      .onOpenURL { url in Page.shared.web.load(URLRequest(url: url)) }
    }
  }

}

struct Web: UIViewRepresentable {

  func makeUIView(context: Context) -> WKWebView {
    Page.shared.web
  }

  func updateUIView(_ web: WKWebView, context: Context) {}

}

// the phone's push token, given to the server
@MainActor
final class Phone: NSObject, UIApplicationDelegate {

  func application(_ app: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
    let hex = token.map { String(format: "%02x", $0) }.joined()
    Task { _ = await Site.call("/api/push", Data(hex.utf8)) }
  }

}

// Page
// ====

@MainActor
final class Page: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {

  static let shared = Page()

  let web: WKWebView

  // where the download being written goes
  var saved: URL? = nil

  override init() {
    let conf = WKWebViewConfiguration()
    conf.allowsInlineMediaPlayback = true
    web = WKWebView(frame: .zero, configuration: conf)
    super.init()
    web.configuration.userContentController.add(self, name: "unii")
    web.navigationDelegate = self
    web.uiDelegate = self
    web.load(URLRequest(url: Site.url))
  }

  // the page loaded: its sign-in kept for requests and the extension;
  // signed in, the push token asked for (iOS asks the user once)
  func webView(_ web: WKWebView, didFinish nav: WKNavigation!) {
    Task {
      let cookies = await web.configuration.websiteDataStore.httpCookieStore.allCookies()
      let session = cookies.first { $0.name == "unii" && $0.domain == Site.url.host }?.value
      Site.group.set(session, forKey: "session")
      let center = UNUserNotificationCenter.current()
      if session != nil, (try? await center.requestAuthorization(options: [.alert, .sound])) == true {
        UIApplication.shared.registerForRemoteNotifications()
      }
    }
  }

  // the site's pages stay; any other opens outside; a link to download
  // (`download`) is downloaded, never shown in place of the app's page
  func webView(_ web: WKWebView, decidePolicyFor act: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard let url = act.request.url else {
      return .cancel
    }
    if act.shouldPerformDownload {
      return .download
    }
    if url.host == Site.url.host || ["about", "blob", "data"].contains(url.scheme) {
      return .allow
    }
    _ = await UIApplication.shared.open(url)
    return .cancel
  }

  func webView(_ web: WKWebView, createWebViewWith conf: WKWebViewConfiguration, for act: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = act.request.url {
      UIApplication.shared.open(url)
    }
    return nil
  }

  func webView(_ web: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
    await withCheckedContinuation { done in
      let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
      alert.addTextField { field in field.text = defaultText }
      alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in done.resume(returning: nil) })
      alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in done.resume(returning: alert.textFields?.first?.text) })
      self.show(alert)
    }
  }

  func webView(_ web: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin, initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType) async -> WKPermissionDecision {
    type == .microphone ? .grant : .deny
  }

  // the bridge: there, so the page knows it is in the app; it is sent
  // nothing
  func userContentController(_ ucc: WKUserContentController, didReceive msg: WKScriptMessage) {}

  // Download
  // --------

  func webView(_ web: WKWebView, decidePolicyFor res: WKNavigationResponse) async -> WKNavigationResponsePolicy {
    let disposition = (res.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    return disposition.hasPrefix("attachment") ? .download : .allow
  }

  func webView(_ web: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ web: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func download(_ download: WKDownload, decideDestinationUsing res: URLResponse, suggestedFilename name: String) async -> URL? {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(name)
    try? FileManager.default.removeItem(at: file)
    saved = file
    return file
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let file = saved else {
      return
    }
    let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    sheet.popoverPresentationController?.sourceView = web
    sheet.popoverPresentationController?.sourceRect = CGRect(x: web.bounds.midX, y: web.bounds.midY, width: 0, height: 0)
    show(sheet)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    say("The download failed: " + error.localizedDescription)
  }

  // Alerts
  // ------

  func say(_ text: String) {
    let alert = UIAlertController(title: nil, message: text, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    show(alert)
  }

  // over whatever is shown
  func show(_ vc: UIViewController) {
    var top = web.window?.rootViewController
    while let next = top?.presentedViewController {
      top = next
    }
    top?.present(vc, animated: true)
  }

}
