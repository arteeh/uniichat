import Foundation

enum Site {

  static let url = URL(string: Bundle.main.object(forInfoDictionaryKey: "UniiSite") as! String)!
  static let group = UserDefaults(suiteName: "group.com.higherorderco.uniichat")!

  static func call(_ path: String, _ body: Data?) async -> [String: Any] {
    var req = URLRequest(url: URL(string: path, relativeTo: url)!)
    req.httpMethod = body == nil ? "GET" : "POST"
    req.httpBody = body
    req.setValue("Bearer " + (group.string(forKey: "session") ?? ""), forHTTPHeaderField: "Authorization")
    guard let (data, res) = try? await URLSession.shared.data(for: req) else {
      return ["error": "Can't reach UniiChat. Try again."]
    }
    if (res as? HTTPURLResponse)?.statusCode == 401 {
      return ["error": "Open UniiChat and sign in first."]
    }
    let out = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    return out ?? ["error": "UniiChat gave no answer. Try again."]
  }

}
