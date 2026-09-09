import UIKit
import WebKit

final class BundleScheme: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url=urlSchemeTask.request.url else { return }
        var path=url.path
        if path == "/" || path.isEmpty { path="/index.html" }
        let clean=String(path.dropFirst())
        let base=Bundle.main.resourceURL!.appendingPathComponent("www", isDirectory:true)
        let file=base.appendingPathComponent(clean)
        guard file.standardizedFileURL.path.hasPrefix(base.standardizedFileURL.path), let data=try? Data(contentsOf:file) else {
            let e=NSError(domain:"MUSITUStore",code:404);urlSchemeTask.didFailWithError(e);return
        }
        let ext=file.pathExtension.lowercased();let type:[String:String]=["html":"text/html","js":"application/javascript","css":"text/css","json":"application/json","png":"image/png","webmanifest":"application/manifest+json"]
        let r=URLResponse(url:url,mimeType:type[ext] ?? "application/octet-stream",expectedContentLength:data.count,textEncodingName:(ext=="html"||ext=="js"||ext=="css"||ext=="json") ? "utf-8":nil)
        urlSchemeTask.didReceive(r);urlSchemeTask.didReceive(data);urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

final class ViewController: UIViewController, WKNavigationDelegate {
    var web:WKWebView!
    override func viewDidLoad(){super.viewDidLoad();let c=WKWebViewConfiguration();c.setURLSchemeHandler(BundleScheme(),forURLScheme:"musitu-local");c.websiteDataStore = .default();web=WKWebView(frame:.zero,configuration:c);web.navigationDelegate=self;web.translatesAutoresizingMaskIntoConstraints=false;view.addSubview(web);NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo:view.topAnchor),web.bottomAnchor.constraint(equalTo:view.bottomAnchor),web.leadingAnchor.constraint(equalTo:view.leadingAnchor),web.trailingAnchor.constraint(equalTo:view.trailingAnchor)]);web.load(URLRequest(url:URL(string:"musitu-local://app/index.html")!))}
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){if let u=action.request.url, ["http","https"].contains(u.scheme?.lowercased() ?? "") {UIApplication.shared.open(u);decisionHandler(.cancel)} else {decisionHandler(.allow)}}
}

@main final class AppDelegate:UIResponder,UIApplicationDelegate {
    var window:UIWindow?
    func application(_ application:UIApplication,didFinishLaunchingWithOptions launchOptions:[UIApplication.LaunchOptionsKey:Any]?=nil)->Bool{let w=UIWindow(frame:UIScreen.main.bounds);w.rootViewController=ViewController();w.makeKeyAndVisible();window=w;return true}
}
